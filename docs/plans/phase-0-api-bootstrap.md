# Phase 0.5 — `apps/api` bootstrap (roadmap 0.5)

Status: **built — in review**

> **Build note (D17).** `pnpm audit:ci` failed on four high fastify advisories in 5.11.3, the version `@nestjs/platform-fastify` 11.2.7 pins (GHSA-667r-xxjv-c9mm, GHSA-p68q-wchp-6fh7, GHSA-hwr6-493r-vm6h, GHSA-9q9j-q6p8-xq58, all fixed in 5.12.2). `pnpm-workspace.yaml` now overrides fastify to **5.12.5** and apps/api pins the same version: one copy, patched. D17's unit test asserts the *resolved* copy, not platform-fastify's declared dependency.

> **Review fix (D11).** Fastify 5.12's `handlerTimeout` is cancelled as soon as a request body has been read (Node emits `close` on the request), so POST and PATCH never timed out; `inject()` hid it. It is now off, and `apps/api/src/bootstrap/request-deadline.ts` enforces the 15 s budget from `onRequest` with the same `FST_ERR_HANDLER_TIMEOUT` → 503 mapping. It exposes `requestDeadlineSignal(request)`: never use Fastify's `request.signal`, which has the same flaw. A real-socket test covers a request with a body.

> **Review fixes (applied after the 0.4/0.5 review).** These supersede the matching text in D5, D7, D9, D11, D14 and §6:
> - Request ids are always server-generated; a well-formed inbound `x-request-id` is only logged as `clientRequestId`.
> - Requests arriving while the server closes get a problem+json 503 with `Connection: close` (`return503OnClosing: false`).
> - M1: a per-pod refusal cache (10 000 entries) refuses an IP whose `public` bucket is empty before any session lookup.
> - M2: an ended request (timeout or client gone) never starts its handler; transactions use `maxWait` 2 s + `timeout` 12 s,
>   and `DB_STATEMENT_TIMEOUT_MS` is capped at 11 000.
> - The tenancy guard also covers AuditLog reads, child tables, owner changes and relation paths (docs/01, docs/06).
> - Settings store only the user's overrides; `GET` still returns full settings.
> - IPv6 clients are also charged to a coarser /48 `publicNet` bucket (20x the public limit).
> - The production role check also refuses membership of a superuser role and warns when the role owns AuditLog.
> - **Carry-forward to 0.6:** the Next.js server must be listed in `API_TRUST_PROXY` and forward `X-Forwarded-For`,
>   otherwise every server-side call shares one IP bucket, which is now enforced before the session lookup. · 2026-10-06 · branch `feat/phase-0-api-bootstrap` · build with `/build-feature phase-0-api-bootstrap`

**How this plan was made.** The `architect` subagent drafted it from:
- `CLAUDE.md`, `.claude/rules/*` and `.claude/skills/nest-module/SKILL.md`
- `docs/01–04, 06, 08`
- the built Phase 0 plan, `docs/plans/phase-0-foundations.md`. Its §10 notes are binding input here.
- the code on `main` at `7b0cde1`

Version facts were checked on 2026-10-05/06 against the npm registry, release notes, official docs and source (§2b).

**(verify)** marks a step whose exact syntax depends on the installed version. Keep the intent and adjust the syntax.

## 0. Preconditions, assumptions and user actions

**Preconditions (met)**
- Phase 0.1–0.3 are merged:
  - `@finlytics/shared` and `@finlytics/database` ship ESM and CJS builds, checked by publint and attw.
  - The database has five migrations, append-only triggers and a Testcontainers harness.
- The dev stack runs on `127.0.0.1:5433` (PostgreSQL 16.15 + TimescaleDB 2.30.2) and `127.0.0.1:6380` (Redis 7.4).
- `.env` defines `DATABASE_URL`, `DATABASE_DIRECT_URL` and `REDIS_URL`.
- Docker is available for Testcontainers, locally and in CI.

**User actions (builders can't do these)**
- Paste the block from "Environment variables (D3)" into `.env.example`.
  - Every new variable has a development default, so `.env` needs no change for local work.
  - Builders must not read or edit `.env` or `.env.example`: `.claude/settings.json` denies `Read(./.env.*)`.
  - If a builder needs a variable that isn't listed, or finds a name clash with an existing kit variable (for example `API_URL`), it stops and asks.
- Approve the edit to `.claude/skills/nest-module/SKILL.md` in PR10. There is no Nest CLI generator (D1), and guards are global (D9).

**Assumptions.** Each one shapes a decision; reject any you disagree with before approval.
- **A1 — one origin in production.**
  - The ingress routes `/v1/*` (and `/rt` from 1.4) to the api, and everything else to Next.js. In development, Next.js rewrites `/v1/*` to `127.0.0.1:4000`.
  - Why: security.md requires `__Host-` session cookies, and a `__Host-` cookie can't carry a `Domain`. A separate `api.` host would never receive the session cookie.
- **A2 — Auth.js can store hashed session tokens.**
  - In 0.6, a thin wrapper around the Auth.js Prisma adapter stores SHA-256 of the session token (D9).
  - If that proves impossible, the fallback is a one-line change in `SessionRepository` (look up the raw token). The 0.6 review decides.
- **A3 — no unauthenticated `/v1` routes in 0.5.** The only `@Public()` routes are `/health/*`.
- **A4 — Nest 11 stays.**
  - npm `latest` is 12.1.2, but CLAUDE.md pins 11, and nestjs-zod 5.5.0 supports only `@nestjs/common` ^10 ‖ ^11.
  - Nest 12's native Standard Schema pipe is a carry-forward (§10.6).

## 1. Summary & user stories

0.5 turns the empty `apps/api` into the NestJS 11 + Fastify 5 skeleton that every later module plugs into:
- configuration validated by Zod before Nest starts
- structured, redacted logs with a correlation id on every line
- one error contract: RFC 9457 problem details
- the HTTP hardening from security.md
- Prisma and Redis with timeouts and an ordered shutdown
- liveness, readiness and draining
- the authentication boundary: Auth.js database sessions, validated by the api
- CSRF protection
- Redis-backed rate limiting and idempotency
- OpenAPI at `/docs`, in development and test only
- three small authenticated endpoints that prove the whole pipeline: `GET /v1/me`, `GET /v1/me/settings` and `PATCH /v1/me/settings`

It also settles the Phase 0 carry-forward notes and the open review findings (D19). Nothing calls a broker, no WebSocket is opened, and no queue is created.

| # | Story | Acceptance criteria |
|---|---|---|
| US1 | As a developer I start the api with one command and get fast restarts. | `pnpm dev` serves `127.0.0.1:4000` with pretty logs. An edit to `apps/api/src` restarts it within a few seconds; a rebuilt `shared` or `database` restarts it too. An invalid environment exits 1 and prints one `VARIABLE: reason` line per problem, never a value. |
| US2 | As an operator I can probe and drain an instance safely. | `GET /health/live` answers 200 without touching Postgres or Redis. `GET /health/ready` answers 200 only when `SELECT 1` and `PING` succeed within their timeouts, otherwise 503. The body is plain JSON with no hostnames, versions or error text. On SIGTERM: readiness answers 503 `draining`, in-flight requests finish, Prisma and then Redis close, and the process exits 0. |
| US3 | As a client developer every error has one shape. | Every 4xx/5xx is `application/problem+json`, passes `ProblemDetailsSchema`, and carries a `requestId` equal to the `x-request-id` header. That includes unknown routes, bodies over 1 MiB, non-JSON bodies and malformed JSON. No body ever contains a stack trace, SQL, a query string or a Prisma message. |
| US4 | As a security reviewer I find no secrets in logs. | Redaction tests cover the cookie, authorization and token headers and fields. Every log line written during a request has `requestId`. Prisma validation errors are logged by name only. Pretty output and `DEBUG` are rejected in production. |
| US5 | As a signed-in user (session created by Auth.js), the api knows who I am. | `GET /v1/me` returns my user for a valid session cookie. A missing, malformed, expired, idle (7 d), over-age (30 d) or deleted-user session gets 401 `UNAUTHENTICATED`. A database outage gets 503 `SERVICE_UNAVAILABLE`, never 401. `lastSeenAt` is written at most every 5 minutes. The database stores only SHA-256 of the token. |
| US6 | As the platform I throttle abusive clients. | Anonymous requests are limited per IP (100/min) and signed-in requests per user (600/min); both are configurable. Responses carry `RateLimit-Policy` and `RateLimit` (draft-11). A 429 is `RATE_LIMITED` with `Retry-After` and `retryAfterSec`. `X-Forwarded-For` from an untrusted peer never changes the client IP. If Redis is down these two policies fail open, and that is logged. |
| US7 | As a future trading client I can retry safely. | On an `@Idempotent()` route, a retry with the same key replays the first 2xx with `Idempotent-Replayed: true` and doesn't run the handler again. A concurrent duplicate gets 409 `IDEMPOTENT_REPLAY`. The same key with a different body gets 400 `VALIDATION`; a missing key gets 400. Keys are scoped per user and expire after 24 h. If Redis is down, the route answers 503 (fail closed). |
| US8 | As a user I read and change my preferences safely. | `GET` returns full defaults for a new user and logs the fields it repaired. `PATCH` changes only the fields it names; an unknown key gets 400 with `errors[]`. Two concurrent patches to different fields both persist. A cross-site `PATCH` gets 403. Each change writes one audit row with `actorId`. |
| US9 | As a developer I can browse the contract. | `/docs` and `/docs/json` (OpenAPI 3.1) list every route, with `ProblemDetails` as the default error response and cookie authentication. Both answer 404 in production. |
| US10 | As the team I keep the budgets and the gates. | Zero broker calls, zero WebSockets, zero queues. `pnpm audit:ci` passes. Unit coverage on the gated paths is ≥ 80%. Integration tests run on the pinned TimescaleDB image and on Redis 7.4. |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Module system and build.**<br>- **Module system:** a CommonJS app (`"type": "commonjs"`). TypeScript `module` and `moduleResolution` are `nodenext`, with `experimentalDecorators` and `emitDecoratorMetadata` on. Under nodenext, `@finlytics/*` resolve through their `require` condition, i.e. the `.cjs` + `.d.cts` pair that attw already checks.<br>- **Build:** plain `tsc -p tsconfig.build.json` into `dist/` with source maps, run with `node --enable-source-maps`. No Nest CLI, no SWC, no bundler.<br>- **Development:** turbo `dev` runs `node --watch --env-file-if-exists=../../.env dist/main.js`. A `dev:compile` sidecar runs `tsc --watch` through turbo's `with` key (Turborepo ≥ 2.5).<br>- **Tests:** Vitest on Vite 8's Oxc transform, with legacy decorators and `emitDecoratorMetadata`. No unplugin-swc. A canary test guards it (§7). | Nest 11 and its ecosystem ship CommonJS, and Node 24 can `require()` any ESM-only dependency anyway.<br>tsc emits decorator metadata from full type information, with the same compiler that typechecks. Oxc and SWC infer it one file at a time and fall back to `Object` when they can't tell.<br>`@nestjs/cli` 11.0.24 pulls in webpack 5, @angular-devkit 19, fork-ts-checker and a second TypeScript (5.9.3), all under our audit gate, for work two scripts already do.<br>Bundling a Nest app breaks its lazy `require`s and changes how circular imports behave.<br>Vite 8 handles decorator metadata itself, so tests need no native SWC binary, whose postinstall pnpm 10 would block.<br>Reversible: `@nestjs/cli` with its tsc builder emits the same `dist/`. |
| D2 | **Layout and lifecycle** (docs/02 and the nest-module skill; details below).<br>- `main.ts` validates the environment, then switches on `APP_ROLE` (only `http` in 0.5).<br>- `bootstrap/` builds the Fastify adapter and applies the hardening; `main.ts` and the tests call the same functions.<br>- `AppModule.forRoot(env)` takes the validated environment, so tests pass an object instead of mutating `process.env`.<br>- Shutdown: `onModuleDestroy` switches readiness to draining. `beforeApplicationShutdown` waits `API_SHUTDOWN_DRAIN_MS`. Nest then closes Fastify. `onApplicationShutdown` closes Prisma, then Redis. | Nest calls `onModuleDestroy` *before* it closes connections, so closing Prisma or Redis there would break in-flight requests.<br>The drain delay lets the load balancer drop the pod first.<br>With one code path for the adapter and the hardening, the tests exercise the production configuration. |
| D3 | **Environment** (table below).<br>- One Zod schema, `src/config/env.schema.ts`. It combines the database package's variables with the api's own.<br>- `main.ts` validates `process.env` before Nest starts. On failure it prints `VARIABLE: reason` lines, never values, and exits 1.<br>- Booleans use `z.stringbool()` restricted to `true`/`false`. Never `z.coerce.boolean()`, which reads `"false"` as true.<br>- Production-only rules: origins are required and `https`; the trusted-proxy setting is explicit; logs are JSON; docs are off; `DEBUG` is empty.<br>- App code reads configuration only through `ConfigService<Env, true>` (`@nestjs/config` with `load: [() => env]`, `ignoreEnvFile`, `skipProcessEnv`). A lint rule bans `process.env` outside `src/config` and `main.ts`.<br>- Only the dev script loads `.env`. | The process fails fast with messages that name the problem and contain no secrets; this also fixes review D6.<br>Each variable has one source of truth, and tests pass plain objects.<br>Misconfigurations that would silently weaken security (CORS `*`, spoofable client IPs, debug dumps) become boot failures instead. |
| D4 | **Errors** (mapping table below).<br>- **Filter:** one global `ProblemDetailsFilter`. It is a DI provider registered with `app.useGlobalFilters(app.get(ProblemDetailsFilter))`, so it also receives the errors Nest routes in from Fastify's error and not-found handlers (verify with the 404 and 413 tests).<br>- **Mapping:** the pure function `toProblem(error, request)` returns `{ problem, headers, log }`. The filter validates the problem against `ProblemDetailsSchema` before sending; if validation fails, it sends a minimal `INTERNAL` problem instead and logs the issue paths.<br>- **Response headers:** `application/problem+json; charset=utf-8`, `Cache-Control: no-store`, `x-request-id`, and `Retry-After` whenever `retryAfterSec` is set.<br>- **Members:** `instance` is the request path without its query string. `detail` only ever comes from our own curated messages.<br>- **New codes:** `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415) and `SERVICE_UNAVAILABLE` (503, retryable).<br>- **F7/S5** is fixed in shared (§5).<br>- **Domain errors:** a `DomainError` base with one thin subclass per code used in 0.5. | Clients branch on `code`, so every failure needs exactly one code.<br>Without a generic 503, a Redis or database outage would surface as `INTERNAL`, which isn't retryable, or as `BROKER_UNAVAILABLE`, which shows the broker banner.<br>413 and 415 keep HTTP semantics correct for proxies and `fetch`.<br>Validating before sending means a stack trace, an SQL fragment or a raw broker payload can't leave the server, even through a future bug. |
| D5 | **Logging.**<br>- **Logger:** nestjs-pino 5 (pino 10, pino-http 11) is the Nest logger (`bufferLogs: true`, then `app.useLogger(app.get(Logger))`). Fastify's own logger stays off.<br>- **Correlation:** every line written during a request carries `requestId` (`quietReqLogger`, `customAttributeKeys.reqId = "requestId"`, bound through AsyncLocalStorage).<br>- **Serializers emit allowlisted fields only:**<br>  - `req`: id, method, client IP, and the path *without* its query string (an OAuth callback's `?code=` must never be logged)<br>  - `res`: status<br>  - `err`: Prisma errors as `{ type, code }` only; ioredis errors without `command.args`; everything else through pino's standard serializer<br>- **Redaction backs this up** (`[REDACTED]`):<br>  - headers: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`<br>  - fields, at depths 0, 1 and 2: `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `access_token`, `refresh_token`, `id_token`, `sessionToken`, `secret`, `clientSecret`, `apiKey`, `credentials`, `encryptedCredentials`, `totpSecretEnc`, `backupCodes`, `email`<br>- **Noise:** health requests aren't access-logged.<br>- **Format:** pretty output (pino-pretty, a devDependency) only with `API_LOG_FORMAT=pretty`, which production rejects. | Allowlisting serializers is the main control; redaction catches what slips through (docs/06's "log review tests"). fast-redact has no wildcard for arbitrary depth, so the depths are listed explicitly.<br>A correlation id on every line is a backend rule.<br>Pretty transports run in a worker thread and must never load in a production image. |
| D6 | **Redis.**<br>- **Client:** one ioredis 6 client for the request path, in `RedisService`.<br>- **Options:** `lazyConnect`; `enableOfflineQueue: false`; `maxRetriesPerRequest: 1`; `connectTimeout` 2 s; `commandTimeout` 1 s; reconnect forever with capped, jittered backoff (100 ms → 5 s); reconnect on `READONLY` (failover); `connectionName: "finlytics-api"`.<br>- **Errors:** an `error` listener is always attached and logs at most once every 10 s.<br>- **Startup:** `onModuleInit` connects with a 3 s bound but doesn't block boot; readiness reports the state.<br>- **Shutdown:** `onApplicationShutdown` calls `quit()` with a 2 s bound, then `disconnect()`.<br>- **Scripts:** Lua runs through `defineCommand` (EVALSHA, loaded automatically).<br>- **Protocol:** RESP3, ioredis 6's default, stays.<br>- **Keys:** built only in `infra/redis/keys.ts` (namespaces below).<br>- **Later consumers** (BullMQ, the Socket.IO adapter, the feed) get their own connections. | A request should fail within about a second when Redis is down, not wait in an offline queue.<br>Without a listener, an `error` event would crash the process.<br>One key builder keeps namespaces free of collisions across modules and phases.<br>Our replies are the same in RESP2 and RESP3, and the integration tests run on Redis 7.4. |
| D7 | **Rate limiting: our own GCRA token bucket in one Lua script** (no library; details below).<br>- **Policies:** `public` per IP, `user` per user, and `orders`, declared now for 2.1.<br>- **Selection:** `RateLimitGuard` applies `user` when a session resolved, otherwise `public`. `@RateLimit("orders")` adds a policy; `@SkipRateLimit()` removes them (health).<br>- **Headers** (draft-ietf-httpapi-ratelimit-headers-11): `RateLimit-Policy: "user";q=600;w=60` and `RateLimit: "user";r=<remaining>;t=<seconds until full>`. A 429 adds `Retry-After`, which takes precedence. Never a partition key (`pk`), which would echo an IP or a user id.<br>- **Client IP:** Fastify's `request.ip` under `trustProxy` (D11), normalised: IPv4-mapped IPv6 becomes IPv4, and IPv6 is keyed by its /64.<br>- **When Redis fails:** `public` and `user` fail open (one warning every 10 s at most); trading policies fail closed with 503.<br>- **Failed session lookups** are charged once to the caller's `public` bucket (D9). | security.md asks for a Redis token bucket. GCRA is the token-bucket algorithm with one timestamp per key: one key, one round trip, atomic, and it uses the Redis clock, so pod clock skew doesn't matter.<br>rate-limiter-flexible uses a fixed window, which lets up to twice the limit through across a window boundary. Its insurance limiter also turns a global limit into a per-pod one during a Redis outage, without saying so.<br>@nestjs/throttler needs a third-party Redis storage and is also fixed-window.<br>The same script can serve `BrokerRateLimiter` in 1.1 and the order cap in 2.1. |
| D8 | **Idempotency** (semantics below).<br>- **Interceptor:** a global `IdempotencyInterceptor`, registered *outermost* (before `ZodSerializerInterceptor`). It acts only on `@Idempotent()` routes; the decorator also documents the header in OpenAPI.<br>- **Identity:** it requires an authenticated user. Redis key `idem:<userId>:<key>`.<br>- **Claiming:** `SET NX PX 30 s` with an in-flight marker that holds an owner token and the request fingerprint. The fingerprint is SHA-256 of method, path + query, and the body as canonical JSON (sorted keys).<br>- **Completion:** a 2xx is stored for 24 h by a compare-and-set script (status + serialised body, ≤ 64 KiB; larger bodies aren't stored). Any error releases the key by compare-and-delete.<br>- **Proof in 0.5:** a test-only `POST /v1/__test__/idempotent` controller that the integration harness adds. It is never part of `AppModule` or `dist`. The first real consumer is `POST /v1/orders` (2.1). | Being outermost means the stored body is exactly what was sent, and a replay never runs the serializer again.<br>Fail closed: retrying a trade without dedupe is worse than a 503.<br>**Redis idempotency dedupes and replays; exactly-once side effects come from database uniqueness** (`Order(userId, idempotencyKey)`, 2.1). So an expired lock, a released key, or a crash between the broker call and the Redis write can never place an order twice. |
| D9 | **The authentication boundary ships in 0.5** (session contract below).<br>- **Guards**, global and in this order: `CsrfGuard` → `SessionGuard` → `RateLimitGuard` → `AuthGuard`.<br>- **`SessionGuard`** reads the Auth.js cookie and looks up `Session` by SHA-256(token): one indexed query, no cache. It checks expiry, the idle and absolute lifetimes, and that the user isn't deleted, then sets `request.identity`. It writes `lastSeenAt` at most every 5 minutes.<br>- **`AuthGuard`** answers 401 unless the route is `@Public()`.<br>- **`@Public()`** routes skip CSRF and session resolution entirely, so `/health/live` never touches the database.<br>- **Malformed cookie:** counts as anonymous, without a lookup.<br>- **Lookup that finds nothing:** charged to the IP's `public` bucket (429 once it is empty).<br>- **Address already refused** (review M1): a well-formed cookie from an address whose anonymous bucket this pod knows is empty gets 429 *before* the lookup, valid cookie or not. The per-pod knowledge is a bounded map learned from the bucket's own answers (`common/rate-limit/refusal-cache.ts`).<br>- **Database error on a protected route:** 503, never 401. | Per-user rate limits and `idem:<userId>:…` need a real identity; without one, the integration tests can't prove those paths.<br>The guard depends only on the `Session` table contract, which already exists (the Auth.js Prisma adapter shape), not on Auth.js code: tests insert sessions directly. 0.6 then only configures Auth.js to match (§10.1), and its demo runs through the real api.<br>Hashed tokens mean a database read (a backup, a replica, an injection elsewhere) can't be replayed as a session. Tokens carry ≥ 122 bits of entropy, so unsalted SHA-256 is enough.<br>A session cache would keep a revoked session alive until it expired.<br>The web app signs the user out on any 401, hence 503 for database errors.<br>Charging failed lookups bounds the lookups random cookies can buy to what the IP's bucket admits, plus at most one per pod each time that pod has yet to learn the bucket is empty: refusing before the lookup is what makes the bound hold (charging alone still ran one lookup per request). A per-pod map costs nothing on the hot path; a read-only Redis "peek" would add a round trip to every signed-in request. The price: a valid session from a refused address also waits for `Retry-After`, so 0.6 must make the Next.js server a trusted proxy. |
| D10 | **CSRF: Origin and Fetch Metadata checks, JSON-only bodies, SameSite=Lax.**<br>- **Scope:** POST, PUT, PATCH and DELETE on non-public routes, when the session cookie is present.<br>- **With `Origin`:** it must be in `API_ALLOWED_ORIGINS`.<br>- **Without `Origin`:** `Sec-Fetch-Site` must be absent, `same-origin` or `none`.<br>- **With neither header:** allowed. Browsers always send `Origin` on cross-origin unsafe requests, so such a request comes from a non-browser client, for example a Next.js server action forwarding the cookie.<br>- **Failure:** 403 `FORBIDDEN`.<br>- **Bodies** must be `application/json` (D11), so any cross-origin write needs a CORS preflight, which the allowlist refuses.<br>- **No synchronizer or double-submit token.** | Three independent layers already cover every browser that can hold the cookie. A token adds client plumbing (read a cookie, set a header on every call) without closing a gap.<br>docs/06's "custom header check" is covered by JSON-only bodies plus CORS.<br>Auth.js's own CSRF token keeps protecting Auth.js's routes in the web app. |
| D11 | **HTTP hardening** (table below): a 1 MiB body limit; JSON-only parsers; a 15 s `handlerTimeout` over the whole request plus a 15 s receive timeout; `trustProxy` from the environment, never `true`; validated request ids; `@fastify/helmet` with a strict CSP (HSTS in production); a CORS allowlist with credentials, never `*`; `Cache-Control: no-store`; a BigInt-safe reply serializer.<br>**Versioning:** every versioned controller path starts with `v1/` (the nest-module template). No global prefix, no Nest URI versioning. `/health/*` and `/docs*` sit outside `/v1`. | security.md's hardening list, mapped onto Fastify 5's own options rather than middleware.<br>`handlerTimeout` (Fastify ≥ 5.8) also covers guards and serialization, and it aborts `request.signal`.<br>Explicit `v1/` paths need no exclude syntax (path-to-regexp changed in Nest 11), and they read the same in code, docs and logs. |
| D12 | **OpenAPI.**<br>- **Tooling:** `@nestjs/swagger` 11 with nestjs-zod DTOs (`createZodDto`, `@ZodResponse`) and `cleanupOpenApiDoc(doc, { version: "3.1" })`.<br>- **Serving:** the document is built lazily and served at `/docs` (Swagger UI) and `/docs/json`, only when `API_DOCS_ENABLED=true`. Production rejects that setting, so in production `/docs` doesn't exist at all (not "protected": no admin authentication exists yet).<br>- **Every operation documents:** `default` → `application/problem+json` (`ProblemDetails`), the `x-request-id` response header, and the `session` cookie scheme (except `@Public` routes).<br>- **CSP:** a relaxed policy applies to `/docs*` only (verify what swagger-ui-dist 5.32 needs). | One source for the contract: Zod schemas in `@finlytics/shared` drive validation, serialization and docs.<br>An unauthenticated schema endpoint in production maps our attack surface for anyone; staging also runs in production mode. |
| D13 | **Health, hand-rolled** (no @nestjs/terminus).<br>- **`GET /health/live`:** 200 `{ "status": "ok" }`, no I/O.<br>- **`GET /health/ready`:** `SELECT 1` (unscoped `$queryRaw`, 1 s timeout) and Redis `PING` (500 ms), in parallel. 200 with every check `up`; otherwise 503 with status `unavailable` or `draining`. In production it also stays 503 until the database role check (D14) has passed once.<br>- **Format:** plain `application/json`, not problem+json. No versions, hostnames, durations or error text.<br>- **Traffic:** not rate-limited, not access-logged, outside `/v1`, and never routed by the ingress (6.4). | Probes read only the status code.<br>Terminus would add a dependency for two pings, and its indicator payloads include error messages such as `connect ECONNREFUSED 10.x.x.x:5432`.<br>Liveness must never depend on shared services, or a database blip restarts every pod. |
| D14 | **Prisma in Nest.**<br>- **Client:** `PrismaService` builds one client with `createPrismaClient` from the validated environment (§4, review D1). It exposes:<br>  - `db`: the client extended with the **tenancy guard** (rules below)<br>  - `unscoped`: the base client. Lint allows it only in `src/infra/prisma`, `src/modules/auth` (session lookup by token) and `src/modules/health`.<br>- **Pool settings:** pool size; 5 s connect timeout; server-side `statement_timeout` 10 s; `idle_in_transaction_session_timeout` 15 s; `application_name`; interactive transactions `maxWait` 5 s and `timeout` 12 s.<br>- **Tenancy guard:** a `$extends` query extension.<br>  - On a model with a `userId` column, reads, updates and deletes must filter by `userId`, and creates must set it.<br>  - `User` is scoped by `id`. `AuditLog` is exempt (append-only).<br>  - A violation throws `TenancyViolationError` (500).<br>- **Audit:** explicit, through `AuditService.record(tx, …)` inside the mutation's transaction. No audit extension.<br>- **BigInt:** serialized as strings by a Fastify reply serializer, never by patching `BigInt.prototype`. Mappers convert explicitly as well.<br>- **Error recognition:** structural (`name` + `code`), never `instanceof` across package copies.<br>- **Production boot check:** the app refuses to start if its database role is a superuser or can `SET session_replication_role` (`has_parameter_privilege`, PostgreSQL ≥ 15). In development and test it only warns. | docs/01 and docs/06 list a "Prisma middleware" tenancy guard as a control. Prisma 7 removed `$use`, so it becomes a query extension (carry-forward §10.2). Raw SQL and nested writes aren't covered; code review and tests cover them.<br>Server-side timeouts cancel the work in Postgres; a client-side `query_timeout` leaves it running. A third-party report (unverified) says Prisma 7.10's client-side transaction timeout can return a connection mid-transaction, so transactions stay short and the server times out first.<br>The boot check enforces the outcome of F2 in production now, while the full role split stays in 2.1. |
| D15 | **Endpoints in 0.5:** `GET /health/live`, `GET /health/ready`, `/docs` and `/docs/json` (not in production), `GET /v1/me`, `GET /v1/me/settings`, `PATCH /v1/me/settings`, plus the test-only idempotency probe. Contracts in §6. | Settings is the smallest real consumer that exercises the session guard, CSRF, the per-user rate limit, the strict Zod pipe (`400 VALIDATION` with `errors[]`), a transaction with a row lock, the audit log and OpenAPI. It also closes the carry-forward note ("the api logs the issues in 0.5").<br>`GET /v1/me` is the "who am I" call that 0.6's end-to-end test uses to prove the cookie reaches the api.<br>Everything else waits for its own phase. |
| D16 | **Testing.**<br>- **Unit tests** (Vitest, no I/O) for every pure piece: env, `toProblem`, the GCRA model, fingerprints, CSRF, session rules, tenancy checks, serializers.<br>- **Integration tests** (`*.int.test.ts`) through Fastify `inject`, on an app built by the production bootstrap, against Testcontainers:<br>  - TimescaleDB from `@finlytics/database/testing` (pinned image, migrated, random password)<br>  - Redis 7.4 (`@testcontainers/redis`, random password, same image as compose)<br>- **Build smoke test:** runs `node dist/main.js` and stops it with SIGTERM.<br>- **Coverage gate:** 80% for lines, branches, functions and statements on unit-tested code. `src/infra`, `src/bootstrap`, repositories and controllers are integration-tested (reported, not gated). | testing.md: services ≥ 80%, Testcontainers for integration, no network in unit tests.<br>One bootstrap code path serves production and tests.<br>The database package's new `./testing` export shares one migrated-database helper with the api, without creating a workspace dependency cycle. |
| D17 | **Dependencies** (§2b).<br>- `@nestjs/*` core and `fastify` are pinned **exactly** (11.2.7 and 5.11.3). 5.11.3 is the version `@nestjs/platform-fastify` 11.2.7 itself pins, and a unit test asserts the two agree.<br>- Everything else uses a caret.<br>- The testcontainers trio and `fast-check` move into the pnpm catalog.<br>- No new package needs a build script. `@scarf/scarf` (an install-time telemetry script from swagger-ui-dist) goes to `ignoredBuiltDependencies`.<br>- Dependabot gets `nestjs`, `pino` and `testcontainers` groups and ignores `@nestjs/*` and `fastify` majors. | A caret on `@nestjs/platform-fastify` could pull in a newer fastify than the app's own, giving two copies and plugin type mismatches.<br>pnpm 10 requires every build script to be allowed or ignored explicitly. |
| D18 | **Not adopted now:**<br>- `@nestjs/terminus` (D13)<br>- `@nestjs/throttler` and `rate-limiter-flexible` (D7)<br>- `@nestjs/cli`, `@swc/*` and `unplugin-swc` (D1). unplugin-swc stays the fallback if the Oxc canary fails.<br>- `@nestjs/event-emitter`: registered with the first domain event, in 2.1<br>- `@nestjs/bullmq` / `bullmq`: arrive with the first queue. BullMQ's ioredis peer is `>=5`, so it will share ioredis 6.<br>- `@scalar/nestjs-api-reference`: it loads from a CDN, which our CSP forbids.<br>- `@opentelemetry/sdk-node`: 6.4. The hook point is a `src/telemetry.ts` that `main.ts` imports first. | Each one arrives with its first real use; installing them early only grows the audit surface. |
| D19 | **Carry-forward notes and review findings** (table below). | Every item is either done here or re-deferred with a phase. |

### Layout and lifecycle (D2)

```
apps/api/
  package.json  tsconfig.json  tsconfig.build.json  turbo.json  vitest.config.mts  vitest.integration.config.mts  README.md
  scripts/dev-session.mts        dev-only: creates a user + session in the local DB and prints the cookie (refuses otherwise)
  src/
    main.ts                      loadEnv → switch APP_ROLE → startHttp(env)
    app.module.ts                AppModule.forRoot(env, options?): global guards and interceptors, in order
    bootstrap/                   fastify-options.ts  http-app.ts (createHttpApp, configureHttpApp)  http-hardening.ts
                                 request-id.ts  client-ip.ts  reply-serializer.ts  openapi.ts
    config/                      env.schema.ts  env.ts (loadEnv, EnvError)  config.module.ts
    common/
      decorators/                public  skip-rate-limit  rate-limit  idempotent  current-user  request-meta
      guards/                    csrf.guard.ts
      filters/                   problem-details.filter.ts
      problem-json/              domain-errors.ts  to-problem.ts  field-errors.ts  known-errors.ts  text.ts
      pipes/                     zod-validation.pipe.ts
      logger/                    logger.module.ts  serializers.ts  redact-paths.ts
      rate-limit/                policies.ts  gcra.ts (TS model)  gcra.lua.ts  rate-limit.service.ts  rate-limit.guard.ts
                                 headers.ts  rate-limit.module.ts
      idempotency/               fingerprint.ts  idempotency.lua.ts  idempotency.store.ts  idempotency.interceptor.ts
                                 idempotency.module.ts
    infra/
      prisma/                    prisma.module.ts  prisma.service.ts  tenancy.extension.ts  user-owned-models.ts
                                 database-role.check.ts
      redis/                     redis.module.ts  redis.service.ts  keys.ts
      lifecycle/                 lifecycle.module.ts  readiness.state.ts
    modules/
      health/                    health.module.ts  health.controller.ts  health.service.ts
      auth/                      auth.module.ts  auth-identity.ts  session.repository.ts  session.service.ts
                                 session.guard.ts  auth.guard.ts
      users/                     users.module.ts  me.controller.ts  users.service.ts  users.repository.ts
                                 users.mapper.ts  dto/index.ts
      settings/                  settings.module.ts  settings.controller.ts  settings.service.ts
                                 settings.repository.ts  dto/index.ts
      audit/                     audit.module.ts  audit.service.ts  audit.repository.ts  audit-actions.ts
    (unit tests: __tests__/ next to the code)
  test/
    setup/reflect-metadata.ts
    unit/                        test-images.test.ts  fastify-version.test.ts
    integration/                 global-setup.ts  containers.ts  app.ts  fixtures.ts  log-capture.ts  *.int.test.ts
    support/                     idempotency-probe.controller.ts   (test-only; never compiled into dist)
```

**Boot**
1. `main.ts` calls `loadEnv(process.env)`. On an `EnvError` it prints one line per issue to stderr and exits 1.
2. `createHttpApp(env)` runs `NestFactory.create(AppModule.forRoot(env), new FastifyAdapter(fastifyOptions(env)), { bodyParser: false, bufferLogs: true })`, then `configureHttpApp(app, env)`.
3. In production, the database role check runs: up to 30 s of retries while the database is unreachable, exit 1 if the role is unsafe.
4. `app.listen({ host: API_HOST, port: API_PORT })`.
5. `enableShutdownHooks()`.

**Shutdown on SIGTERM**
1. `onModuleDestroy`: readiness switches to `draining`.
2. `beforeApplicationShutdown`: wait `API_SHUTDOWN_DRAIN_MS`.
3. Nest closes Fastify: new requests get 503 with `Connection: close`, in-flight requests finish, idle keep-alive sockets close.
4. `onApplicationShutdown`: `prisma.$disconnect()`, then `redis.quit()` (2 s, then `disconnect()`).
5. Exit 0.

In 6.4, Kubernetes' `terminationGracePeriodSeconds` must exceed drain + 15 s + a margin.

**Config files**

```jsonc
// apps/api/package.json (scripts and type)
{
  "name": "@finlytics/api", "private": true, "type": "commonjs", "engines": { "node": ">=24.11" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "node --env-file-if-exists=../../.env --enable-source-maps --watch dist/main.js",
    "dev:compile": "tsc -p tsconfig.build.json --watch --preserveWatchOutput",
    "start": "node --enable-source-maps dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "test": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.config.mts"
  }
}
// apps/api/tsconfig.json: typecheck, lint and editor (src, test, scripts and configs)
{ "extends": "../../packages/config/tsconfig/node.json",   // by workspace path, as in Phase 0
  "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext",
                       "experimentalDecorators": true, "emitDecoratorMetadata": true, "noEmit": true },
  "include": ["src", "test", "scripts", "vitest.config.mts", "vitest.integration.config.mts"] }
// apps/api/tsconfig.build.json: the emitted app. TS 6 changed rootDir's default, so set it.
{ "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist", "sourceMap": true },
  "include": ["src"], "exclude": ["src/**/__tests__/**"] }
// apps/api/turbo.json
{ "extends": ["//"], "tasks": {
    "dev": { "dependsOn": ["^build", "build"], "with": ["dev:compile"], "persistent": true, "cache": false },
    "dev:compile": { "persistent": true, "cache": false },
    "test:integration": { "dependsOn": ["$TURBO_EXTENDS$", "build"] } } }
```

```ts
// apps/api/vitest.config.mts: unit tests (no network, no containers)
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } }, // (verify the key name against Vite 8.3's OxcOptions)
  test: {
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    setupFiles: ["test/setup/reflect-metadata.ts"],
    environment: "node", unstubEnvs: true, restoreMocks: true,
    coverage: {
      provider: "v8", reporter: ["text", "json-summary"],
      include: ["src/common/**", "src/config/**", "src/modules/**"],
      exclude: ["**/__tests__/**", "**/*.module.ts", "**/dto/**", "**/*.repository.ts", "**/*.controller.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

### Environment variables (D3)

| Variable | Status | Type and rule | Default | Production rule |
|---|---|---|---|---|
| `NODE_ENV` | existing | `development`, `test` or `production` | `development` | — |
| `APP_ROLE` | new | `http` (1.4 adds `gateway` and `feed`, later `worker`) | `http` | — |
| `API_HOST` | new | IP or hostname | `127.0.0.1` | containers set `0.0.0.0` |
| `API_PORT` | new | integer 0–65535 (0 = any free port, used by tests) | `4000` | 1–65535 |
| `DATABASE_URL` | existing | `postgres://` or `postgresql://` URL; a `query_timeout` parameter is rejected | required | — |
| `DB_POOL_MAX` | existing | integer 1–100 | `10` | — |
| `DB_CONNECT_TIMEOUT_MS` | new | integer 100–60 000; the longest wait for a pooled or new connection | `5000` | — |
| `DB_STATEMENT_TIMEOUT_MS` | new | integer 100–14 000 (below the 15 s request timeout) | `10000` | — |
| `REDIS_URL` | existing | `redis://` or `rediss://` URL | required | — |
| `API_LOG_LEVEL` | new | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` | `info` (`silent` when `NODE_ENV=test`) | not `trace`, not `silent` |
| `API_LOG_FORMAT` | new | `json` or `pretty` | `pretty` in development, otherwise `json` | `json` |
| `API_TRUST_PROXY` | new | `false`, a hop count from 1 to 5, or comma-separated IPs/CIDRs. `true` is always rejected. | `false` | must be set explicitly |
| `API_ALLOWED_ORIGINS` | new | comma-separated origins (`scheme://host[:port]`, no path, no wildcard) | `http://localhost:3000` | required; `https://` only |
| `API_DOCS_ENABLED` | new | `true` or `false` | `true` | must be `false` |
| `API_SHUTDOWN_DRAIN_MS` | new | integer 0–30 000 | `0` | defaults to `5000` |
| `API_RATE_LIMIT_PUBLIC_PER_MIN` | new | integer 1–100 000 | `100` | — |
| `API_RATE_LIMIT_USER_PER_MIN` | new | integer 1–100 000 | `600` | — |
| `DEBUG` | documented only | — | unset | must be empty (F6) |

**Notes**
- The `DATABASE_URL`, `DB_*` and `DEBUG` rules live in `@finlytics/database`'s env schema too, so `getPrisma()` in the web app (0.6) applies them. The api schema reuses that package's shape.
- **Fixed in code, not configurable:**
  - body limit 1 MiB
  - handler and receive timeouts 15 s
  - session lifetimes: 7 days idle, 30 days absolute
  - idempotency TTLs: 30 s in flight, 24 h stored
  - cookie names, from `@finlytics/shared`
  - the `orders` policy: 10/s

Block for `.env.example`:

```dotenv
# ── apps/api (Phase 0.5). Values shown are the development defaults; production rules: docs/04 §7.
# Process role: http (1.4 adds gateway and feed).
APP_ROLE=http
# Bind address and port. Containers set API_HOST=0.0.0.0.
API_HOST=127.0.0.1
API_PORT=4000
# fatal | error | warn | info | debug | trace | silent   and   json | pretty (pretty is rejected in production)
API_LOG_LEVEL=info
API_LOG_FORMAT=pretty
# Proxies in front of the api: false, a hop count, or comma-separated IPs/CIDRs. Required in production; never true.
API_TRUST_PROXY=false
# Exact browser origins for CORS and the CSRF Origin check (comma-separated; https only in production).
API_ALLOWED_ORIGINS=http://localhost:3000
# Swagger UI at /docs and OpenAPI JSON at /docs/json (must be false in production).
API_DOCS_ENABLED=true
# How long readiness answers "draining" before the server stops accepting connections (production default 5000).
API_SHUTDOWN_DRAIN_MS=0
# Rate limits (token bucket): anonymous requests per IP per minute, signed-in requests per user per minute.
API_RATE_LIMIT_PUBLIC_PER_MIN=100
API_RATE_LIMIT_USER_PER_MIN=600
# pg pool: longest wait for a connection, and the server-side statement timeout (keep it below the 15 s request timeout).
DB_CONNECT_TIMEOUT_MS=5000
DB_STATEMENT_TIMEOUT_MS=10000
# DEBUG must stay unset in production: Prisma's and ioredis' debug output includes query parameters and command arguments.
```

### Request pipeline (D4–D11)

```
Fastify  onRequest    request id: inbound x-request-id if it matches REQUEST_ID_PATTERN, else a UUID; echoed as x-request-id
         (middie)     pino-http child logger bound to requestId (AsyncLocalStorage)
         parsing      application/json only, ≤ 1 MiB; otherwise 415 / 413 / 400 → ProblemDetailsFilter
Nest     guards       CsrfGuard → SessionGuard → RateLimitGuard → AuthGuard          (global, registration order)
         interceptors IdempotencyInterceptor (only @Idempotent) → ZodSerializerInterceptor
         pipes        ZodValidationPipe (strictSchemaDeclaration) → controller → service → repository
         errors       anything thrown anywhere → ProblemDetailsFilter → application/problem+json
Fastify  onSend       Cache-Control: no-store on /v1 and on problems; RateLimit headers set by the guard
         serializer   JSON with bigint → string
         timeout      handlerTimeout 15 s over the whole lifecycle → 503 SERVICE_UNAVAILABLE
```

| Control (D11) | Setting |
|---|---|
| Body | `bodyLimit` 1 048 576; `NestFactory.create(…, { bodyParser: false })` plus `removeContentTypeParser("text/plain")`, so only Fastify's built-in `application/json` parser remains. Form-encoded and text bodies get 415. |
| Timeouts | `handlerTimeout` 15 000 (Fastify ≥ 5.8: whole lifecycle, aborts `request.signal`, 503). `requestTimeout` 15 000 (time to receive the request). `keepAliveTimeout` 72 000 (the default, above typical load-balancer idle timeouts). |
| Proxy | `trustProxy` from `API_TRUST_PROXY` (hop count or CIDRs). Fastify uses the rightmost untrusted `X-Forwarded-For` address. |
| Request id | `requestIdHeader: false`. `genReqId(raw)` keeps an inbound id only if it matches `REQUEST_ID_PATTERN`. |
| Router | `maxParamLength` 512 (URL-encoded instrument keys are at most 128 characters before encoding), case-sensitive, no trailing-slash folding. Whether these sit at the top level or under `routerOptions` depends on the version (verify). |
| JSON safety | `onProtoPoisoning` and `onConstructorPoisoning`: `error`. |
| Headers | `@fastify/helmet`: CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (relaxed only for `/docs*`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CORP `same-site`. HSTS `max-age=31536000; includeSubDomains` in production only. Fastify sends no `X-Powered-By`; a test asserts that. |
| CORS | Nest `enableCors` (the @fastify/cors 11.3.0 bundled with platform-fastify): exact-match origins from `API_ALLOWED_ORIGINS`, `credentials: true`, methods GET/POST/PUT/PATCH/DELETE, allowed headers `content-type, idempotency-key, x-request-id`, exposed `x-request-id, retry-after, ratelimit, ratelimit-policy, idempotent-replayed`, `maxAge` 600. |
| Caching | `Cache-Control: no-store` on every `/v1` response, every problem and every health response. |
| Routes | A test asserts that every registered route is `/v1/…`, `/health/…` or `/docs…`. |

### Error mapping (D4)

| Thrown | Code (status) | `detail` | Logged as |
|---|---|---|---|
| `DomainError` subclass | its code | the error's curated text | 4xx info; 5xx error |
| `ZodValidationException`, converted by the pipe's `createValidationException` | `VALIDATION` (400), with `errors[]`: Zod issues as react-hook-form dot paths, the first 100 | "The request is invalid." | info; issue paths and codes only |
| `ZodSerializationException` (a response failed its schema) | `INTERNAL` | — | error; issue paths only (`reportInput` stays off) |
| Fastify `FST_ERR_CTP_BODY_TOO_LARGE` | `PAYLOAD_TOO_LARGE` (413) | "The request body exceeds 1 MiB." | info |
| `FST_ERR_CTP_INVALID_MEDIA_TYPE` | `UNSUPPORTED_MEDIA_TYPE` (415) | "Send request bodies as application/json." | info |
| Empty or malformed JSON, a bad `Content-Length`, proto poisoning (verify the exact `FST_ERR_*` codes) | `VALIDATION` (400) | "The request body is not valid JSON." | info |
| `NotFoundException` from Nest's router (unknown route) | `NOT_FOUND` (404) | — (its message echoes the URL, query string included) | debug |
| Fastify handler timeout (verify the code) | `SERVICE_UNAVAILABLE` (503), `Retry-After: 5` | "The request took too long." | warn |
| Other Nest `HttpException` | by status: 400 `VALIDATION`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 413, 415, 429 `RATE_LIMITED`, 503 `SERVICE_UNAVAILABLE`; any other 4xx `VALIDATION`, 5xx `INTERNAL` | never the exception's message | info / error |
| Prisma known request error P2002 | `CONFLICT` | "A record with these values already exists." | info; code and model |
| P2025 | `NOT_FOUND` | — | info |
| P2003 | `CONFLICT` | "This record is still referenced." | info |
| P2034 (write conflict or deadlock) | `SERVICE_UNAVAILABLE`, `Retry-After: 1` | — | warn |
| P1001, P1002, P1008, P1017, P2024, P2028, `PrismaClientInitializationError`, a pool acquire timeout, SQLSTATE 57014 (statement timeout), 53300, 57P01 | `SERVICE_UNAVAILABLE`, `Retry-After: 5` | — | error; name, code, SQLSTATE |
| `PrismaClientValidationError` | `INTERNAL` | — | error; **name only** (its message contains argument values) |
| Other Prisma errors | `INTERNAL` | — | error; name and code |
| ioredis connection, offline-queue and command-timeout errors | `SERVICE_UNAVAILABLE`, `Retry-After: 5` | — | warn; name only, never `command.args` |
| `TenancyViolationError` | `INTERNAL` | — | error; model and operation |
| Anything else | `INTERNAL` | — | error; pino's standard `err` (name, message, stack) |

**Recognition and fallback**
- Prisma and Fastify errors are recognised structurally: Prisma by `name` and a `P\d{4}` code, Fastify by `code`.
- A database outage never yields 401, because the web app signs the user out on 401.
- The fallback problem is `{ type, title, status: 500, code: "INTERNAL", requestId }`, which always validates.

### Rate limiting (D7)

| Policy | Key | Limit (burst = limit) | Applied to | When Redis fails |
|---|---|---|---|---|
| `public` | `rl:public:ip:<ip>`: IPv4, or the IPv6 /64; IPv4-mapped addresses become IPv4 | `API_RATE_LIMIT_PUBLIC_PER_MIN` (100) per minute | requests without a valid session; failed session lookups (charged once) | fail open, warn every 10 s at most |
| `user` | `rl:user:u:<userId>` | `API_RATE_LIMIT_USER_PER_MIN` (600) per minute | authenticated requests | fail open |
| `orders` | `rl:orders:u:<userId>` | 10 per second (declared now, unused until 2.1) | `@RateLimit("orders")` | fail closed: 503 `SERVICE_UNAVAILABLE` |

```lua
-- gcra.lua.ts. KEYS[1]: rl:<policy>:<subject>; ARGV: emission interval ms (period / limit), burst, cost.
-- Returns { allowed (1 or 0), remaining, retryAfterMs, resetAfterMs }. Uses the Redis clock, never the pod's.
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local interval, burst, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local tat = math.max(tonumber(redis.call('GET', KEYS[1]) or now), now)
local newTat = tat + interval * cost
local allowAt = newTat - interval * burst
if now < allowAt then
  return { 0, 0, math.ceil(allowAt - now), math.ceil(tat - now) }
end
redis.call('SET', KEYS[1], newTat, 'PX', math.max(1, math.ceil(newTat - now)))
return { 1, math.floor((now - allowAt) / interval), 0, math.ceil(newTat - now) }
```

**Headers and testing**
- `gcra.ts` is the same algorithm as a pure TypeScript function. Property tests run against it; integration tests check the Lua script's behaviour.
- `RateLimit: "user";r=<remaining>;t=<ceil(resetAfterMs/1000)>`.
- A 429 also sends `Retry-After: <ceil(retryAfterMs/1000)>` and the same value in `retryAfterSec`.

### Idempotency (D8)

| Situation | Response |
|---|---|
| `Idempotency-Key` missing or malformed on an `@Idempotent` route | 400 `VALIDATION`, detail "Send an Idempotency-Key header (16–128 letters, digits, '-' or '_')." |
| First request | Runs. A 2xx is stored for 24 h (status + body ≤ 64 KiB); any error releases the key. |
| Same key, same fingerprint, completed | The original status and body, plus `Idempotent-Replayed: true`. The handler doesn't run. |
| Same key, original still in flight | 409 `IDEMPOTENT_REPLAY` (no `Retry-After`) |
| Same key, different fingerprint (method, path + query, canonical JSON body) | 400 `VALIDATION` with field error `{ path: "", code: "idempotency_key_reused" }`. The expired IETF draft uses 422, but our 422 codes are reserved for trading rejections. |
| Different user, same key | Independent: the key is `idem:<userId>:<key>`. |
| Redis unavailable | 503 `SERVICE_UNAVAILABLE`, `Retry-After: 5`: fail closed |
| Handler still running after the 15 s timeout | The client already got 503. The record stays in flight (lock ≤ 30 s) until the handler settles, then it is stored or released. |

```lua
-- idempotency.lua.ts: finalize (store) and release (delete), only while this request still owns the key.
-- KEYS[1]: idem:<userId>:<key>; ARGV[1]: this request's exact in-flight marker; ARGV[2]: record; ARGV[3]: ttl ms
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) return 1 end
return 0
-- release: if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0
```

### Session contract (D9)

**Cookie**
- The name comes from `@finlytics/shared`: `authjs.session-token` in development and test, `__Host-authjs.session-token` in production.
- Only Auth.js sets it; the api never sets cookies.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, `Secure` in production.

**Token**
- Opaque and must match `SESSION_TOKEN_PATTERN`. Auth.js's default, `randomUUID()`, does.
- `Session.sessionToken` stores the lowercase hex SHA-256 of the token. In 0.6, Auth.js's Prisma adapter is wrapped to do this (§10.1).

**A session is valid when all of these hold**
- The row exists, and `expires > now` (Auth.js's rolling expiry).
- `lastSeenAt` is less than 7 days old (idle limit).
- `createdAt` is less than 30 days old (absolute limit; the column is new, §4).
- `User.deletedAt IS NULL`.

**Not checked:** `lockedUntil`. Lockout protects sign-in; checking it here would let an attacker sign a victim out by failing logins on purpose.

**What each side writes**
- The api writes only `lastSeenAt`: best effort, at most every 5 minutes (`updateMany … where lastSeenAt < now − 5 min`, scoped by `userId`).
- Auth.js owns creating sessions, extending `expires`, and deleting sessions (sign-out).

**Identity:** `request.identity = { userId, sessionId, role }` (Fastify `decorateRequest("identity", null)`), read with `@CurrentUser()`.

### Redis key namespaces (D6)

| Key | Type | TTL | Owner (phase) |
|---|---|---|---|
| `rl:<policy>:ip:<ip>`, `rl:<policy>:u:<userId>` | string (GCRA TAT in ms) | ≤ the policy period | rate limiting (0.5) |
| `idem:<userId>:<key>` | string (JSON marker or record) | 30 s in flight, 24 h stored | idempotency (0.5) |
| `quote:<instrumentKey>` | hash | none (overwritten) | market feed (1.4) |
| `q:<instrumentKey>` | pub/sub channel | — | tick fan-out (1.4) |
| `ticks:<broker>` | stream (`MAXLEN ~`) | — | feed (1.4) |
| `subs:<instrumentKey>` | counter | 30 s grace at zero | subscriptions (1.4) |
| `lease:feed:<broker>` | string | the lease | feed leader (1.4) |
| `bull:<queue>:*` | BullMQ | BullMQ | jobs (later) |

Rules:
- Segments are separated by `:`. User ids are cuids, instrument keys contain no `:`, and `IdempotencyKeySchema` forbids `:`.
- Every key is built in `infra/redis/keys.ts`.
- No `KEYS` and no unbounded `SCAN` on the request path.

### Carry-forward notes and review findings (D19)

| Item | Source | Decision | PR |
|---|---|---|---|
| `AuditLog.actorId` | Phase 0 §10.2 | **Included.**<br>- Nullable `actorId` plus an index on `(actorId, createdAt DESC)`.<br>- Two `NOT VALID` CHECKs: `actorType` must be user, admin, system or agent; `actorId` is required unless `actorType` is `system` (§4).<br>- `AuditService` writes it. | PR2, PR9 |
| Redis idempotency key | §10.2 | **Included:** `idem:<userId>:<key>` (D8) | PR8 |
| BigInt as strings | §10.2 | **Included:** a global reply serializer, explicit mappers and a test (D14) | PR4 |
| Log the settings parser's issues | §10.2 | **Included:** `GET /v1/me/settings` logs the repaired paths at `warn` | PR9 |
| `$extends`, never `$use` | §10.2 | **Included:**<br>- The tenancy guard is a query extension.<br>- docs/01 is reworded.<br>- No audit extension. | PR5 |
| Database role split (security F2) | §10.4 | **Stays in 2.1.** Meanwhile 0.5:<br>- adds the production boot check (refuse to start if the role is a superuser or can SET `session_replication_role`)<br>- sets `statement_timeout` per connection until the role carries it | PR5 |
| F5: query logging in object form | review | **Included:** `log` entries must be the strings `info`, `warn` or `error`. Anything else throws, including `{ level: "query", emit: "event" }`. | PR2 |
| F6: `DEBUG` in production | review | **Included:** `DEBUG` must be empty when `NODE_ENV=production`, in both the database and api env schemas | PR2, PR3 |
| F7/S5: problem consistency and bounds | review | **Included** (D4, §5) | PR1 |
| Review D1: pool timeouts | review | **Included:**<br>- connect timeout 5 s, `statement_timeout` 10 s, `idle_in_transaction_session_timeout` 15 s<br>- `application_name`<br>- transactions: `maxWait` 5 s, `timeout` 12 s<br>- no client-side `query_timeout`; `DATABASE_URL` rejects it<br>The role-level setting comes with the 2.1 split. | PR2 |
| Review D6: env messages and URL scheme | review | **Included:**<br>- every issue reads `VARIABLE: reason`, without values<br>- `DATABASE_URL` must use `postgres:` or `postgresql:` | PR2 |
| Review D7: two pools (ESM + CJS) | review | **Included:** `getPrisma()` caches on `Symbol.for("@finlytics/database/prisma")` in every environment | PR2 |
| Testcontainers: static password, ports on 0.0.0.0 | review | **Password fixed; port binding accepted as residual risk.**<br>- A random password per run, for both Postgres and Redis.<br>- testcontainers-node can't narrow the host binding (verify). That is accepted: each container lives for one run. | PR2, PR5 |
| `PrismaClientValidationError.message` | review | **Included:** mapped to `INTERNAL` and logged by name only, in both the filter and the `err` serializer | PR4 |
| 0.6 notes (email case, OAuth tokens, `Role`, edge middleware) | §10.3 | **Unchanged:** they stay in 0.6, alongside §10.1 below. | — |

## 2b. Verified versions & facts (2026-10-05/06)

| Package | Pin | Note |
|---|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`, `@nestjs/testing` | **11.2.7 exact** | Nest 12.1.2 is npm `latest`; we stay on 11 (A4). core and common have no install scripts. platform-fastify 11.2.7 depends on fastify **5.11.3**, @fastify/cors 11.3.0 and @fastify/middie 9.3.4 (exact pins), and has an optional peer on @fastify/static ^10.1.2. |
| `fastify` | **5.11.3 exact** | Used only for types and `setReplySerializer`. Must equal platform-fastify's dependency; a unit test checks. |
| `@nestjs/config` | ^4.0.4 | The Nest 11 line (there is no 11.x). |
| `@nestjs/swagger` | ^11.4.7 | Depends on swagger-ui-dist 5.32.13, which depends on `@scarf/scarf` =1.4.0 (an install-time telemetry script, ignored). |
| `@fastify/helmet` / `@fastify/cookie` / `@fastify/static` | ^13.1.1 / ^11.1.2 / ^10.1.5 | Their dependencies are helmet ^8 or cookie ^2, plus fastify-plugin ^6. None depends on fastify itself, so no second copy. |
| `nestjs-zod` | ^5.5.0 | Peers: zod ^3.25 ‖ ^4, rxjs ^7, @nestjs/common ^10 ‖ ^11, @nestjs/swagger ^7.4.2 ‖ ^8 ‖ ^11 (optional). Ships ESM and CJS. |
| `nestjs-pino` / `pino` / `pino-http` / `pino-pretty` | ^5.3.1 / ^10.4.0 / ^11.0.0 / ^13.2.0 (dev) | nestjs-pino 5 needs Node ≥ 22.12 and Nest ≥ 11.0.8. |
| `ioredis` | ^6.0.0 | Node ≥ 20; RESP3 by default (`protocol: 2` restores the v5 wire protocol); CommonJS. |
| `reflect-metadata` / `rxjs` | ^0.2.2 / ^7.8.2 | Nest peers. |
| `testcontainers`, `@testcontainers/postgresql`, `@testcontainers/redis` | ^12.2.0 (catalog) | `new RedisContainer(image).withPassword(pw).start()`, then `getConnectionUrl()`. |
| `fast-check` | ^4.10.2 (catalog) | Property tests in shared and api. |
| typescript, zod, vitest, @vitest/coverage-v8, @types/node | catalog | Vitest 5.0.3 runs on the installed Vite 8.3.2 (Rolldown/Oxc). |

**TypeScript 6.0**
- `--moduleResolution node` (node10) is deprecated. `bundler` may now be paired with `--module commonjs`; for Node, the docs point at `nodenext`.
- Changed defaults: `strict: true`, `module: esnext`, `types: []`, `rootDir` = the tsconfig's folder, `noUncheckedSideEffectImports: true`. So `tsconfig.build.json` sets `rootDir: "src"`, and the node preset already sets `types`.
- The release notes don't mention `experimentalDecorators` or `emitDecoratorMetadata`; neither is deprecated.

**typescript-eslint**
- `consistent-type-imports` skips files that contain decorators when both decorator options are on, reading them from tsconfig under type-aware linting. So `--fix` never turns an injected class into `import type`, which would break dependency injection.
- `no-extraneous-class` accepts `allowWithDecorator`, for `@Module()` classes.

**Vite 8 and Oxc**
- Vite 8 has "built-in automatic support for TypeScript's emitDecoratorMetadata option".
- Oxc's options are `decorator.legacy` and `decorator.emitDecoratorMetadata`.
- When Oxc can't infer a type, it falls back to `Object`. So injected classes must be value imports; TS1272 under `isolatedModules` enforces the converse for interfaces.
- nestjs/event-emitter's own Vitest config enables Oxc decorators but spells the key `decorators`; let the config typecheck decide the spelling (verify).

**Fastify 5**
- `handlerTimeout` (since 5.8.0): a timeout over the whole route lifecycle. It sends 503 and aborts `request.signal`, and it is cooperative: the handler keeps running. The 503 goes through the error handler.
- Defaults: `requestIdHeader: false`, `bodyLimit` 1 MiB, `requestTimeout` 0, `connectionTimeout` 0, `keepAliveTimeout` 72 s, `return503OnClosing: true`, `forceCloseConnections: "idle"`, `maxParamLength` 100.
- `trustProxy` accepts `true`, a hop count, IPs/CIDRs or a function.
- `genReqId(rawReq)` is called whenever the id header isn't used.

**Nest's Fastify adapter and runtime**
- The adapter spreads its options into `fastify()`.
- With body parsing on, it registers a JSON parser and a urlencoded parser (fast-querystring). With `bodyParser: false`, only Fastify's built-in JSON and text/plain parsers remain. (Read in the 11.1.6 source; verify on 11.2.7.)
- The router's not-found handler throws `NotFoundException("Cannot <METHOD> <url>")`.
- Shutdown hooks run in this order: `onModuleDestroy` → `beforeApplicationShutdown` → connections close → `onApplicationShutdown`.
- Multiple `APP_GUARD` providers run in registration order.
- `StandardSchemaValidationPipe` exists only in Nest 12.

**nestjs-pino 5 and pino 10**
- With Fastify, `genReqId` belongs on the adapter.
- pino-http keeps an existing `req.id`, and AsyncLocalStorage binds it for every `Logger` and `PinoLogger` call during the request.
- Redaction uses fast-redact: dot and bracket paths, `*` wildcards at fixed depths, about 2% overhead (more with wildcards).

**@nestjs/config 4**
- `get()` reads internal configuration first, then the validated environment, then `process.env`.
- `skipProcessEnv`, `validatePredefined` and `ignoreEnvFile` exist.

**Prisma 7 with adapter-pg**
- `pg` owns pooling: `max` 10, `connectionTimeoutMillis` 0 (wait forever), `idleTimeoutMillis` 10 s.
- v6's `pool_timeout` and `connect_timeout` map to `connectionTimeoutMillis`.

**Standards drafts**
- **draft-ietf-httpapi-ratelimit-headers-11** (May 2026):
  - structured fields: `RateLimit-Policy: "name";q=…;w=…` and `RateLimit: "name";r=…;t=…`
  - `Retry-After` takes precedence
  - partition keys shouldn't carry sensitive information
- **draft-ietf-httpapi-idempotency-key-header-07** expired without becoming an RFC. Its status codes: 400 for a missing key, 409 for a concurrent request, 422 for a different payload.

**Other**
- Turborepo has `with` (sidecar tasks) since 2.5.
- rate-limiter-flexible 11.2.1 uses a fixed window and has no dependencies. Its token-bucket substitute is `BurstyRateLimiter`.
- @nestjs/cli 11.0.24 depends on webpack 5.106, @angular-devkit 19.2, fork-ts-checker 9 and typescript 5.9.3.
- @swc/core 1.16.13 has a `postinstall` script.
- BullMQ 6.3.11 declares ioredis `>=5.0.0` as an optional peer.
- testcontainers-node maps ports to random host ports and offers no host-IP binding option (verify).

## 3. Files to create / modify

**Root**
- `pnpm-workspace.yaml`
  - catalog: `testcontainers`, `@testcontainers/postgresql`, `@testcontainers/redis` (^12.2.0), `fast-check` (^4.10.2)
  - `ignoredBuiltDependencies`: add `@scarf/scarf`, with a comment
- `eslint.config.mjs`: a `finlytics/scope/nest` block for `apps/api/**`, after the `node` block.
- `.github/workflows/ci.yml`: the integration job runs `docker compose pull --quiet postgres redis`.
- `.github/dependabot.yml`
  - groups: `nestjs` (`@nestjs/*`, `fastify`, `@fastify/*`, `nestjs-zod`, `nestjs-pino`), `pino` (`pino`, `pino-*`), `testcontainers` (`testcontainers`, `@testcontainers/*`)
  - ignore semver-major updates of `@nestjs/*` and `fastify`
- No change: `package.json`, `turbo.json` (apps/api extends it), `.prettierignore` (`dist` and `coverage` already match), `docker-compose.yml`, and `CLAUDE.md` (`pnpm dev` already starts the api on :4000; no command changes).

**packages/config**
- `eslint-config/node.js`: export the Node built-in restriction list.
  - Why: a later `no-restricted-imports` entry *replaces* earlier options instead of merging them, so the nest preset must repeat the list.
- `eslint-config/nest.js` (new):
  - `@typescript-eslint/no-extraneous-class` with `allowWithDecorator`
  - `no-console`
  - restricted imports: the Node built-ins; `@prisma/*` and `prisma` ("import from @finlytics/database"); deep `@finlytics/*/src` and `@finlytics/*/dist` paths
  - `no-restricted-properties` for `process.env`; off in `src/config/**`, `src/main.ts`, `scripts/**`, `test/**` and `*.config.mts`
  - `no-restricted-syntax` on `MemberExpression[property.name='unscoped']`; off in `src/infra/prisma/**`, `src/modules/auth/**` and `src/modules/health/**`
- `eslint-config/package.json`: export `./nest` and add it to `files`.

**packages/shared** (PR1)
- `src/schemas/errors.ts`: the three codes, `REQUEST_ID_PATTERN`, `PROBLEM_LIMITS`, the bounded and refined `ProblemDetailsSchema`, and `SERVICE_UNAVAILABLE` added to the retryable codes.
- New schema files: `src/schemas/http.ts`, `src/schemas/session.ts`, `src/schemas/me.ts`, `src/schemas/health.ts`.
- `src/index.ts`: exports, by name. `README.md`: the new contracts.
- Tests: `src/__tests__/{errors,http,session,me,health}.test.ts` and `errors.property.test.ts`.

**packages/database** (PR2)
- Schema and migrations:
  - `prisma/schema.prisma` (§4)
  - `prisma/migrations/<ts>_audit_actor_and_session_created_at/migration.sql` (generated)
  - `prisma/migrations/<ts>_audit_actor_checks/migration.sql` (hand-written)
- `src/client.ts`: F5, the review D1 options, review D7.
- `src/env.ts`: review D6, F6 and the two `DB_*` variables. It exports `databaseEnvShape` and `checkDatabaseEnv` for the api schema; plain `.extend()` throws in Zod 4 on an object schema with refinements (verify).
- `src/index.ts`: the new option types.
- `src/testing/{index.ts, images.ts, postgres.ts, prisma-cli.ts, process.ts}` (new):
  - moved from `test/integration/database-admin.ts` and `test/integration/timescale-image.ts`, which are deleted
  - a random password per container
  - `startTestDatabase({ migrate })` returns `{ adminUrl, databaseUrl, shadowDatabaseUrl, stop() }`
  - `TIMESCALE_IMAGE`
- Existing tests:
  - `test/integration/{global-setup.ts, harness.ts}` and every `*.int.test.ts`: imports updated
  - `guards.int.test.ts`: the actor checks
  - `constraints.int.test.ts`: the `Session.createdAt` default
  - `src/__tests__/{client, env, migrations-layout, timescale-image}.test.ts`: updated
- Build and packaging:
  - `tsdown.config.ts`: entries `index` and `testing`; `shims` for `import.meta.url` in the CJS build (verify)
  - `package.json`: `exports["./testing"]`; optional peer dependencies on `testcontainers` and `@testcontainers/postgresql`; catalog references
  - `test/pkg/{smoke.mjs, smoke.cjs}`: load the `testing` entry without starting a container

**apps/api** (new; PR3–PR10). Every file in the D2 tree.
- `scripts/dev-session.mts` creates a user and a session in the local database and prints a cookie, for manual testing before 0.6.
- It refuses to run unless `NODE_ENV=development` and `DATABASE_URL` points at `localhost` or `127.0.0.1`.
- It runs with Node 24's type stripping.

**Docs**
- `docs/01-ARCHITECTURE.md`:
  - "Prisma middleware" becomes the `$extends` tenancy guard and the `unscoped` allowlist
  - the Redis key namespaces
  - one-origin routing (`/v1`, `/rt`)
- `docs/02-FOLDER-STRUCTURE.md`:
  - the apps/api tree (`bootstrap/`, the `common/` subfolders, `test/`, `scripts/`)
  - `packages/database/src/testing/`
  - drop the `apps/api/prisma →` line
- `docs/03-DATABASE-SCHEMA.md`: the two migrations, `Session.createdAt`, `AuditLog.actorId` and its CHECKs, connection timeouts.
- `docs/04-API-DESIGN.md`:
  - Health row: `/health/live`, `/health/ready`; `/metrics` moves to 6.4, on an internal port
  - the `GET /v1/me` shape
  - §6: the three codes, the bounds, the retryable list
  - a new §7, "HTTP conventions": request ids, cookies, CSRF, JSON-only bodies, rate-limit headers, idempotency semantics, `Cache-Control`, timeouts, versioning, production environment rules
- `docs/06-SECURITY.md`: the CSRF row, the session contract, rate limiting (algorithm; fail open or closed), trusted proxies, the idempotency principle, the F2 interim boot check, serializers and redaction.
- `docs/09-CLAUDE-CODE-WORKFLOW.md`: a pointer to the api's variables in `.env.example`.
- `.claude/skills/nest-module/SKILL.md` (needs approval):
  - no generator: copy the template
  - guards are global, opt out with `@Public()`
  - `@Idempotent()`, `@RateLimit()`, `this.prisma.db`
  - `pnpm --filter @finlytics/api …`

## 4. Prisma changes & custom SQL

```diff
 model Session {
   id           String   @id @default(cuid())
-  sessionToken String   @unique
+  sessionToken String   @unique // SHA-256 (hex) of the cookie token, never the token itself (docs/06)
   userId       String
   expires      DateTime
   ip           String?
   userAgent    String?
   lastSeenAt   DateTime @default(now())
+  createdAt    DateTime @default(now()) // the api enforces the 30-day absolute lifetime from this column
   user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
 }
 model AuditLog {
   id         BigInt   @id @default(autoincrement())
-  userId     String?
-  actorType  String // user | system | agent | admin
+  userId     String? // subject: whose data the action concerns
+  actorType  String // user | admin | system | agent (CHECK in migrations/<ts>_audit_actor_checks)
+  actorId    String? // who acted (user, admin or agent-run id); null only for system (CHECK)
   ...
   @@index([userId, createdAt(sort: Desc)])
   @@index([action, createdAt(sort: Desc)])
+  @@index([actorId, createdAt(sort: Desc)])
 }
```

**`<ts>_audit_actor_and_session_created_at/migration.sql`** is generated with `--create-only`. Then make it idempotent by hand: a partial failure can then be re-applied, and the drift check still exits 0.

```sql
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorId" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);
```

- **AuditLog:** adding a nullable column without a default changes only the catalog. No row is touched and no row trigger fires. The `ENABLE ALWAYS` guard triggers keep their mode, because nothing re-creates them.
- **Session:** `CURRENT_TIMESTAMP` is stable, so PostgreSQL ≥ 11 adds the column without rewriting the table. Any existing rows get the migration time.

**`<ts>_audit_actor_checks/migration.sql`** is hand-written and idempotent.

```sql
-- AuditLog actor guards. Prisma never generates CHECK constraints and ignores them when diffing (no drift).
-- NOT VALID: every new row is checked, existing rows are not. AuditLog is append-only, so a historical row could never be
-- corrected anyway. Every statement is idempotent: Prisma >= 7.4 runs migration.sql statement by statement.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorType_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorType_check"
  CHECK ("actorType" IN ('user', 'admin', 'system', 'agent')) NOT VALID;
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorId_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_check"
  CHECK ("actorType" = 'system' OR "actorId" IS NOT NULL) NOT VALID;
```

**Builder sequence for PR2**
1. `pnpm db:status` must report the five existing migrations as up to date.
2. Make the schema edits above.
3. Create the generated migration:
   - `pnpm db:migrate --create-only --name audit_actor_and_session_created_at`
   - check the SQL contains exactly the three statements above, and add `IF NOT EXISTS`
   - `pnpm db:migrate`
4. Create the hand-written migration:
   - `pnpm db:migrate --create-only --name audit_actor_checks` creates an empty migration
   - write the SQL above
   - `pnpm db:migrate`
5. Run `pnpm db:status`, then the drift check with the shadow URL inline, as in Phase 0 §4 step 7 (create `finlytics_shadow` first if it no longer exists). It must exit 0:
   `SHADOW_DATABASE_URL=postgresql://finlytics:finlytics@localhost:5433/finlytics_shadow pnpm --filter @finlytics/database exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`
6. If a migration fails partway:
   - fix the SQL
   - `prisma migrate resolve --rolled-back <name>`
   - re-apply
   - never `migrate reset` or `db push` (the project hook blocks both)
7. Update `migrations-layout.test.ts` to seven folders in order, and update docs/03.

**`createPrismaClient`** (review D1, F5, review D7). The options added:
- `connectTimeoutMs` (default 5000) → pg `connectionTimeoutMillis`
- `statementTimeoutMs` (10000) → `statement_timeout`
- `idleInTransactionTimeoutMs` (15000) → `idle_in_transaction_session_timeout`
- `applicationName` → `application_name`
- `transaction: { maxWaitMs = 5000, timeoutMs = 12000 }` → Prisma `transactionOptions`

`log` accepts only the strings `info`, `warn` and `error`. `getPrisma()` always caches on the registered symbol.

## 5. Zod schemas & helpers (`packages/shared`)

```ts
// schemas/errors.ts (changes). The client-side isProblemDetails stays tolerant and unchanged.
ERROR_CODES += "PAYLOAD_TOO_LARGE" (413, "Payload too large"), "UNSUPPORTED_MEDIA_TYPE" (415, "Unsupported media type"),
               "SERVICE_UNAVAILABLE" (503, "Service unavailable")
RETRYABLE_ERROR_CODES = ["RATE_LIMITED", "BROKER_UNAVAILABLE", "SERVICE_UNAVAILABLE"]
REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/
PROBLEM_LIMITS = { detail: 500, instance: 512, fieldPath: 256, fieldMessage: 300, fieldCode: 64,
                   brokerCode: 64, brokerMessage: 500, retryAfterSec: 86_400 }
singleLine(max) = z.string().min(1).max(max).regex(/^[^\u0000-\u001F\u007F]+$/)    // no CR, LF or control characters
FieldErrorSchema = z.strictObject({ path: z.string().max(256) (no control chars, "" allowed),
                                    message: singleLine(300), code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional() })
ProblemDetailsSchema = z.strictObject({
  type, title, status, code,
  detail: singleLine(500).optional(),
  instance: z.string().max(512).regex(/^\/[^\s?#]*$/).optional(),   // path only: no scheme, host, query or fragment
  requestId: z.string().regex(REQUEST_ID_PATTERN),
  errors: z.array(FieldErrorSchema).max(MAX_FIELD_ERRORS).optional(),
  broker: z.strictObject({ code: singleLine(64), message: singleLine(500).optional() }).optional(),
  retryAfterSec: z.int().min(0).max(86_400).optional(),
}).superRefine(/* status === ERROR_HTTP_STATUS[code], title === ERROR_TITLES[code], type === problemTypeUrl(code) */)

// schemas/http.ts (new)
HEADERS = { requestId: "x-request-id", idempotencyKey: "idempotency-key", idempotentReplayed: "idempotent-replayed",
            retryAfter: "retry-after", rateLimit: "ratelimit", rateLimitPolicy: "ratelimit-policy" } as const
IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)   // crypto.randomUUID() fits; never ':'
RequestIdSchema = z.string().regex(REQUEST_ID_PATTERN)

// schemas/session.ts (new). The cross-app contract between Auth.js (web) and the api.
SESSION_COOKIE_NAME = { development: "authjs.session-token", test: "authjs.session-token",
                        production: "__Host-authjs.session-token" } as const
SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
SESSION_LIMITS = { idleDays: 7, absoluteDays: 30, lastSeenWriteIntervalSec: 300 } as const

// schemas/me.ts (new). GET /v1/me. Output is not re-validated as an email, so an unusual OAuth address can't fail it.
MeSchema = z.strictObject({ id: z.string().min(1), email: z.string().min(1), name: z.string().nullable(),
                            image: z.string().nullable(), timezone: z.string().min(1), createdAt: z.iso.datetime() })

// schemas/health.ts (new)
HealthLiveSchema = z.strictObject({ status: z.literal("ok") })
HealthReadySchema = z.strictObject({ status: z.enum(["ok", "unavailable", "draining"]),
  checks: z.strictObject({ database: z.enum(["up", "down"]), redis: z.enum(["up", "down"]) }) })
```

`UserSettingsSchema`, `UserSettingsPatchSchema`, `parseUserSettingsWithIssues` and `mergeUserSettings` are used unchanged.

## 6. Contracts

**REST** (all JSON; errors are problem+json per §2)

| Method & path | Auth | Request | Success | Errors | Notes |
|---|---|---|---|---|---|
| `GET /health/live` | public, not rate-limited | — | 200 `HealthLive` | — | No I/O; not under `/v1` |
| `GET /health/ready` | public, not rate-limited | — | 200 `HealthReady` | 503 `HealthReady` (plain JSON) | DB 1 s and Redis 0.5 s checks; `draining` during shutdown |
| `GET /docs`, `GET /docs/json` | public | — | 200 HTML / OpenAPI 3.1 | 404 in production | Only when `API_DOCS_ENABLED` |
| `GET /v1/me` | session | — | 200 `Me` | 401, 429, 503 | Whoami for 0.6 |
| `GET /v1/me/settings` | session | — | 200 `UserSettings` | 401, 429, 503 | Lenient read; repaired fields logged at `warn` |
| `PATCH /v1/me/settings` | session + CSRF | `UserSettingsPatch`, `application/json` | 200 `UserSettings` | 400 (`errors[]`), 401, 403, 413, 415, 429, 503 | `SELECT … FOR UPDATE`, merge, update and audit in one transaction; idempotent by nature, so no key |
| `POST /v1/__test__/idempotent` | session, `@Idempotent()` | `{ value: string }` | 201 `{ value, executions }` | 400, 409, 503 | **Integration harness only**; never in `AppModule` or `dist` |

**Headers**

| Header | Direction | Where | Rule |
|---|---|---|---|
| `x-request-id` | request and response | everywhere | An inbound value is kept only if it matches `REQUEST_ID_PATTERN`. Always echoed; equals `problem.requestId`. |
| `Cookie: authjs.session-token` / `__Host-authjs.session-token` | request | `/v1` | Opaque token; the database stores its SHA-256. |
| `Idempotency-Key` | request | `@Idempotent` routes: `POST /v1/orders` (2.1), `POST /v1/strategies/:id/deploy` (4.3), `PUT /v1/agents/auto-trade` (5.4) | 16–128 characters from `[A-Za-z0-9_-]` |
| `Idempotent-Replayed: true` | response | replays | — |
| `RateLimit-Policy`, `RateLimit` | response | rate-limited routes | draft-11 structured fields; never `pk` |
| `Retry-After` | response | 429, 503 | Whole seconds, equal to `retryAfterSec` |
| `Cache-Control: no-store` | response | `/v1`, problems, health | — |

**Not added in 0.5**
- **WebSocket:** no events, no gateway. `/rt` arrives in 1.4. The count of one market WS plus one order WS per broker is unchanged.
- **BullMQ:** no queues and no jobs.
- **UI:** no pages. 0.6 builds the web app.

**Broker budget.** Zero broker REST calls and zero broker WebSockets; the 12-operation budget is untouched. The api imports nothing from `packages/broker-sdk`, which doesn't exist yet.

## 7. Tests (behaviour names)

**shared — unit, coverage ≥ 90%**
- "ties status, title and type to the code"
- "rejects a multi-line or oversized detail"
- "rejects an instance with a scheme, host, query or fragment"
- "bounds field-error paths, messages and codes"
- "requires requestId to match REQUEST_ID_PATTERN"
- "maps PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE and SERVICE_UNAVAILABLE to 413, 415 and 503"
- "treats SERVICE_UNAVAILABLE as retryable"
- "still recognises problems with unknown codes and members on the client"
- property: "a problem built from any code with in-bounds text passes; any code–status–title–type mismatch fails"
- "accepts UUIDs as idempotency keys and rejects colons, spaces and 129 characters"
- "uses the __Host- session cookie only in production"
- "accepts Auth.js UUID session tokens"
- "rejects unknown members in Me and health payloads"

**database — unit**
- "rejects log entries other than info, warn and error, including { level: 'query', emit: 'event' }"
- "passes the connect, statement and idle-in-transaction timeouts and the application name to the pg pool"
- "caches one client per process on the registered symbol in every environment"
- "names the variable in every environment error and never echoes a value"
- "rejects non-postgres DATABASE_URL schemes and a query_timeout parameter"
- "rejects DEBUG in production"
- "orders the seven migration folders, ending with audit_actor_and_session_created_at and audit_actor_checks"
- "uses the same pinned Timescale image in compose and Testcontainers"
- "generates a different password for every test database"

**database — integration**
- "rejects an audit row whose actorType is unknown"
- "requires actorId unless actorType is system"
- "sets Session.createdAt by default"
- The existing guard (replica mode) and drift tests stay green.
- "starts a migrated database through the ./testing entry of both builds"

**api — unit**
- **Tooling:**
  - "emits design:paramtypes for constructor-injected providers under Vitest" (the Oxc canary)
  - "uses the same fastify as @nestjs/platform-fastify"
  - "uses the same Redis image in compose and Testcontainers"
- **Environment:**
  - "lists every invalid variable by name without echoing values"
  - "accepts only true and false for boolean variables"
  - "requires explicit https origins and a trusted-proxy setting in production"
  - "rejects '*' origins and API_TRUST_PROXY=true"
  - "rejects pretty logs, docs and DEBUG in production"
  - "keeps DB_STATEMENT_TIMEOUT_MS below the request timeout"
  - "defaults to the security.md limits"
- **Request id and client IP:**
  - "keeps a well-formed inbound x-request-id"
  - "replaces a malformed or oversized x-request-id with a UUID"
  - "keys IPv6 clients by /64 and IPv4-mapped addresses as IPv4"
- **Problems:**
  - "maps each domain error to its code, status, title and type"
  - "maps Zod issues to dot-path field errors, capped at 100"
  - "maps body-limit, media-type and malformed-JSON errors to 413, 415 and 400"
  - "maps unknown routes to NOT_FOUND without echoing the URL"
  - "maps P2002 to CONFLICT and P2025 to NOT_FOUND"
  - "maps PrismaClientValidationError to INTERNAL without its message"
  - "maps pool timeouts, P1001, statement timeouts and Redis outages to SERVICE_UNAVAILABLE with Retry-After"
  - "maps anything else to INTERNAL without stack or message"
  - "strips the query string from instance"
  - "falls back to a minimal INTERNAL problem when a built problem fails validation"
  - property: "always produces a problem that passes ProblemDetailsSchema"
- **Logging:**
  - "never logs authorization, cookie or set-cookie"
  - "redacts token, secret, password and email fields at depths 0 to 2"
  - "logs the request path without its query string"
  - "logs Prisma errors as type and code only"
  - "drops ioredis command arguments from logged errors"
- **Serializer:** "serialises bigint and Decimal values as strings"
- **Rate limiting:**
  - GCRA model properties: "never admits more than the burst at one instant", "admits the limit per period in steady state", "reports retry-after as the exact wait until the next admission", "counts remaining down to zero within a burst"
  - "formats RateLimit and RateLimit-Policy per draft-11 without a partition key"
  - "fails open for public and user and closed for orders when the store throws"
- **Idempotency:**
  - "fingerprints bodies regardless of key order"
  - "rejects a missing or malformed key"
  - "replays a stored response with Idempotent-Replayed"
  - "answers IDEMPOTENT_REPLAY while the original is in flight"
  - "rejects a reused key with a different body"
  - "releases the key when the handler fails"
  - "fails closed when the store throws"
  - "refuses to run on a public route"
- **CSRF:**
  - "allows allowlisted Origin and same-origin mutations"
  - "rejects cross-site and same-site-without-Origin mutations with FORBIDDEN"
  - "allows mutations with neither Origin nor Sec-Fetch-Site"
  - "ignores safe methods, public routes and cookie-less requests"
- **Sessions:**
  - "treats a missing cookie as anonymous"
  - "skips the lookup for a malformed cookie"
  - "hashes the token before the lookup"
  - "rejects expired, idle and over-age sessions and deleted users"
  - "does not check lockedUntil"
  - "writes lastSeenAt at most every 5 minutes"
- **Tenancy:**
  - "rejects reads, updates and deletes on user-owned models without userId"
  - "accepts compound unique keys that contain userId"
  - "scopes User by id"
  - "rejects createMany when any row lacks userId"
  - "leaves AuditLog and models without userId alone"
  - "lists exactly the schema's models that have a userId field" (sync test against schema.prisma)
- **Settings:**
  - "returns defaults for an empty stored object"
  - "logs the repaired paths"
  - "merges inside one transaction under a row lock"
  - "audits the changed paths only"
- **Audit:**
  - "rejects unknown actions"
  - "caps the data size"
  - "requires actorId unless the actor is system"
- **Dev script:** "refuses to create a session outside development or against a non-local database"

**api — integration** (Testcontainers TimescaleDB + Redis, Fastify `inject`)
- **Bootstrap:**
  - "boots the compiled CJS server, answers /health/live and exits 0 on SIGTERM"
  - "registers only /v1, /health and /docs routes"
  - "runs the global guards in registration order (429 before 401 for an anonymous flood)"
- **Health:**
  - "reports ready with the database and Redis up"
  - "reports unavailable without hostnames or error text when Redis is down"
  - "reports draining after SIGTERM and closes Prisma and Redis only after in-flight requests finish"
  - "stays not ready in production until the role check passes"
  - "refuses to start in production as a superuser"
- **Errors and hardening:**
  - "answers unknown routes with a NOT_FOUND problem and x-request-id"
  - "answers bodies over 1 MiB with PAYLOAD_TOO_LARGE"
  - "answers form-encoded and text/plain bodies with UNSUPPORTED_MEDIA_TYPE"
  - "answers malformed JSON with VALIDATION"
  - "answers SERVICE_UNAVAILABLE when the pool is exhausted beyond DB_CONNECT_TIMEOUT_MS"
  - "answers SERVICE_UNAVAILABLE when a handler exceeds the request timeout" (shortened through a test-only option)
  - "never includes stack traces, SQL or query strings in any error body"
  - "sends the helmet headers and no X-Powered-By"
  - "answers CORS preflights only for allowed origins"
  - "sets Cache-Control: no-store on /v1 and on problems"
- **Authentication and CSRF:**
  - "returns the signed-in user from GET /v1/me"
  - "answers UNAUTHENTICATED without a cookie and for expired, idle, over-age and deleted-user sessions"
  - "answers SERVICE_UNAVAILABLE, not UNAUTHENTICATED, when the database is down"
  - "never matches a session stored with the raw token"
  - "rejects a cross-site PATCH and accepts same-origin and server-to-server ones"
- **Rate limiting:**
  - "admits the burst, then answers RATE_LIMITED with Retry-After and retryAfterSec"
  - "sends RateLimit headers on every rate-limited response"
  - "limits signed-in users per user, regardless of IP"
  - "ignores X-Forwarded-For from an untrusted peer"
  - "uses the forwarded client IP behind the configured trusted proxy"
  - "charges failed session lookups to the IP bucket"
  - "fails open when Redis is down"
- **Idempotency** (probe route):
  - "replays the first response for a retried key"
  - "answers IDEMPOTENT_REPLAY to a concurrent duplicate"
  - "rejects a reused key with a different body"
  - "scopes keys per user"
  - "stores records for at most 24 hours"
  - "fails closed with SERVICE_UNAVAILABLE when Redis is down"
- **Settings:**
  - "returns full defaults for a new user"
  - "patches one field without touching others"
  - "rejects unknown keys with VALIDATION and field errors"
  - "keeps both fields when two tabs patch different fields concurrently"
  - "writes one audit row with actorId per patch"
- **OpenAPI:**
  - "documents every route with ProblemDetails as the default response and the session cookie scheme"
  - "answers 404 for /docs and /docs/json in production mode"
- **Tenancy:** "a scoped repository never reads another user's rows"
- **Logs:**
  - "every log line written during a request carries its requestId"
  - "a failing request logs no cookie, token or query string"

**CI.** The order is unchanged: static → unit → integration → security. turbo picks up `@finlytics/api` automatically, and the integration job also pulls the Redis image.

## 8. Risks, failure modes, performance & security

| Risk / failure mode | Mitigation |
|---|---|
| Oxc emits different decorator metadata than tsc, so dependency injection breaks only in tests or only in production | The canary unit test; integration tests boot the full `AppModule` under Oxc; the build smoke test boots the tsc output. Fallback: unplugin-swc, with `@swc/core` in `onlyBuiltDependencies`. |
| Two copies of fastify | Exact pins, the version-equality test and one dependabot group. |
| **Redis down** | `public` and `user` limits fail open (logged); idempotent routes fail closed with 503; readiness answers 503. Commands fail within ~1 s (no offline queue), and the error listener prevents a crash. |
| A cluster-wide Redis outage makes every pod unready, which is a full outage | Accepted for 0.5, because readiness checks the database and Redis as specified. Revisit in 6.4 (§10.5). |
| **Database down** | Session-protected routes answer 503, never 401, so there is no mass sign-out. Readiness answers 503; liveness is unaffected. |
| **Slow queries** | `statement_timeout` (10 s) cancels them in the server, which maps to 503. Behind it: the 15 s handler timeout, the 12 s transaction timeout and the 15 s idle-in-transaction timeout. |
| **Pool exhausted by a burst** | Waiters fail after 5 s with 503 + `Retry-After`. Per-IP and per-user limits apply. `DB_POOL_MAX` × replicas must stay below Postgres's `max_connections` (6.4, PgBouncer). |
| Prisma 7.10's client-side transaction timeout may return a connection mid-transaction (third-party report, unverified) | The server-side timeouts fire first (statement 10 s < transaction 12 s). `idle_in_transaction_session_timeout` kills stranded sessions. Transactions stay short; settings uses 3 statements. |
| **Proxy IP spoofing** | `trustProxy` only from an explicit hop count or CIDRs; `true` is rejected; production requires an explicit setting. Tests prove `X-Forwarded-For` from an untrusted peer is ignored. IPv6 is keyed per /64. |
| **Idempotency races** | `SET NX` is atomic; compare-and-set and compare-and-delete on the owner marker; 409 while in flight. Database uniqueness is the real guarantee for side effects (2.1). |
| A handler keeps running after its 503 | Idempotency keeps the record in flight until the handler settles. Later handlers pass `request.signal` to abortable I/O (ai-engine, brokers). |
| The session contract drifts from what Auth.js does (0.6) | Shared constants, the contract in docs/06, and 0.6's end-to-end test (sign in → `GET /v1/me`). The fallback is documented in A2. |
| Tenancy guard false positives or gaps | Per-operation unit tests; a schema-sync test for the model list; lint allowlists `unscoped`. Raw SQL and nested writes are reviewed by hand. |
| nestjs-zod's `strictSchemaDeclaration` trips on custom parameter decorators (`@CurrentUser()`) | The pipe skips `type === "custom"` (verify); a unit test covers it. |
| Unknown routes aren't rate-limited (no route context) | A 404 costs no database or Redis call. Cloudflare WAF limits path scanning (6.4). |
| Secrets reach logs through deep objects | Allowlisting serializers first, redaction at depths 0–2 second, and log tests. Request bodies are never logged. |
| New dependencies trip the audit gate | Each dependency arrives in the PR that uses it; `pnpm audit:ci` is in every PR's "Done when". Exceptions follow docs/06 rules only. |
| `@scarf/scarf` telemetry | Its build script is ignored, and the CSP blocks any runtime pixel. |
| ioredis 6 defaults to RESP3 | Integration tests run on Redis 7.4; `protocol: 2` is a one-line fallback per connection. |
| Testcontainers publishes ports on 0.0.0.0 | Random passwords; each container lives for one test run. |
| The production role check blocks startup while the database is unreachable | Up to 30 s of retries with backoff, then exit 1; Kubernetes restarts the pod. |
| `node --watch` restarts in the middle of a `tsc` emit | It restarts again on the next emitted file. Development only; the worst case is one extra restart. |

**Performance.** Nothing here is on the realtime path; there is no WebSocket until 1.4.
- **Per authenticated request:**
  - one lookup of `Session` by its unique hash
  - one conditional `UPDATE` per session at most every 5 minutes
  - one Redis `EVALSHA` for the rate limit
  - the handler
  - idempotent routes add two Redis operations
- **No N+1:** the 0.5 handlers read single rows.
- **Serialization:** the BigInt-safe reply serializer (a `JSON.stringify` replacer) is slower than plain stringify, but payloads are small. Schema-based serialization can come later for hot routes.
- **Logs and tenancy:** pino logs with allowlisted serializers and no probe access logs; redaction costs about 2%. The tenancy check adds a few property reads per query.

**Security.**
- Problems are validated before sending: no stack traces, SQL, query strings or Prisma messages.
- Serializers are allowlisted and redaction backs them up; `DEBUG` is banned in production.
- Session tokens are hashed at rest.
- Sessions have idle and absolute lifetimes, and an outage is 503, never 401.
- CSRF has three layers.
- CORS is an exact allowlist with credentials, never `*`.
- Request bodies are JSON only, up to 1 MiB.
- Helmet sets a strict CSP, plus HSTS in production.
- Client IPs come only from trusted proxies.
- Rate limits are per IP and per user; failed lookups are charged to the IP.
- Idempotency fails closed.
- Repositories are tenancy-guarded and lint restricts the unscoped client.
- Production refuses a superuser or replication-capable database role.
- The environment is validated, and `/docs` doesn't exist in production.

**Broker failure modes** (broker down, token expiry, partial fill) don't apply: this phase does no broker I/O. The contracts already cover them: `BROKER_UNAVAILABLE`, `NEEDS_RELOGIN` (409, never 401) and the `PARTIALLY_FILLED` order status.

## 9. PR task list

Run `/review` on every PR. Also run `/security-audit` on PR2, PR4, PR5, PR6, PR7, PR8 and PR9.

Order: PR1, PR2 and PR3 can run in parallel. PR4 needs PR1 and PR3. PR5 needs PR2 and PR4. PR6 needs PR5. PR7 and PR8 need PR6 and can run in parallel. PR9 needs PR6. PR10 comes last.

**PR1 — feat(shared): harden the problem contract; add HTTP, session, me and health schemas (0.5a)** — ✅ done
- [x] `errors.ts`:
  - the three codes
  - `REQUEST_ID_PATTERN` and `PROBLEM_LIMITS`
  - bounded single-line strings and a path-only `instance`
  - the `superRefine`
  - `SERVICE_UNAVAILABLE` added to the retryable codes
- [x] `http.ts`, `session.ts`, `me.ts`, `health.ts`, exported by name from `index.ts`. Update `README.md`.
- [x] Unit and property tests (§7).
- [x] docs/04 §6: the rows, the bounds and the retryable list.

Done when:
- `pnpm --filter @finlytics/shared test` reports coverage ≥ 90%
- `pnpm check:pkg && pnpm lint && pnpm typecheck` passes

**PR2 — feat(database): pool timeouts, env hardening, audit actor, session age, reusable test database (0.5b)** — ✅ done
- [x] `client.ts`: F5, review D1 (options, defaults, transaction options), review D7.
- [x] `env.ts`: review D6, F6, the `DB_*` variables; export the shape and check for the api.
- [x] Schema and both migrations, following the builder sequence in §4.
- [x] `src/testing/` and the `./testing` export:
  - moved harness, random password, `startTestDatabase`, `TIMESCALE_IMAGE`
  - tsdown entry and optional peers
  - the database's own integration tests switched over
  - a smoke test for the new entry
- [x] Catalog entries: the testcontainers trio and fast-check.
- [x] Unit and integration tests (§7); docs/03.

Done when:
- `pnpm db:migrate` applies the two new migrations and `pnpm db:status` reports up to date
- the drift diff exits 0
- `pnpm --filter @finlytics/database test && pnpm --filter @finlytics/database test:integration && pnpm check:pkg && pnpm lint && pnpm typecheck && pnpm audit:ci` passes

**PR3 — feat(api): scaffold, environment, logging and liveness (0.5c)** — ✅ done
- [x] `packages/config` nest preset and the root ESLint scope.
- [x] `apps/api`: `package.json` (Nest, fastify, nestjs-pino and pino, `@nestjs/config`, rxjs, reflect-metadata), `tsconfig.json`, `tsconfig.build.json`, `turbo.json`, both Vitest configs, the canary test, and the fastify version test.
- [x] `config/`: env schema with the api variables, the `DEBUG` rule and production rules; loader; ConfigModule wiring.
- [x] `bootstrap/`: Fastify options, request id, client IP.
- [x] `common/logger`: redaction and serializers, pretty only in development.
- [x] `main.ts`, `AppModule.forRoot`, the health module with `/health/live`, shutdown hooks.
- [x] Integration config with the build smoke test only.
- [x] Dependabot groups. Run `pnpm ignored-builds` and add any new entry, or stop and ask.

Done when:
- `pnpm --filter @finlytics/api build && pnpm --filter @finlytics/api test && pnpm --filter @finlytics/api test:integration` passes
- `pnpm dev`, then `curl -i http://127.0.0.1:4000/health/live` returns 200 with an `x-request-id` header
- `API_PORT=abc node apps/api/dist/main.js` exits 1 and prints `API_PORT: …`
- `pnpm lint && pnpm typecheck && pnpm format:check && pnpm audit:ci` passes

**PR4 — feat(api): problem+json errors, validation and HTTP hardening (0.5d)** — ✅ done
- [x] `common/problem-json`: domain errors and `toProblem`, with the structural Prisma, Fastify, Zod and ioredis mapping.
- [x] `ProblemDetailsFilter`, registered with `useGlobalFilters`, plus its headers and the fallback problem.
- [x] `ZodValidationPipe` (`strictSchemaDeclaration`, custom decorators skipped) and the global `ZodSerializerInterceptor`.
- [x] JSON-only parsers, helmet (CSP; HSTS in production), the CORS allowlist, `Cache-Control`, the BigInt reply serializer.
- [x] Unit tests, including the property test; integration tests for 404, 413, 415, malformed JSON, headers, CORS and the "no stack or SQL" sweep.

Done when:
- `pnpm --filter @finlytics/api test && pnpm --filter @finlytics/api test:integration` passes
- `curl -i -X POST -H 'content-type: text/plain' -d x http://127.0.0.1:4000/v1/nope` returns problem+json

**PR5 — feat(api): Prisma and Redis infrastructure, readiness and graceful shutdown (0.5e)** — ✅ done
- [x] `infra/prisma`:
  - `PrismaService` built from the environment (pool settings and timeouts)
  - the tenancy extension and the model list with its sync test
  - `unscoped` with the lint allowlist
  - the production role check
- [x] `infra/redis`: `RedisService` and `keys.ts`. `infra/lifecycle`: readiness state and drain.
- [x] `/health/ready`, and the shutdown order (Prisma and Redis close in `onApplicationShutdown`).
- [x] Integration harness:
  - global setup with `startTestDatabase` and Redis (random passwords)
  - `createTestApp(env)`, fixtures and log capture
- [x] Env: `DATABASE_URL`, `DB_*` and `REDIS_URL` through the database shape.
- [x] CI pulls the Redis image. docs/01: the tenancy guard and the Redis key namespaces.

Done when:
- the api integration tests pass locally and in CI
- manual check:
  - `docker compose stop redis`, then `curl -i http://127.0.0.1:4000/health/ready` returns 503
  - `docker compose start redis`, then the same request returns 200

**PR6 — feat(api): session authentication, CSRF and GET /v1/me (0.5f)** — ✅ done
- [x] `modules/auth`:
  - `SessionRepository` (hash lookup)
  - `SessionService` (the validity rules and the `lastSeenAt` throttle)
  - `SessionGuard` and `AuthGuard`
  - `@Public()`, `@CurrentUser()` and `@RequestMeta()`
- [x] `common/guards/csrf.guard.ts`. Register the global guards in order.
- [x] `modules/users`: `GET /v1/me` with its mapper and DTO.
- [x] `scripts/dev-session.mts`, with its guards.
- [x] Unit and integration tests; docs/06: the session contract and CSRF.

Done when:
- the tests pass
- manual check:
  - `node apps/api/scripts/dev-session.mts you@example.com` prints a cookie
  - `curl -i --cookie "authjs.session-token=<token>" http://127.0.0.1:4000/v1/me` returns 200
  - the same request without the cookie returns 401 problem+json

**PR7 — feat(api): rate limiting (0.5g)** — ✅ done
- [x] `common/rate-limit`:
  - the GCRA model and the Lua script
  - `RateLimitService` (policies; fail open or closed by policy)
  - `RateLimitGuard`, `@RateLimit()` and `@SkipRateLimit()`
  - headers
- [x] Charge failed session lookups in `SessionGuard`.
- [x] Unit property tests; integration tests for headers, 429, spoofing, trusted proxies and fail-open.
- [x] docs/04 §7 (rate limits) and docs/06.

Done when:
- the tests pass
- `for i in $(seq 1 105); do curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/v1/me; done | sort | uniq -c` prints 100 × 401 and 5 × 429

**PR8 — feat(api): idempotency interceptor (0.5h)** — ✅ done
- [x] `common/idempotency`:
  - fingerprint, store and the Lua scripts
  - the interceptor, registered outermost
  - `@Idempotent()`, which also documents the header in OpenAPI
- [x] `test/support/idempotency-probe.controller.ts` and the integration tests (§7).
- [x] docs/04 §7 (idempotency).

Done when:
- `pnpm --filter @finlytics/api test && pnpm --filter @finlytics/api test:integration` passes
- a unit test asserts that `AppModule` registers no `/v1/__test__` route

**PR9 — feat(api): user settings and the audit service (0.5i)** — ✅ done
- [x] `modules/audit`: `AuditService` with an action list, a 4 KiB data cap and `actorId` rules.
- [x] `modules/settings`:
  - `GET`: lenient read; issues logged at `warn`
  - `PATCH`: strict body; one transaction (`FOR UPDATE`, merge, update, audit)
- [x] Unit and integration tests, including the concurrent-patch test.

Done when:
- the tests pass
- manual check:
  - `curl -X PATCH -H 'content-type: application/json' --cookie "authjs.session-token=<token>" -d '{"appearance":{"theme":"dark"}}' http://127.0.0.1:4000/v1/me/settings` returns the merged settings
  - one new `AuditLog` row has `actorId` set

**PR10 — feat(api): OpenAPI at /docs and the docs sweep (0.5j)** — ✅ done
- [x] `bootstrap/openapi.ts`:
  - `@nestjs/swagger` and `@fastify/static`
  - `cleanupOpenApiDoc` 3.1
  - a default problem response on every operation
  - the `x-request-id` header and the cookie security scheme
  - the `/docs` CSP; absent in production
- [x] `@scarf/scarf` in `ignoredBuiltDependencies`.
- [x] OpenAPI integration tests.
- [x] docs/02, docs/04 (health row, `/v1/me`, §7 complete), docs/06 final pass, docs/09, the nest-module skill (needs approval).

Done when:
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm check:pkg && pnpm audit:ci` is all green
- http://127.0.0.1:4000/docs lists every route
- running with `NODE_ENV=production` plus the production variables gives 404 on `/docs`

## 10. Carry-forward notes

1. **0.6 (web and Auth.js): binding contract from this plan.**
   - **Cookie and tokens:**
     - Use the cookie names in `SESSION_COOKIE_NAME` (`__Host-` in production; `Path=/`, no `Domain`, `SameSite=Lax`, `HttpOnly`, `Secure` in production).
     - Wrap the Prisma adapter so that `Session.sessionToken` holds SHA-256 hex: hash in `createSession`, `getSessionAndUser`, `updateSession` and `deleteSession`, and return the raw token to Auth.js.
     - Tokens must match `SESSION_TOKEN_PATTERN`.
   - **Session lifetimes:**
     - `session.maxAge` 7 days (rolling) and `updateAge` 1 day.
     - Mirror the 30-day absolute limit from `Session.createdAt` in the `session` callback.
   - **Routing:**
     - Same origin: Next.js `rewrites` sends `/v1/:path*` to `http://127.0.0.1:4000/v1/:path*` in development.
     - Next.js must define no routes under `/v1`.
     - Server actions forward the incoming `Cookie` and `x-request-id` headers to the api only.
   - **Status handling in the web app:**
     - 401 → signed out
     - 503 `SERVICE_UNAVAILABLE` → retry, never sign out
     - 409 `NEEDS_RELOGIN` → the broker banner
   - **End-to-end test:** sign in → `GET /v1/me` returns the same user → change a setting on the settings page.
   - **Existing 0.6 notes** still apply: email case-insensitivity, OAuth tokens in `Account`, reducing `Role` (then update `AuthIdentity.role`), and edge middleware never importing `@finlytics/database`.
   - **Then:** retire `scripts/dev-session.mts` or keep it development-only.
2. **1.1 broker-sdk.** `BrokerRateLimiter` reuses the GCRA script and model. Move `apps/api/src/common/rate-limit/gcra*` into a package both can import (`broker-sdk` or a small Redis-scripts package); decide in 1.1.
3. **1.4 gateway `/rt` (`APP_ROLE=gateway`).**
   - The handshake reuses `SessionService` (including IP charging) and checks `Origin` against `API_ALLOWED_ORIGINS`: browsers send `SameSite=Lax` cookies on same-site WebSocket handshakes and never preflight them.
   - Socket.IO's Redis adapter and the feed get their own ioredis connections, with blocking and pub/sub settings.
   - Use the key namespaces from docs/01.
4. **2.1 orders.**
   - **Idempotency:** `@Idempotent()` on `POST /v1/orders` and the basket. Redis is the dedupe and replay layer; exactly-once comes from `Order(userId, idempotencyKey)` plus reconciliation.
   - **Order-rate cap:** the `orders` policy fails closed, and the cost is the number of legs. For SEBI's per-second order cap, choose between GCRA (with a burst of 10, a rolling second can admit up to 20) and a sliding-window log (exactly 10).
   - **Database role split:**
     - the migrator role owns all objects
     - the app role has `ALTER ROLE … SET statement_timeout`, no `SET` on `session_replication_role`, and `REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog"`
     - the boot check then passes in every environment
   - **Typed errors and actions:** the domain errors `InsufficientFunds`, `BrokerRejected`, `RiskLimit`, `KillSwitch`, `MarketClosed`, `NeedsRelogin` and `BrokerUnavailable`, plus their audit actions.
   - **Events and queues:** register `@nestjs/event-emitter` with `order.updated`; BullMQ gets its own connections (`maxRetriesPerRequest: null`).
5. **6.x hardening.**
   - **Readiness:** decide its semantics for shared dependencies; a Redis outage currently makes every pod unready.
   - **Metrics and tracing:** `/metrics` on an internal port. OpenTelemetry in `src/telemetry.ts`, imported first by `main.ts`, with the trace id linked to `x-request-id`.
   - **Connection settings:**
     - PgBouncer needs `ignore_startup_parameters`, or role-level settings, for `statement_timeout`, `idle_in_transaction_session_timeout` and `application_name`.
     - TLS to Postgres (`sslmode=verify-full`) and Redis (`rediss://`).
   - **Edge:**
     - HSTS preload.
     - The ingress routes only `/v1` and `/rt` (never `/health` or `/docs`).
     - Cloudflare limits for unknown paths.
   - **Docs and data:**
     - Admin-gated `/docs` in production, if it is ever needed.
     - DPDP pseudonymisation for `AuditLog.ip` and `userAgent`.
   - **Shutdown:** `terminationGracePeriodSeconds` ≥ drain + 15 s + margin.
6. **Nest 12** (once CLAUDE.md is updated):
   - replace nestjs-zod with Nest's own `StandardSchemaValidationPipe` and serializer
   - nestjs-pino 5 already supports Nest 12
   - re-pin fastify to the new platform-fastify
7. **ioredis RESP3.** If the Socket.IO adapter or BullMQ misbehaves on RESP3, set `protocol: 2` on that connection.

## Sources

- **NestJS:**
  - [Configuration](https://docs.nestjs.com/techniques/configuration)
  - [Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events)
  - [OpenAPI](https://docs.nestjs.com/openapi/introduction)
  - [Performance (Fastify)](https://docs.nestjs.com/techniques/performance)
  - [FastifyAdapter source (11.1.6)](https://raw.githubusercontent.com/nestjs/nest/v11.1.6/packages/platform-fastify/adapters/fastify-adapter.ts)
  - [RoutesResolver source](https://raw.githubusercontent.com/nestjs/nest/master/packages/core/router/routes-resolver.ts)
  - [Nest 12 Standard Schema pipe](https://dev.to/parsajiravand/nestjs-12-standard-schema-validation-without-class-validator-161f)
- **npm registry:**
  - [@nestjs/platform-fastify 11.2.7](https://registry.npmjs.org/@nestjs/platform-fastify/11.2.7)
  - [@nestjs/core 11.2.7](https://registry.npmjs.org/@nestjs/core/11.2.7)
  - [@nestjs/common 11.2.7](https://registry.npmjs.org/@nestjs/common/11.2.7)
  - [@nestjs/swagger 11.4.7](https://registry.npmjs.org/@nestjs/swagger/11.4.7)
  - [@nestjs/cli 11.0.24](https://registry.npmjs.org/@nestjs/cli/11.0.24)
  - [nestjs-zod 5.5.0](https://registry.npmjs.org/nestjs-zod/5.5.0)
  - [nestjs-pino 5.3.1](https://registry.npmjs.org/nestjs-pino/5.3.1)
  - [ioredis 6.0.0](https://registry.npmjs.org/ioredis/6.0.0)
  - [bullmq 6.3.11](https://registry.npmjs.org/bullmq/6.3.11)
  - [@swc/core 1.16.13](https://registry.npmjs.org/@swc/core/1.16.13)
  - [swagger-ui-dist 5.32.13](https://registry.npmjs.org/swagger-ui-dist/5.32.13)
  - [@fastify/helmet 13.1.1](https://registry.npmjs.org/@fastify/helmet/13.1.1)
  - [@fastify/cookie 11.1.2](https://registry.npmjs.org/@fastify/cookie/11.1.2)
  - [rate-limiter-flexible 11.2.1](https://registry.npmjs.org/rate-limiter-flexible/11.2.1)
- **Libraries:**
  - [nestjs-zod README](https://github.com/BenLorantfy/nestjs-zod)
  - [nestjs-pino README](https://github.com/iamolegga/nestjs-pino)
  - [pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md)
  - [ioredis releases](https://github.com/redis/ioredis/releases)
  - [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible)
  - [Testcontainers Redis module](https://node.testcontainers.org/modules/redis/)
- **Fastify:**
  - [Server options (latest)](https://fastify.dev/docs/latest/Reference/Server/)
  - [Server options (v5.8.x)](https://fastify.dev/docs/v5.8.x/Reference/Server/)
- **TypeScript and tooling:**
  - [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
  - [consistent-type-imports](https://typescript-eslint.io/rules/consistent-type-imports/)
  - [no-extraneous-class](https://typescript-eslint.io/rules/no-extraneous-class/)
  - [Vite 8 announcement](https://vite.dev/blog/announcing-vite8)
  - [Vite oxc option](https://vite.dev/config/shared-options#oxc)
  - [Oxc TypeScript transformer](https://oxc.rs/docs/guide/usage/transformer/typescript.html)
  - [nestjs/event-emitter Vitest config](https://github.com/nestjs/event-emitter/blob/master/vitest.config.ts)
  - [Turborepo configuration (`with`)](https://turborepo.dev/docs/reference/configuration)
  - [Turborepo 2.5](https://turborepo.dev/blog/turbo-2-5)
- **Prisma:**
  - [v7 connection pool](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool)
  - [third-party report on Prisma 7.10 transaction timeouts (unverified)](https://github.com/mattiasvoleman/SchemaPro/pull/74)
- **Standards drafts:**
  - [RateLimit header fields, draft-11](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-11)
  - [Idempotency-Key header, draft-07 (expired)](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)
