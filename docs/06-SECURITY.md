# 06 — Security Architecture & Threat Model

## Assets
Broker credentials/tokens (highest), order execution capability, user PII, strategy IP (user's code), P&L data.

## Threat model (STRIDE summary)
| Threat | Control |
|---|---|
| Stolen session → place orders | httpOnly Secure cookies, 2FA required for live trading toggle, re-auth (step-up) for broker connect & kill-switch off, session revocation list |
| IDOR on orders/strategies | repository scoping by `userId`, and the `$extends` tenancy guard on `PrismaService.db` (docs/01 "Multi-tenancy"; `apps/api/src/infra/prisma/tenancy.extension.ts`). The guard refuses, before the query runs: a read, update or delete on a model with `userId` that doesn't filter by it (or by a compound key containing it); a create that doesn't set it; an update or upsert whose data changes `userId` or `user`; User queries not scoped by `id`; AuditLog anything but creates and reads filtered by `userId` or `actorId` (admin reads use `unscoped`); queries on the child tables without `userId` (WatchlistItem, AlertEvent, StrategyRunEvent) not scoped through their parent's `userId`, creates of them that don't connect a parent by a key with `userId`, their bulk creates, and moving them to another parent; any `include`, `select`, `_count`, relation filter, `orderBy` or unowned model's write that steps from a model no user owns (Plan, Instrument, …) to User or a user-owned model; models and operations it doesn't know. Not covered: raw SQL and nested writes below the top level of `data` (code review and integration tests). Unit tests for each rule, sync tests against schema.prisma, integration tests for cross-user access. In the database, every relation between user-owned tables is a composite FK on `(id, userId)`, so a row can never reference another user's row |
| Broker token exfiltration from DB | AES-256-GCM envelope encryption; master key outside DB (KMS); decrypt only in vault service; tokens never serialised |
| Token exfiltration via logs | allowlisting log serializers (no headers, bodies or query strings) backed by pino redaction, plus log review tests; the problem filter never echoes headers or library messages (see "Logs") |
| Malicious strategy code | `isolated-vm` / sandboxed Python worker, no net/fs, CPU/mem/time limits, output size cap |
| Order spam / runaway algo | per-user order rate cap (10/s), daily loss limit, max positions, kill switch, circuit breaker on broker errors |
| XSS | React escaping, CSP with nonces, no `dangerouslySetInnerHTML`, Trusted Types in prod |
| CSRF | api: `SameSite=Lax` session cookie + `Origin`/Fetch Metadata check on mutations + JSON-only bodies (a cross-origin JSON write needs a CORS preflight, which the allowlist refuses); see "CSRF" below. Auth.js's own CSRF token protects Auth.js's routes in the web app |
| Injection | Zod + Prisma; raw SQL only tagged; Timescale queries parameterised |
| Supply chain | lockfile, Dependabot, `pnpm audit`, Trivy, SBOM, pinned Docker digests |
| Replay of order requests | `Idempotency-Key` per user (`idem:<userId>:<key>`, 24 h): a retry replays the first 2xx, a concurrent duplicate gets 409, a reused key with another body 400, and without Redis the route fails closed (503); exactly-once side effects come from database uniqueness (2.1). See "Idempotency" |
| Insider/admin abuse | admin actions audited, 2FA + IP allowlist, least-privilege DB roles |
| DDoS | Cloudflare, per-IP and per-user GCRA rate limits (see "Rate limiting"), WS connection cap per user, backpressure (volatile emits) |

### Dependency audit exceptions
CI's `security` job runs `pnpm audit:ci` (`scripts/audit.mjs`). It fails on any high or critical advisory that has no
active exception in `scripts/audit-exceptions.json`, and on audit output it can't read (a registry error, for example).
- **Keyed by GHSA id.** Each entry names the package and the severity it was reviewed at. It covers only that advisory,
  and stops covering it if the severity is raised. pnpm's own `auditConfig` ignores have no expiry, so the script
  rejects them.
- **Reachability justification required.** `reason` shows why the vulnerable code can't be reached here: what pulls the
  package in (`pnpm why -r <pkg>`), which code path loads it, and why no attacker-controlled input gets there. "Dev
  dependency" alone is not a reason. `tracking` points at the upstream fix to watch.
- **Expires in at most 90 days.** The script fails on an expired entry and on one dated more than 90 days ahead, so an
  extension means re-checking the reason. An entry that no longer matches any advisory prints a warning: delete it.

| Advisory | Package | Why it is unreachable | Expires | Tracking |
|---|---|---|---|---|
| GHSA-ggr8-5vv4-36mx (high) | deepmerge-ts 7.1.5 | Used only by `@prisma/config` (prisma CLI) to merge our own static `prisma.config.ts` at CLI time; no untrusted or recursive input reaches it, and the app never loads it | 2026-12-31 | [prisma/orm#30295](https://github.com/prisma/orm/issues/30295) |
| GHSA-3f6p-5ww8-9rcr (high) | mysql2 3.15.3 | Used only by the prisma CLI, in Prisma Studio's MySQL executor. Our datasource is PostgreSQL and the runtime uses `@prisma/adapter-pg` + `pg`, so it never connects to MySQL | 2026-12-31 | [prisma/orm#30295](https://github.com/prisma/orm/issues/30295) |

Moderate advisories are reported, not gated. Reviewed ones that ship with the api:
- **GHSA-r3ph-w7gj-g6xm (moderate), js-yaml 5.3.0** via `@nestjs/swagger`: CPU use when *loading* YAML with empty merge
  sources. `@nestjs/swagger` requires js-yaml at startup but only ever calls its `dump`, to serve a YAML copy of the
  OpenAPI document. The api serves the document as JSON only (`raw: ["json"]` in `apps/api/src/bootstrap/openapi.ts`),
  so that route doesn't exist and nothing in the api parses YAML; in production the docs aren't served at all. Drop
  this note when a patched js-yaml reaches `@nestjs/swagger`.

## Session contract (Auth.js ↔ api)
Auth.js (apps/web, 0.6) creates, extends and deletes sessions and is the only one that sets the cookie; the api
validates them (`apps/api/src/modules/auth`). Both sides read the constants in `@finlytics/shared`
(`SESSION_COOKIE_NAME`, `SESSION_TOKEN_PATTERN`, `SESSION_LIMITS`).
- **Cookie:** `authjs.session-token` in development and test, `__Host-authjs.session-token` in production. `HttpOnly`,
  `SameSite=Lax`, `Path=/`, no `Domain`, `Secure` in production. One origin in production (the ingress routes `/v1`
  to the api), because a `__Host-` cookie can't be shared with another host.
- **Token:** opaque, matching `SESSION_TOKEN_PATTERN` (Auth.js's `randomUUID()` does). `Session.sessionToken` stores
  the lowercase hex SHA-256 of the token, never the token: a database read (backup, replica, injection) can't be
  replayed as a session. A malformed cookie is anonymous without a lookup.
- **Valid when:** the row exists, `expires` is in the future, `lastSeenAt` is less than 7 days old (idle limit),
  `createdAt` is less than 30 days old (absolute limit) and the user isn't deleted. `lockedUntil` is not checked:
  lockout protects sign-in, and checking it here would let an attacker sign a victim out by failing logins on purpose.
- **Lookups:** one unique-index query per request, no cache (a cached session would outlive its revocation). The api
  writes only `lastSeenAt`, at most every 5 minutes per session, scoped by `userId`.
- **Outages:** a database error during the lookup is `503 SERVICE_UNAVAILABLE`, never `401` (the web app signs the user
  out on 401).
- **Guards** (global, in order): `CsrfGuard` → `SessionGuard` → `RateLimitGuard` → `AuthGuard`. `@Public()`
  routes (only `/health/*` in 0.5) skip CSRF and session resolution entirely. A lookup that finds no valid session is
  charged once to the caller's anonymous rate-limit buckets, and a request from an address whose bucket is already
  empty is refused before its lookup (see "Rate limiting").

## CSRF
For unsafe methods (anything but GET, HEAD and OPTIONS) on non-public routes, when the request carries the session
cookie (`apps/api/src/common/guards/csrf.guard.ts`):
- with `Origin`: it must be one of `API_ALLOWED_ORIGINS` (exact match), otherwise `403 FORBIDDEN`;
- without `Origin`: `Sec-Fetch-Site` must be absent, `same-origin` or `none`, otherwise `403 FORBIDDEN`;
- with neither header: allowed. Browsers always send `Origin` on cross-origin unsafe requests, so this is a
  non-browser client, for example a Next.js server action forwarding the cookie.

Three independent layers cover every browser that can hold the cookie: `SameSite=Lax`, the Origin/Fetch Metadata
check, and JSON-only bodies (any other media type is `415`, so a cross-site write needs a CORS preflight, which the
exact-origin allowlist refuses). There is no synchronizer or double-submit token.

## Rate limiting
`apps/api/src/common/rate-limit` (policies, headers and limits: docs/04 §7 "Rate limits").
- **Algorithm:** GCRA, a token bucket with one timestamp per key, in one Lua script per check: atomic, one round trip,
  on the Redis clock (`TIME`), so pod clock skew doesn't matter. Integer microseconds throughout, so the arithmetic is
  exact for any configured limit. A TypeScript model of the same algorithm carries the property tests (never more
  than the burst at once, exact retry-after). Not a fixed window, which lets twice the limit through across a window
  boundary.
- **Buckets:** `public` per client IP (`rl:public:ip:<ip>`, 100/min), `publicNet` per IPv6 /48
  (`rl:publicNet:ip:<prefix>/48`, 20 × the public limit), `user` per user (`rl:user:u:<userId>`, 600/min, whatever the
  IP), `orders` per user (10/s, from 2.1). Keys expire when the bucket is full again. Each limit is a sustained rate
  with a burst of the same size (docs/04 §7).
- **Client IP:** Fastify's `request.ip` under the trusted-proxy setting (below). An IPv4-mapped IPv6 address counts as
  IPv4, and an address that isn't an IP shares a single bucket rather than escaping the limit.
- **IPv6 aggregation:** an IPv6 client is keyed by its /64, one subscriber's usual prefix, so neighbours on other /64s
  don't share its bucket. But a subscriber delegated a /48 holds 65 536 /64s and could rotate through them, each with a
  fresh bucket. So anonymous IPv6 requests are also charged to their /48's `publicNet` bucket, at 20 times the
  `public` limit: room for a site of real users, while a rotating client is capped at 20 × the limit per /48. It is
  charged only after `public` admits the request, so a refused /64 doesn't spend its /48's budget. Not applied to
  IPv4, where an address is already scarce, nor to signed-in requests, which are limited per user.
- **Failed session lookups:** a well-formed cookie that matches no valid session costs the caller's anonymous buckets
  one request, exactly once, like any anonymous request. Each pod keeps a bounded map (10 000 entries; expired, then
  oldest, evicted first) of anonymous buckets it knows are empty, learned only from the buckets' own answers (a refusal,
  or an admission that left nothing). SessionGuard consults it before the lookup: a request with a cookie from such an
  address gets 429 without touching the database, so random cookies buy at most as many lookups as the bucket admits
  (plus at most one per pod each time that pod has yet to learn the bucket is empty). A valid cookie from that address
  is refused too, for at most `Retry-After` (under a second at the default limit): nothing tells it from a random one
  without the lookup. Users behind a busy shared address (carrier-grade NAT) are exposed to that; 0.6 must make the
  Next.js server a trusted proxy so its server-side calls carry the browser's address, not its own. The map never
  refuses a request the bucket would admit, and costs no Redis round trip (a read-only "peek" script would have cost
  one on every signed-in request). Session tokens carry ≥ 122 bits of entropy, so guessing one is not a concern.
- **Redis outage:** `public` and `user` fail open (the request goes through without RateLimit headers; one warning
  every 10 s at most), so an outage doesn't take the api down with it. Trading policies (`orders`) fail closed with
  `503 SERVICE_UNAVAILABLE`.
- **Headers** never carry a partition key (`pk`), which would echo the client's IP or user id.

## Trusted proxies
`API_TRUST_PROXY` decides which peers may set `X-Forwarded-For` (Fastify `trustProxy`):
- `false` (the default): the client is the TCP peer, and `X-Forwarded-For` is ignored.
- A comma-separated list of the proxies' IPs/CIDRs (the ingress and load balancer): Fastify takes the rightmost
  address that isn't a trusted proxy, so an address a client prepends never counts.
- `true` is rejected: any client could choose its own IP and so its own rate-limit bucket.
- A hop count is rejected too. It can't verify that the immediate peer is a proxy (a client that reaches the api
  directly could still spoof the header), and Fastify ≥ 5.12.2 (the api runs 5.12.5) trusts nothing when given a
  number, so a count would silently key every client by the proxy's address.
- Production must set it explicitly. Integration tests prove that `X-Forwarded-For` from an untrusted peer is ignored
  and that the forwarded address is used behind a configured proxy.

## Idempotency
`apps/api/src/common/idempotency` (semantics: docs/04 §7 "Idempotency").
- **Principle:** Redis dedupes and replays; database uniqueness gives exactly-once side effects
  (`Order(userId, idempotencyKey)`, 2.1). So an expired lock, a released key, or a crash between a broker call and the
  Redis write can never place an order twice.
- **Scope:** keys are per user (`idem:<userId>:<key>`); `IdempotencyKeySchema` forbids `:`, so a key can't reach into
  another namespace. An `@Idempotent()` route must require a session.
- **Ownership:** a claim is `SET NX` with a 30 s TTL and a marker holding a random owner token; storing the response
  and releasing the key are compare-and-set and compare-and-delete on that exact marker, so a request whose claim
  expired can never overwrite or delete another request's record.
- **Binding:** the record holds the SHA-256 fingerprint of the method, path, query and canonical JSON body; reusing
  a key for a different request is `400`, never a replay of someone else's response.
- **Fail closed:** without Redis the route answers 503; retrying a trade without dedupe is worse than an error.
- **Data:** a stored record holds the response body (up to 64 KiB) for 24 h in Redis, which is on the private network
  only (6.4). Responses of idempotent routes must not contain secrets (they never do: broker tokens are never
  serialised).

## Production database role (interim, security finding F2)
Until the 2.1 role split (a migrator role owning every object; an app role with no `SET` on
`session_replication_role` and no UPDATE, DELETE or TRUNCATE on AuditLog), the api checks its own role at boot
(`apps/api/src/infra/prisma/database-role.check.ts`). In production it refuses to start if the role:
- is a superuser, or a member (directly or through other roles) of any superuser role;
- is a member of `pg_execute_server_program` or `pg_write_server_files` (shell commands and file writes on the
  database server through `COPY`);
- may SET `session_replication_role` (`has_parameter_privilege`, PostgreSQL ≥ 15): replica mode disables foreign keys,
  including the tenancy keys, and every trigger not marked `ENABLE ALWAYS`.

It warns, without refusing, when the role owns `AuditLog` (or is a member of its owner), since an owner can disable the
append-only triggers: until the split, the app role may own the tables it migrated. Nothing else is checked (for
example CREATEROLE, CREATEDB, BYPASSRLS, `pg_read_server_files` or ownership of other tables); the 2.1 split replaces
this check. It retries for up to 30 s while the database is unreachable, then exits 1; readiness stays 503 until the
check has passed. Development and test only warn. Every connection also sets `statement_timeout` (10 s) and
`idle_in_transaction_session_timeout` (15 s) until the role carries them.

## Logs
`apps/api/src/common/logger`. pino through nestjs-pino; Fastify's own logger is off.
- **Allowlisting serializers first:** `req` is the request id, method, client IP and the path without its query
  string (an OAuth callback's `?code=` is never logged); `res` is the status code; `err` keeps Prisma errors to their
  type and code (their messages contain query arguments, `PrismaClientValidationError` by name only), Nest
  HttpExceptions to type and status (their messages echo the URL), Zod errors to issue codes and paths, and drops
  ioredis `command.args`. Headers and request bodies are never logged.
- **Redaction backs them up** (`[REDACTED]`): `authorization`, `cookie` and `set-cookie` headers, and the fields
  `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `access_token`, `refresh_token`, `id_token`,
  `sessionToken`, `secret`, `clientSecret`, `apiKey`, `credentials`, `encryptedCredentials`, `totpSecretEnc`,
  `backupCodes` and `email`: at the top level of a line, and inside `err` at depths 1 and 2, the only key hand-written
  lines use for nested data (an error's own fields and causes). No wildcard at the root, which would make pino walk
  every key of every line; a new log key that can nest data is added to the scoped list.
- **Correlation:** every line written during a request carries its `requestId`, which the api generates (a UUID;
  never a client's `x-request-id`). The same id is the response's `x-request-id`, the problem's `requestId` and the
  `AuditLog.requestId` of the request's audit rows (AuditService stores null, with a warning, for anything that isn't
  a server-generated id), so a client can't forge or collide audit correlation. A caller's own well-formed
  `x-request-id` is kept as `clientRequestId` on the access-log line. Health probes aren't access-logged; `429`s are
  logged at debug, so a flood doesn't flood the logs.
- **Production:** JSON only; pretty output, `trace` and `silent` levels, and a non-empty `DEBUG` (Prisma's and
  ioredis' debug output includes query parameters and command arguments) are boot failures.
- **Log review tests** (`apps/api/test/integration/logs.int.test.ts` and the logger unit tests) send cookies, bearer
  tokens and secrets in query strings and check that none reaches a log line.

## Crypto design (BrokerVaultService)
```
masterKey (KMS / env, 32 B) ──wrap──▶ dataKey (per BrokerAccount, 32 B random)
plaintext credentials JSON ──AES-256-GCM(dataKey, iv 12 B, aad = userId:accountId)──▶ ciphertext || tag
stored: { encKey (wrapped), iv, ct, tag, keyVersion }
```
Rotation: new master key version → background job rewraps data keys; no plaintext re-encryption needed.

## Auth flows
1. **App login**: Auth.js OAuth (Google/GitHub) or email magic link → DB session → optional TOTP.
2. **Broker connect (Upstox)**: `POST /broker-accounts` → redirect to Upstox authorize (state = signed nonce) → callback → exchange code server-side using **our** app key/secret (user never types keys) → encrypt token → `ACTIVE`. Daily re-login: at 08:30 IST notify; one click repeats step (session already logged into Upstox in browser → instant).
3. **Broker connect (Dhan)**: user pastes access token once (Dhan has no OAuth) → encrypted → renewal reminder.
4. **Service auth**: api → ai-engine RS256 JWT (5 min), ai-engine → api callback with same.

## Compliance notes (India)
- DPDP Act 2023: consent, data export/delete, breach notification process.
- SEBI algo framework: order tagging with algo ID, static IP for API orders, audit trail retention (5 years) — `AuditLog` partitioned by month, archived to object storage.
