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
| Users/Settings | `GET/PATCH /v1/me` `GET/PUT /v1/me/settings` (JSONB: appearance, trading defaults, notifications) `GET /v1/me/export` `DELETE /v1/me` |
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

## 6. Error contract (RFC 7807)
```json
{ "type": "https://finlytics.app/errors/broker-rejected", "title": "Broker rejected order", "status": 422,
  "code": "BROKER_REJECTED", "detail": "Insufficient margin", "requestId": "…", "broker": { "code": "…" } }
```
Stable codes: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `IDEMPOTENT_REPLAY`,
`BROKER_UNAVAILABLE`, `BROKER_REJECTED`, `RISK_LIMIT`, `KILL_SWITCH`, `MARKET_CLOSED`, `NEEDS_RELOGIN`.
