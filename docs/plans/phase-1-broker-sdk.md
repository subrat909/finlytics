# Phase 1.1 — `packages/broker-sdk` (roadmap 1.1)

Status: **built — in review** · 2026-10-06 · branch `feat/phase-1-broker-sdk` · pre-approved by the user (speed run)

Inputs: CLAUDE.md, `.claude/rules/{broker,backend,testing,security}.md`, `.claude/skills/broker-adapter`, docs/01, docs/04
§3 and §6, foundations carry-forward 12, api-bootstrap carry-forward 2 (GCRA).

## Scope and demo
The broker contract and its guard rails, no real broker yet: `BrokerAdapter` (the 12 operations), normalised models,
typed errors, feed interfaces, `BrokerRateLimiter` (Redis), `CircuitBreaker`, timeouts, `BrokerGateway`,
`BrokerRegistry` and an in-memory `PaperAdapter` with a reusable contract suite. Demo: the contract suite and the Redis
integration tests pass; a paper order fills, shows up in positions, and emits order updates.

## Decisions
| # | Decision | Why |
|---|---|---|
| B1 | **Shared types** (carry-forward 12): `BrokerCode`, `InstrumentKey` (branded), `OrderType`, `ProductType`, `Validity`, `Exchange`, `Segment`, `OptionType`, and the money schemas come from `@finlytics/shared`. Prices and money are decimal strings (`PriceSchema`, `MoneySchema`); decimal.js in logic; quantities are ints. Ticks carry prices as strings too. | One source of truth; no floats for prices. |
| B2 | **Method names follow broker.md exactly**: `getAuthUrl`/`exchangeToken`, `refreshToken`, `getProfile`, `getFunds`, `downloadInstrumentMaster`, `placeOrder`, `modifyOrder`, `cancelOrder`, `getOrderBook`, `getPositions`+`getHoldings`, `getHistoricalCandles`, `connectMarketFeed`/`connectOrderFeed`. `BROKER_METHODS` maps each to its operation number; a type test keeps it equal to the interface, and the contract suite checks an adapter exposes nothing else. Every network method takes a context `{ creds, signal }`. | "Adding a method is an architecture decision" becomes a failing test. |
| B3 | **Models are Zod schemas** (orders, trades, positions, holdings, funds, profile, instrument rows, candles, auth start, order inputs). The gateway validates inputs before the broker and adapter outputs after it. Ticks have a schema for fixtures but are not parsed per tick (hot path). `OrderSide`, broker order statuses (Prisma's minus `FAILED`) and timeframes (Prisma's) are local tuples. | Data crosses the broker boundary here; adapters can't leak malformed data. |
| B4 | **Errors**: `BrokerError` (brand via `Symbol.for`, no `instanceof` across copies) with `code: ErrorCode` from shared: `BrokerRejectedError` (BROKER_REJECTED), `BrokerUnavailableError` (BROKER_UNAVAILABLE) ⊃ `BrokerTimeoutError`, `CircuitOpenError`; `NeedsReloginError` (NEEDS_RELOGIN), `RateLimitedError` (RATE_LIMITED, `retryAfterMs`), `BrokerNotFoundError` (NOT_FOUND), `BrokerInputError` (VALIDATION), `BrokerInternalError` (INTERNAL), `DependencyUnavailableError` (SERVICE_UNAVAILABLE: Redis down). `outcomeUnknown` is set on mutating calls that failed without a definitive answer: reconcile via the order book. | Maps 1:1 onto problem+json; 2.1 knows when to reconcile. |
| B5 | **Secrets**: `Secret` wraps tokens (`reveal()`; `toString`/`toJSON`/inspect print `[REDACTED]`). The gateway scrubs every error message with the call's secret values plus token patterns (Bearer, JWT, `access_token=`), single-line, ≤ 500 chars, and drops `cause`. The logger only gets broker, accountId, operation, duration and error code. | Tokens can't reach logs or problem details by accident. |
| B6 | **Rate limiter = GCRA** (a token bucket with one number of state) in one Lua script on the Redis clock (`TIME`), the same arithmetic as the api's `gcra.lua.ts`. Buckets per broker, account and class (`orders`, `data`, `standard`), key `brl:<BROKER>:<accountId>:<class>`. `tryAcquire` and `acquire({ maxWaitMs, signal })`; Redis errors fail closed (`DependencyUnavailableError`). `MemoryRateLimiter` runs the TS model for paper/tests. Decision on carry-forward 2: broker-sdk exports the model and script; the api switches to them in 2.1 (not in this PR). | One script, atomic, skew-free; property tests compare the model with a classic token bucket. |
| B7 | **Default limits** (docs re-read 2026-10-06; a bucket admits at most `burst + rate − 1` per second): Upstox standard 25/s burst 10 (broker.md), orders 8/s burst 3 (Upstox: 10/s for non-registered algos), data = standard; Dhan standard 15/s burst 5 (20/s), orders 8/s burst 3 (10/s), data 4/s burst 2 (5/s); Paper 100/s; other brokers 5/s until their adapter. Per-minute/hour/day windows are not enforced locally: a broker 429 is `RateLimitedError` (follow-up). | Per-second caps hold; longer windows are documented. |
| B8 | **Circuit breaker** per broker and account, in process: closed → open after N consecutive failures **or** a failure rate over a rolling window (with a minimum of calls) → half-open after a cool-down, a limited number of trial calls → closed on success, open again on failure. Failures = `BROKER_UNAVAILABLE` and `INTERNAL` only (rejections, relogin, 429, not-found are the broker working). State changes are observable. | Fail closed on a sick broker; user errors don't trip it. |
| B9 | **Timeouts**: `withTimeout(fn(signal), { timeoutMs, signal })`, default 5 s per call (instrument master 120 s, feed connect 10 s); the adapter gets an `AbortSignal` that aborts on timeout or caller abort, and the gateway rejects on time even if the adapter ignores it. | backend.md: 5 s, never hang. |
| B10 | **Retries only for reads** (`getProfile`, `getFunds`, `getOrderBook`, `getPositions`, `getHoldings`, `getHistoricalCandles`) on retryable errors, with backoff + jitter (default 2 retries). Never for `placeOrder`, `modifyOrder`, `cancelOrder`, `exchangeToken` (single-use code) or `refreshToken` (rotating tokens). A `placeOrder` timeout is `BrokerTimeoutError{ outcomeUnknown }`. | broker.md: reconcile, never blindly retry a place. |
| B11 | **`BrokerGateway`** wraps one adapter: validate → circuit breaker → rate limiter → timeout → adapter → validate output → map and redact errors → log. It owns **one** market feed per broker and one order feed per broker (or per account when the adapter declares `orderFeedScope: "account"`, docs/01). | The single entry point; the WS budget is enforced in code. |
| B12 | **Feeds**: typed `on(event, listener) → unsubscribe` (no Node `EventEmitter` `error` crash). `MarketFeed.subscribe(keys, mode)` / `unsubscribe(keys)` take key sets; ref-counting stays in the api (1.4). The feed keeps its current set (`subscriptions()`) and re-subscribes it after a reconnect; `FeedSubscriptions` enforces `maxFeedInstruments`; `backoffDelayMs` (exponential, jitter) is exported for 1.2's reconnect loop. | One shared connection per broker; 1.2/1.3 reuse the helpers. |
| B13 | **PaperAdapter**: in memory, no network, serialised by an internal queue. Quotes from an injected `PaperQuoteSource` (`MemoryQuoteSource` for tests). MARKET fills at ask/bid (else LTP); LIMIT when crossed, at the quote; SL/SL_M trigger on LTP. IOC cancels the rest. Partial fills via `maxFillQtyPerMatch`; resting orders re-match on each quote. Business rejections (no quote, lot size, tick size, freeze qty, funds) end in `REJECTED` with a message, like broker RMS. Charges are a pluggable function (default zero). Positions per key+product from fills; P&L = sell value − buy value + net × LTP; margin = open exposure at average price. Order and trade updates on its (app-scoped) order feed. State is per process: 2.x persists paper orders. | Deterministic, broker-like behaviour for the contract suite and paper trading. |
| B14 | **Contract suite** `src/__tests__/adapter.contract.ts` (`describeBrokerAdapterContract(harness)`) runs against Paper now and against Upstox/Dhan fixtures (nock/msw) in 1.2/1.3. | broker.md step 3. |
| B15 | **Package**: like shared (tsdown 0.23 dual ESM/CJS, same watch-mode `clean`/`hash`), but `platform: "node"` (ioredis; never imported by the browser). Node lint preset; tsconfig extends `../config/tsconfig/node.json`; coverage ≥ 90 %; `test:integration` with `@testcontainers/redis` on `redis:7.4-alpine` (a unit test keeps it equal to compose). | Same conventions as Phase 0. |

## Files
- `packages/broker-sdk/`: `package.json` (exports, scripts), `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`,
  `vitest.integration.config.ts`, `README.md`, `test/pkg/smoke.{mjs,cjs}`, `test/integration/*`.
- `src/`: `index.ts`, `adapter.ts`, `models.ts`, `credentials.ts`, `errors.ts`, `redact.ts`, `timeout.ts`,
  `circuit-breaker.ts`, `gateway.ts`, `registry.ts`, `feed/{emitter,feed,subscriptions,backoff}.ts`,
  `rate-limit/{limits,gcra,gcra.lua,rate-limiter,memory-rate-limiter}.ts`,
  `brokers/paper/{adapter,engine,feed,quotes,charges}.ts`, `__tests__/adapter.contract.ts` + unit and property tests.
- Repo: root `eslint.config.mjs` (drop the ignore, node scope), `.github/workflows/ci.yml` (comment), docs/01 (Redis
  key), docs/02 (folder tree).

## Checklist
- [x] `pnpm --filter @finlytics/broker-sdk typecheck lint test` (coverage ≥ 90 %)
- [x] `pnpm --filter @finlytics/broker-sdk test:integration` (Docker) and `check:pkg`
- [x] root `pnpm lint` and `pnpm typecheck`
- [ ] `/review` and `/security-audit` (broker, secrets)

## Carry-forward
1. **1.2/1.3:** adapters read the official docs into `types.ts`; recorded, redacted fixtures; run the contract suite;
   reconnect + heartbeat on `backoffDelayMs` and `FeedSubscriptions`; declare `orderFeedScope`.
2. **1.2:** multi-window buckets (Upstox 500/min, 2000/30 min; Dhan 250/min, 1000/h orders) if 429s show up.
3. **1.2 (api):** ESLint `no-restricted-imports` so only the broker module imports adapters (docs/04 §3); add
   `brl:*` to `apps/api/src/infra/redis/keys.ts`.
4. **2.1:** the api's HTTP rate limiter imports GCRA from broker-sdk; mirror `OrderSide`/`OrderStatus`/`Timeframe` in
   shared; OrderService reconciles `outcomeUnknown` placements by `tag` via `getOrderBook`.
5. **2.x:** persist paper state (Order/Trade `isPaper`); holdings and T+1 for paper DELIVERY.
