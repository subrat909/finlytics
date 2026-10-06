# 04 — API Design

## 1. Principles
- REST + JSON under `/v1`, OpenAPI generated from NestJS decorators + Zod (`nestjs-zod`), problem+json errors,
  cursor pagination (`?cursor=&limit=`), ETag on cacheable GETs, `Idempotency-Key` on trading mutations,
  `x-request-id` correlation, versioned by path.
- Realtime over one Socket.IO namespace `/rt` with rooms; browser never talks to brokers or ai-engine directly.
- Internal: api → ai-engine over HTTP (RS256 JWT) + Redis streams for signals.

## 2. Public REST surface (apps/api)

| Area | Endpoints |
|---|---|
| Auth (Auth.js handles OAuth in web) | `POST /v1/auth/2fa/setup` `POST /v1/auth/2fa/verify` `POST /v1/auth/sessions/revoke` |
| Users/Settings | `GET/PATCH /v1/me` `GET/PATCH /v1/me/settings` (JSONB: appearance, trading defaults, notifications; see below) `GET /v1/me/export` `DELETE /v1/me` |
| Brokers | `GET /v1/brokers` (catalog) `GET /v1/broker-accounts` `POST /v1/broker-accounts` (start OAuth / save static token) `GET /v1/broker-accounts/:id/callback` `POST /v1/broker-accounts/:id/relogin` `DELETE /v1/broker-accounts/:id` `POST /v1/broker-accounts/:id/default` |
| Market data | `GET /v1/instruments/search?q=` `GET /v1/instruments/:key` `GET /v1/quotes?keys=` (from Redis) `GET /v1/candles?key&tf&from&to` `GET /v1/market/status` `GET /v1/market/indices` |
| TradingView UDF | `GET /v1/tv/config` `/v1/tv/symbols` `/v1/tv/search` `/v1/tv/history` `/v1/tv/marks` `/v1/tv/time` |
| Option chain | `GET /v1/option-chain?underlying&expiry` (chain + greeks, cached 1 s) `GET /v1/option-chain/expiries?underlying` `GET /v1/option-chain/analytics` (PCR, max pain, OI buildup) |
| Watchlists | `GET/POST /v1/watchlists` `PATCH/DELETE /v1/watchlists/:id` `PUT /v1/watchlists/:id/items` (ordered keys) |
| Orders | `POST /v1/orders` `PATCH /v1/orders/:id` `DELETE /v1/orders/:id` `GET /v1/orders?status&from&to` `GET /v1/orders/:id` `POST /v1/orders/basket` |
| Portfolio | `GET /v1/positions` `GET /v1/holdings` `GET /v1/funds` `POST /v1/positions/:key/exit` `POST /v1/positions/exit-all` |
| P&L | `GET /v1/pnl/live` `GET /v1/pnl/calendar?month=` `GET /v1/pnl/trades?from&to` `GET /v1/pnl/summary` |
| Strategies | `GET/POST /v1/strategies` `GET/PATCH/DELETE /v1/strategies/:id` `POST /v1/strategies/:id/validate` `POST /v1/strategies/:id/deploy` `POST /v1/strategies/:id/stop` `GET /v1/strategies/:id/runs` `GET /v1/strategies/templates` |
| Backtests | `POST /v1/backtests` (async → job) `GET /v1/backtests/:id` `GET /v1/backtests?strategyId` `DELETE /v1/backtests/:id` |
| Agents | `GET /v1/agents/status` `POST /v1/agents/analyze` (on-demand) `GET /v1/agents/signals?from` `GET /v1/agents/runs/:id` `GET/PUT /v1/agents/auto-trade` (config + limits) `POST /v1/agents/auto-trade/pause` |
| Alerts | `GET/POST /v1/alerts` `PATCH/DELETE /v1/alerts/:id` `GET /v1/alerts/:id/history` |
| Notifications | `GET /v1/notifications` `POST /v1/notifications/read` `GET/PUT /v1/notifications/channels` (push subs, telegram chat id) |
| Risk | `GET/PUT /v1/risk/limits` `POST /v1/risk/kill-switch` |
| Admin | `/v1/admin/*` users, plans, feed status, broker health, global kill switch |
| Health (outside `/v1`, public, never routed by the ingress) | `GET /health/live` `GET /health/ready` (§7) · `/metrics` arrives in 6.4, on an internal port |

**Settings (`GET/PATCH /v1/me/settings`).** The contract is code: `packages/shared/src/schemas/user-settings.ts`.
- `GET` returns the complete settings (`UserSettingsSchema`). The stored JSONB is read leniently
  (`parseUserSettings`): a missing or invalid field gets its default, unknown stored keys are dropped, and the server
  logs what it repaired (`parseUserSettingsWithIssues`).
- `PATCH` takes a strict, deep-partial body (`UserSettingsPatchSchema`): only the fields that change, at any depth, e.g.
  `{ "notifications": { "categories": { "order": { "push": false } } } }`. Sections are merged, never replaced: the
  server merges the body into the stored value (`mergeUserSettings`) in one transaction, so a patch never changes a
  field it doesn't name, including one that another tab just changed. The same patch applied twice gives the same
  result, so a retry is safe. The response is the complete merged settings.
- An unknown key at any level, `null`, or an invalid value fails the whole patch with `400 VALIDATION` and `errors[]`
  (§6). Nothing is applied. To reset a field, send its default value.
- In-app delivery of `broker` and `system` notifications can't be turned off: `inApp: false` for them is a validation
  error.
- Settings hold preferences only. Risk limits, auto-trade, the kill switch and the default broker have their own
  endpoints (`/v1/risk/*`, `/v1/agents/auto-trade`, `/v1/broker-accounts/:id/default`), behind step-up auth.
- Each `PATCH` that changes something writes one `AuditLog` row (`settings.update`, `actorId` = the user, `data` =
  the dot paths that changed) in the same transaction; a patch that changes nothing writes nothing. A cross-site
  `PATCH` is `403 FORBIDDEN` (§7 "CSRF").

**Who am I (`GET /v1/me`).** The signed-in user, `MeSchema` in `packages/shared/src/schemas/me.ts`:
`{ id, email, name, image, timezone, createdAt }` (`name` and `image` may be null; `createdAt` is ISO 8601). Never the
role, password hash, 2FA secrets or lockout state. Without a valid session: `401 UNAUTHENTICATED`; with the database
down: `503 SERVICE_UNAVAILABLE`, never 401. It is the call 0.6 uses to prove the session cookie reaches the api.

## 3. Broker budget — the only 12 outbound operations
See `.claude/rules/broker.md`. Enforced in code: `BrokerAdapter` has exactly these methods; `BrokerGateway` is the
only class allowed to import adapters (ESLint `no-restricted-imports` elsewhere).

## 4. Realtime protocol (`/rt`, Socket.IO, msgpack parser)

Client → server
```
sub   { keys: string[], mode: "ltp" | "quote" | "full" }
unsub { keys: string[] }
chain.sub   { underlying, expiry }          // server computes which strikes to stream
chain.unsub { underlying, expiry }
```
Server → client (volatile, batched 100 ms)
```
t     [ [key, ltp, chg, chgPct, vol, oi, ts], ... ]              // ltp mode, array-packed
q     [ { k, ltp, bid, ask, bq, aq, vol, oi, ts, d? } ... ]      // quote/full
chain { underlying, expiry, spot, rows:[{strike, ce:{ltp,iv,oi,delta,...}, pe:{...}}], pcr, maxPain, ts }
order { ...OrderDto }                                           // room user:<id>
pos   { ...PositionDto }      pnl { realised, unrealised, day, ts }
alert { id, title, body, severity }   agent { runId, type, payload }
feed  { broker, status: "up"|"degraded"|"down" }
```
Handshake: cookie session → `userId`; join `user:<id>`. Server enforces ≤ 300 keys per connection (plan-based).

## 5. Internal API (api ↔ ai-engine)
```
POST /internal/greeks        { rows:[{strike, type, ltp, spot, t, r}] }      → greeks[]
POST /internal/analyze       { userId, underlying, expiry, timeframe, context } → AnalysisReport
POST /internal/backtest      { backtestId, definition, range, capital, slippageBps, chargesProfile } → 202 (job)
POST /internal/agents/run    { userId, mode: "advise"|"auto", config } → runId
Redis stream agent:signals   → api consumes, persists AgentSignal, pushes to user room, routes to OrderService if auto
```

## 6. Error contract (RFC 9457 problem details)
Every error response is a problem details object with media type `application/problem+json`, following
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) (which obsoletes RFC 7807). The contract is code, not prose:
`packages/shared/src/schemas/errors.ts` exports `ProblemDetailsSchema`, `ErrorCodeSchema`, `ERROR_HTTP_STATUS`,
`ERROR_TITLES`, `problemTypeUrl()`, `PROBLEM_LIMITS`, `REQUEST_ID_PATTERN`, `isProblemDetails()`, `isKnownErrorCode()`
and `isRetryableErrorCode()`. The server validates every problem it sends against `ProblemDetailsSchema`, and sends a
minimal `INTERNAL` problem instead when one fails. The schema is:
- **strict** at every level: an unknown member fails validation, so nothing internal (stack trace, SQL, raw broker
  payload) can ride along;
- **consistent**: `status`, `title` and `type` must be the ones `code` gives (`ERROR_HTTP_STATUS[code]`,
  `ERROR_TITLES[code]`, `problemTypeUrl(code)`);
- **bounded**: every text member has a maximum length (`PROBLEM_LIMITS`, below) and is a single line, with no control
  character (C0, DEL, C1: no CR, LF or tab), no Unicode line or paragraph separator, no bidirectional control
  (U+202A–U+202E, U+2066–U+2069, which reorder how surrounding text displays), no U+FEFF and no lone surrogate.
  Well-formed astral characters (emoji) are allowed.

Clients use `isProblemDetails()`, which is tolerant as RFC 9457 §3.2 requires: it ignores members it doesn't know,
accepts codes newer than the client build and doesn't apply the server-side bounds, so an open tab survives a deploy
(narrow with `isKnownErrorCode()`).
```json
{ "type": "https://finlytics.app/errors/broker-rejected", "title": "Broker rejected the request", "status": 422,
  "code": "BROKER_REJECTED", "detail": "Insufficient margin", "instance": "/v1/orders", "requestId": "…",
  "broker": { "code": "…", "message": "…" } }
```

| Member | Required | Content |
|---|---|---|
| `type` | yes | `https://finlytics.app/errors/<kebab-code>`, from `problemTypeUrl(code)` |
| `title` | yes | `ERROR_TITLES[code]`: a short summary, the same for every occurrence |
| `status` | yes | `ERROR_HTTP_STATUS[code]` (an integer, 400–599); always equal to the response status |
| `code` | yes | a stable code from the table below. Clients branch on `code`, never on `title` or `detail` |
| `detail` | no | a human-readable explanation of this occurrence, from the server's own curated messages: 1–500 characters, one line |
| `instance` | no | the request path, without query string or fragment: one leading `/`, then no whitespace, `\`, `?`, `#` or character the single-line rule bans (so never a scheme or a host such as `//host`), at most 512 characters |
| `requestId` | yes | the `x-request-id` correlation id, also in every log line. Matches `REQUEST_ID_PATTERN`: 8–128 characters from `[A-Za-z0-9._-]`, starting with a letter or digit (a UUID matches) |
| `errors` | no | field-level validation errors, at most 100 (`MAX_FIELD_ERRORS`; servers keep the first 100): `{ path, message, code? }`. `path` is a dot path into the request body, the way react-hook-form names fields (`"legs.0.strike"`), and `""` means the body as a whole; at most 256 characters, one line. `message` is safe to show next to the field: 1–300 characters, one line. `code` is an optional machine-readable reason in lowercase snake case, e.g. a Zod issue code (`"too_small"`), at most 64 characters |
| `broker` | no | the broker's own error, `{ code, message? }`, for `BROKER_REJECTED` and `BROKER_UNAVAILABLE`: `code` 1–64 characters, `message` 1–500, both one line |
| `retryAfterSec` | no | whole seconds to wait before retrying, 0–86,400. Mirrors the `Retry-After` header that 429 and 503 responses carry |

Lengths are in UTF-16 code units (`string.length`; an emoji counts twice), not the code points Zod's `.max()` and JSON
Schema's `maxLength` count: the schema checks code units itself. Servers shorten or drop text that doesn't fit (never
between the halves of a surrogate pair) rather than send an invalid problem.

| HTTP status | Codes |
|---|---|
| 400 | `VALIDATION` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `IDEMPOTENT_REPLAY`, `NEEDS_RELOGIN` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `BROKER_REJECTED`, `RISK_LIMIT`, `INSUFFICIENT_FUNDS`, `MARKET_CLOSED` |
| 423 | `KILL_SWITCH` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` |
| 503 | `BROKER_UNAVAILABLE`, `SERVICE_UNAVAILABLE` |

- **`INSUFFICIENT_FUNDS` vs `BROKER_REJECTED`.** `INSUFFICIENT_FUNDS` is only for our own pre-trade check, before
  anything reaches a broker. When a broker rejects an order for margin (or any other reason), the code is
  `BROKER_REJECTED`, with the broker's own code in `broker.code` and its message in `broker.message`. Clients can tell
  "we stopped it" from "the broker refused it", and support can look up the broker's code.
- **`NEEDS_RELOGIN` is 409, never 401.** The user's Finlytics session is still valid; only the broker session expired
  (Upstox tokens end at 03:30, Dhan tokens after 30 days). A 401 means "not signed in to Finlytics", so the web app
  would sign the user out. A 409 says the request conflicts with the broker account's state, and the app shows the
  one-click broker re-login banner instead.
- **`KILL_SWITCH` is 423 (Locked).** Trading stays locked for the user (`TradingControl`) or for everyone
  (`GlobalControl`) until the switch is released.
- **`SERVICE_UNAVAILABLE` is ours, `BROKER_UNAVAILABLE` is the broker's.** `SERVICE_UNAVAILABLE` (503) means one of our
  own dependencies failed or was too slow (the database, Redis, a pool or statement timeout, a request over the 15 s
  limit) or the server is draining. It is never `INTERNAL` (which isn't retryable), never `BROKER_UNAVAILABLE` (which
  shows the broker banner) and never 401: a database outage must not sign anyone out.
- **`PAYLOAD_TOO_LARGE` (413) and `UNSUPPORTED_MEDIA_TYPE` (415)** keep HTTP semantics for proxies and `fetch`: the
  body is over 1 MiB, or isn't `application/json`.
- **Retries.** Only `RATE_LIMITED`, `BROKER_UNAVAILABLE` and `SERVICE_UNAVAILABLE` are retryable
  (`RETRYABLE_ERROR_CODES`, `isRetryableErrorCode`): wait `retryAfterSec` (or back off) and send the same request
  again. A retried order placement reuses its `Idempotency-Key`. Every other code needs a change before a retry can
  succeed.
- **Changing the contract.** Adding a code means adding it to `ERROR_CODES` with a status and a title, plus a row in the
  table above. Codes are never renamed or removed.

## 7. HTTP conventions (apps/api)
What every route shares, implemented once in `apps/api` (`src/bootstrap`, `src/common`). Header names, the
idempotency-key and request-id patterns and the session cookie names are code in `@finlytics/shared` (`HEADERS`,
`IdempotencyKeySchema`, `REQUEST_ID_PATTERN`, `SESSION_COOKIE_NAME`).

**Routing and versioning**
- One origin in production: the ingress sends `/v1/*` (and `/rt` from 1.4) to the api and everything else to Next.js.
  In development Next.js rewrites `/v1/*` to `http://127.0.0.1:4000`. The session cookie is `__Host-` (no `Domain`),
  so a separate api host would never receive it.
- Every versioned route's controller path starts with `v1/`; there is no global prefix and no Nest URI versioning.
  `/health/*` and `/docs*` sit outside `/v1` and are never routed by the ingress.
- Router: case-sensitive, no trailing-slash or duplicate-slash folding; path parameters up to 512 characters.

**Request ids.** The api generates every request id itself (a UUID). It is sent as `x-request-id` on every response,
equals `requestId` in every problem, is on every log line written during the request, and is the `AuditLog.requestId`
of any audit row the request writes. A client can't choose it: an inbound `x-request-id` (a caller's own correlation
id, such as the web app's) is never adopted. When it matches `REQUEST_ID_PATTERN` (8–128 characters from
`[A-Za-z0-9._-]`, starting with a letter or digit) it is logged as `clientRequestId` on the request's access-log line,
which links the caller's logs to ours; otherwise it is dropped.

**Authentication.** The Auth.js session cookie (`authjs.session-token`; `__Host-authjs.session-token` in production) on
every `/v1` route; the contract is in docs/06 "Session contract". No valid session: `401 UNAUTHENTICATED`. Database
down: `503 SERVICE_UNAVAILABLE`, never 401. Only `/health/*` is public in 0.5.

**CSRF.** `POST`, `PUT`, `PATCH` and `DELETE` with the session cookie must come from an allowed `Origin`
(`API_ALLOWED_ORIGINS`), or, without `Origin`, with `Sec-Fetch-Site` absent, `same-origin` or `none`; otherwise
`403 FORBIDDEN`. Details: docs/06 "CSRF".

**Bodies.** `application/json` only, at most 1 MiB. Any other media type is `415 UNSUPPORTED_MEDIA_TYPE`, a larger body
`413 PAYLOAD_TOO_LARGE`, malformed or empty JSON and `__proto__`/`constructor.prototype` keys `400 VALIDATION`. Bodies
are validated by strict Zod schemas: an unknown key is `400 VALIDATION` with `errors[]` (§6).

**Timeouts.** 15 s for the whole request (guards, handler, serialization), then `503 SERVICE_UNAVAILABLE` with
`Retry-After: 5`; 15 s to receive the request; keep-alive 72 s. A request that has already ended (its 15 s passed, or
the client went away) before its handler starts never starts it, on any route; an idempotency claim it made is
released. A database statement is cancelled after `DB_STATEMENT_TIMEOUT_MS` (10 s), a request waits at most
`DB_CONNECT_TIMEOUT_MS` (5 s) for a pooled connection, and an interactive transaction waits at most 2 s for its
connection and runs at most 12 s (14 s in all, inside the request's 15 s); each answers 503.

**Shutdown.** After SIGTERM, `/health/ready` answers `draining` for `API_SHUTDOWN_DRAIN_MS`; then the server stops
accepting connections, closes idle keep-alive connections and lets in-flight requests finish, with `Connection: close`
on their responses. A request that still arrives on an open connection gets `503 SERVICE_UNAVAILABLE` problem+json
with `Retry-After: 1` and `Connection: close`: retry it on a new connection, which reaches another pod.

**Caching.** `Cache-Control: no-store` on every `/v1` response, every problem and every health response.

**Security headers.** A CSP of `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
(`/docs` relaxes it for Swagger UI only), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Resource-Policy: same-site`, `X-Frame-Options: DENY`, HSTS (`max-age=31536000; includeSubDomains`) in
production only, no `X-Powered-By`. CORS: the exact origins in `API_ALLOWED_ORIGINS` with credentials, never `*`;
allowed request headers `content-type`, `idempotency-key`, `x-request-id`; exposed response headers `x-request-id`,
`retry-after`, `ratelimit`, `ratelimit-policy`, `idempotent-replayed`; preflights cached 600 s.

**Rate limits.** GCRA token buckets in Redis (docs/06 "Rate limiting"). A limit is a sustained rate, and the bucket's
burst equals it: a client that has been idle can send the whole limit at once, then the limit per window (so up to
twice the limit within the first window).

| Policy | Charged per | Limit | Applies to | Redis down |
|---|---|---|---|---|
| `public` | client IP (IPv4, or the IPv6 /64) | `API_RATE_LIMIT_PUBLIC_PER_MIN` per minute (100) | requests without a valid session, including a failed session lookup (charged once) | fail open |
| `publicNet` | the IPv6 /48 (IPv6 clients only) | 20 × `API_RATE_LIMIT_PUBLIC_PER_MIN` per minute (2000) | the same requests, after `public` admitted them | fail open |
| `user` | user | `API_RATE_LIMIT_USER_PER_MIN` per minute (600) | signed-in requests, whatever their IP | fail open |
| `orders` | user | 10 per second, fixed | routes with `@RateLimit("orders")` (`POST /v1/orders`, 2.1), on top of `user` | fail closed: 503 |

- Every rate-limited response carries the structured fields of draft-ietf-httpapi-ratelimit-headers-11, one list
  member per policy checked: `RateLimit-Policy: "user";q=600;w=60` (`q` the sustained rate per `w` seconds, which is
  also the burst) and `RateLimit: "user";r=599;t=1` (remaining now, seconds until the quota is full again). Never a
  partition key.
- A request with a session cookie from an address whose anonymous bucket is already empty gets `429 RATE_LIMITED`
  before its session is looked up, even if the cookie is valid (nothing tells a valid token from a random one without
  the lookup): a signed-in user behind such an address waits for `Retry-After`, under a second at the default limit.
- Refused: `429 RATE_LIMITED` with `Retry-After` and the same value in `retryAfterSec`, in whole seconds (`Retry-After`
  takes precedence over `t`). Retry after that long.
- Not rate-limited: `/health/*`, `/docs*`, CORS preflights and unknown routes (a 404 costs no database or Redis call;
  Cloudflare limits path scanning).
- While Redis is down, `public` and `user` let requests through without the headers.

**Idempotency.** Routes marked `@Idempotent()` require `Idempotency-Key`: 16–128 characters from `[A-Za-z0-9_-]`
(`crypto.randomUUID()` fits). A client makes one key per intended action and reuses it on every retry of that action.
Keys are scoped per user and kept 24 h. Routes: `POST /v1/orders` (2.1), `POST /v1/strategies/:id/deploy` (4.3),
`PUT /v1/agents/auto-trade` (5.4).

| Situation | Response |
|---|---|
| key missing or malformed | `400 VALIDATION`, detail "Send an Idempotency-Key header (16–128 letters, digits, '-' or '_')." |
| first request | runs; a 2xx response (status and body, up to 64 KiB) is stored for 24 h; anything else frees the key |
| same key and request, completed | the stored status and body, plus `Idempotent-Replayed: true`; the handler doesn't run |
| same key and request, still in flight | `409 IDEMPOTENT_REPLAY`, no `Retry-After`: wait for the original, then retry |
| same key, different method, path, query or body | `400 VALIDATION`, `errors: [{ "path": "", "code": "idempotency_key_reused", … }]` (the expired IETF draft uses 422; our 422 codes are trading rejections) |
| another user, same key | independent |
| Redis down | `503 SERVICE_UNAVAILABLE`, `Retry-After: 5`: fails closed, a trade is never retried without dedupe |

- "Same request" means the same SHA-256 fingerprint of the method, the path and query as sent, and the body as
  canonical JSON (object keys sorted, so their order doesn't matter).
- A response over 64 KiB isn't stored: the key is freed and a retry runs again.
- A handler still running when the 15 s timeout answers 503 keeps the key (at most 30 s) until it settles; then its
  success is stored and a retry replays it.
- Redis dedupes and replays; it is not the exactly-once guarantee. Order side effects get that from database
  uniqueness (`Order(userId, idempotencyKey)`, 2.1).
- `PATCH /v1/me/settings` is idempotent by nature and takes no key.

**Health** (plain `application/json`, not problem+json; never rate-limited or access-logged)
- `GET /health/live`: `200 { "status": "ok" }` while the process runs; touches nothing.
- `GET /health/ready`: `200 { "status": "ok", "checks": { "database": "up", "redis": "up" } }` when `SELECT 1` (1 s)
  and Redis `PING` (500 ms) both answer; otherwise `503` with `status` `unavailable` (and which check is `down`) or
  `draining` after SIGTERM. In production it stays 503 until the database role check has passed once (docs/06). No
  hostnames, versions, durations or error text. The two checks run once for all concurrent probes and their result is
  reused for 1 s, so a change shows within about a second.

**OpenAPI.** Swagger UI at `/docs` and the OpenAPI 3.1 document at `/docs/json` (JSON only, no YAML), generated from
the same Zod schemas that validate requests and serialize responses. Every operation documents `default` →
`application/problem+json` (`ProblemDetails`), the `x-request-id` response header and the `session` cookie scheme
(public routes: `security: []`); `@Idempotent()` routes document their `Idempotency-Key` header. Only when
`API_DOCS_ENABLED` (on by default in development and test); production refuses it, so there the routes don't exist
(404). "Try it out" for mutations needs the page's own origin in `API_ALLOWED_ORIGINS` (CSRF).

**Environment.** Validated by Zod before Nest starts (`apps/api/src/config/env.schema.ts`); an invalid environment
exits 1 with one `VARIABLE: reason` line per problem, never a value. Booleans are exactly `true` or `false`.

| Variable | Values | Default | Production |
|---|---|---|---|
| `NODE_ENV` | `development`, `test`, `production` | `development`, only while `API_HOST` is `127.0.0.1`, `::1` or `localhost`; on any other host it must be set | must be set |
| `APP_ROLE` | `http` (1.4 adds `gateway` and `feed`, later `worker`) | `http` | — |
| `API_HOST` | IP address or host name | `127.0.0.1` | containers set `0.0.0.0` |
| `API_PORT` | integer 0–65535 (0: any free port, tests) | `4000` | 1–65535 |
| `DATABASE_URL` | `postgres://` or `postgresql://` URL, without `query_timeout`, `statement_timeout` or `idle_in_transaction_session_timeout` | required | — |
| `DB_POOL_MAX` | integer 1–100 | `10` | — |
| `DB_CONNECT_TIMEOUT_MS` | integer 100–60 000 | `5000` | — |
| `DB_STATEMENT_TIMEOUT_MS` | integer 100–11 000 (below the 12 s transaction timeout) | `10000` | — |
| `REDIS_URL` | `redis://` or `rediss://` URL | required | — |
| `API_LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | `info` (`silent` in test) | not `trace`, not `silent` |
| `API_LOG_FORMAT` | `json`, `pretty` | `pretty` in development, else `json` | `json` |
| `API_TRUST_PROXY` | `false`, or the proxies' comma-separated IPs/CIDRs. `true` and hop counts are rejected | `false` | must be set explicitly |
| `API_ALLOWED_ORIGINS` | comma-separated exact origins (`scheme://host[:port]`, no path, no wildcard) | `http://localhost:3000` | required, `https://` only |
| `API_DOCS_ENABLED` | `true`, `false` | `true` (`false` in production) | `true` is rejected |
| `API_SHUTDOWN_DRAIN_MS` | integer 0–30 000 | `0` (`5000` in production) | — |
| `API_RATE_LIMIT_PUBLIC_PER_MIN` | integer 1–100 000 | `100` | — |
| `API_RATE_LIMIT_USER_PER_MIN` | integer 1–100 000 | `600` | — |
| `DEBUG` | — | unset | must be empty |

Fixed in code, not configurable: the 1 MiB body limit, the 15 s request timeouts, the transaction limits (2 s wait,
12 s run), the session lifetimes (7 days idle, 30 days absolute), the idempotency TTLs (30 s in flight, 24 h stored),
the 64 KiB stored-response cap, the `orders` policy (10 per second) and the `publicNet` multiplier (20).
