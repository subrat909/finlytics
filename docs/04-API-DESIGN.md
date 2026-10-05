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
| Health | `GET /healthz` `GET /readyz` `GET /metrics` |

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
`ERROR_TITLES`, `problemTypeUrl()`, `isProblemDetails()`, `isKnownErrorCode()` and `isRetryableErrorCode()`. The
server validates every problem it sends against `ProblemDetailsSchema`, which is strict at every level: an unknown
member fails validation, so nothing internal (stack trace, SQL, raw broker payload) can ride along. Clients use
`isProblemDetails()`, which is tolerant as RFC 9457 §3.2 requires: it ignores members it doesn't know and accepts codes
newer than the client build, so an open tab survives a deploy (narrow with `isKnownErrorCode()`).
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
| `detail` | no | a human-readable explanation of this occurrence |
| `instance` | no | a URI reference for this occurrence, e.g. the request path |
| `requestId` | yes | the `x-request-id` correlation id, also in every log line |
| `errors` | no | field-level validation errors, at most 100 (`MAX_FIELD_ERRORS`; servers keep the first 100): `{ path, message, code? }`. `path` is a dot path into the request body, the way react-hook-form names fields (`"legs.0.strike"`), and `""` means the body as a whole. `message` is safe to show next to the field. `code` is an optional machine-readable reason, e.g. a Zod issue code (`"too_small"`) |
| `broker` | no | the broker's own error, `{ code, message? }`, for `BROKER_REJECTED` and `BROKER_UNAVAILABLE` |
| `retryAfterSec` | no | whole seconds to wait before retrying. Mirrors the `Retry-After` header that 429 and 503 responses carry |

| HTTP status | Codes |
|---|---|
| 400 | `VALIDATION` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `IDEMPOTENT_REPLAY`, `NEEDS_RELOGIN` |
| 422 | `BROKER_REJECTED`, `RISK_LIMIT`, `INSUFFICIENT_FUNDS`, `MARKET_CLOSED` |
| 423 | `KILL_SWITCH` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` |
| 503 | `BROKER_UNAVAILABLE` |

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
- **Retries.** Only `RATE_LIMITED` and `BROKER_UNAVAILABLE` are retryable (`isRetryableErrorCode`): wait
  `retryAfterSec` (or back off) and send the same request again. A retried order placement reuses its
  `Idempotency-Key`. Every other code needs a change before a retry can succeed.
- **Changing the contract.** Adding a code means adding it to `ERROR_CODES` with a status and a title, plus a row in the
  table above. Codes are never renamed or removed.
