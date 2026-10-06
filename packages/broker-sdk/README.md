# @finlytics/broker-sdk

The only way Finlytics talks to a broker (`.claude/rules/broker.md`): the 12-operation `BrokerAdapter` contract,
normalised models, typed errors, and the guard rails every call goes through. Node only (the browser never talks to a
broker). ESM and CJS. Plan and decisions: `docs/plans/phase-1-broker-sdk.md`.

```ts
import { BrokerGateway, BrokerRateLimiter, createBrokerRegistry, MemoryQuoteSource } from "@finlytics/broker-sdk";

const adapter = createBrokerRegistry().create("PAPER", { quotes: new MemoryQuoteSource() });
const gateway = new BrokerGateway({ adapter, rateLimiter: new BrokerRateLimiter(redis), logger });
const { brokerOrderId } = await gateway.placeOrder({ accountId, creds }, order);
```

## Brokers

| Broker                    | Auth                | Token life              | Market feed                                                      | Order feed            | Docs                                            |
| ------------------------- | ------------------- | ----------------------- | ---------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Upstox (API v2 / v3 feed) | OAuth2 code         | till 03:30 IST next day | WSS protobuf (`MarketDataFeedV3`, modes ltpc/full/option_greeks) | WSS portfolio stream  | https://upstox.com/developer/api-documentation/ |
| Dhan (DhanHQ v2)          | static access token | 30 days                 | WSS binary packets, ≤5000 instruments/conn                       | WSS live order update | https://dhanhq.co/docs/v2/                      |
| Paper                     | none                | never expires           | quote source (mirrors a real feed)                               | simulated fills       | internal (`src/brokers/paper`)                  |

Upstox lands in 1.2 and Dhan in 1.3, each in `src/brokers/<name>/` (`adapter.ts`, `feed.ts`, `mappers.ts`, `types.ts`,
`fixtures/`), registered in `createBrokerRegistry()`.

## The rules in code

| Rule                                      | Where                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly 12 operations                     | `BrokerAdapter` + `BROKER_METHODS` (`src/adapter.ts`); a type test and the contract suite fail on any other public method                                      |
| Nothing calls an adapter directly         | `BrokerGateway` (`src/gateway.ts`): validate → circuit breaker → rate limiter → 5 s timeout → adapter → validate output → typed, redacted error → log          |
| One market WS and one order WS per broker | the gateway hands every caller the same feed (order feeds per account only when the adapter's `orderFeedScope` is `account`)                                   |
| Canonical instruments, exact money        | `InstrumentKey` and `PriceSchema`/`MoneySchema` from `@finlytics/shared`; prices are decimal strings, also on ticks; quantities are ints                       |
| Never blindly retry a place               | only reads are retried; a failed `placeOrder`/`modifyOrder`/`cancelOrder` without an answer has `outcomeUnknown: true`: reconcile with `getOrderBook` by `tag` |
| Tokens never in logs or messages          | `Secret` (prints `[REDACTED]`), `redactSecrets` on every error message and broker message, logs carry broker, accountId, operation, duration and code only     |
| Fail closed                               | an open circuit (`CircuitOpenError`) or a Redis outage in the limiter (`DependencyUnavailableError`, 503) stops calls                                          |

## Errors

Every error is a `BrokerError` with a stable code from `@finlytics/shared` (the api's problem+json filter maps it):
`BrokerRejectedError` (BROKER_REJECTED, 422), `BrokerUnavailableError` / `BrokerTimeoutError` / `CircuitOpenError`
(BROKER_UNAVAILABLE, 503), `NeedsReloginError` (NEEDS_RELOGIN, 409), `RateLimitedError` (RATE_LIMITED, 429,
`retryAfterMs`), `BrokerNotFoundError` (NOT_FOUND), `BrokerInputError` (VALIDATION), `BrokerInternalError` (INTERNAL:
an adapter bug or invalid output), `DependencyUnavailableError` (SERVICE_UNAVAILABLE). The broker's own code and
message are in `brokerError` (the problem's `broker` member). Use `isBrokerError()`, not `instanceof`.

## Rate limits

`BrokerRateLimiter`: GCRA (a token bucket) in one Lua script on the Redis clock, one bucket per broker, account and
class, key `brl:<BROKER>:<accountId>:<class>`. `tryAcquire` or `acquire({ maxWaitMs, signal })`. `MemoryRateLimiter`
runs the same model in process (paper, tests). A bucket admits at most `burst + ratePerSec − 1` requests per second.

| Broker | orders (place/modify/cancel) | data (candles) | standard (everything else) | Broker's own limits                                                          |
| ------ | ---------------------------- | -------------- | -------------------------- | ---------------------------------------------------------------------------- |
| Upstox | 8/s, burst 3 (≤ 10/s)        | 25/s, burst 10 | 25/s, burst 10 (broker.md) | orders 10/s (non-registered algo), others 50/s; 500/min, 2000/30 min per API |
| Dhan   | 8/s, burst 3 (≤ 10/s)        | 4/s, burst 2   | 15/s, burst 5              | orders 10/s, 250/min, 1000/h, 7000/day; data 5/s; non-trading 20/s           |
| Paper  | 100/s                        | 100/s          | 100/s                      | none                                                                         |

Only per-second limits are enforced locally; longer windows show up as the broker's 429 (`RateLimitedError`).

## Circuit breaker and timeouts

Per broker and account: opens after 5 consecutive failures or ≥ 50 % failures over 30 s (10 calls minimum), half-opens
after 15 s for one trial call. Only `BROKER_UNAVAILABLE` and `INTERNAL` count as failures. Timeouts: 5 s per call,
120 s for the instrument master, 10 s for feed connects; the adapter receives an `AbortSignal`.

## Paper broker

`PaperAdapter` fills from an injected `PaperQuoteSource` (`MemoryQuoteSource` in tests): MARKET at ask/bid (else LTP),
LIMIT when crossed, SL/SL_M on the LTP trigger, IOC cancels the rest, `maxFillQtyPerMatch` for partial fills,
`charges(fill)` pluggable. RMS-style rejections (lot size, freeze quantity, tick size, funds, no quote) end in
`REJECTED`. Positions, P&L and margin follow from its trades in exact decimals. State is per process (2.x persists it).

## Writing an adapter (1.2, 1.3)

1. Read the official docs (links above) and copy exact field names into `types.ts`; map symbols to canonical keys.
2. Implement `BrokerAdapter`; keep helpers in module functions or `#private` members; throw typed `BrokerError`s.
3. Feeds: `FeedSubscriptions` for the key set and capacity, `backoffDelayMs` for reconnects, `TypedEmitter` for events;
   re-subscribe `subscriptions()` after every reconnect; emit `status`.
4. Record one redacted response per operation in `fixtures/`, serve them with nock/msw, and run
   `describeBrokerAdapterContract` from `src/__tests__/adapter.contract.ts`. Never hit a live broker in tests.
5. Register the factory in `createBrokerRegistry()` and add its options to `BrokerFactoryOptionsMap`.

## Scripts

```
pnpm --filter @finlytics/broker-sdk test               unit, property and contract tests, coverage ≥ 90 %
pnpm --filter @finlytics/broker-sdk test:integration   the rate limiter on Redis (Testcontainers, redis:7.4-alpine)
pnpm --filter @finlytics/broker-sdk check:pkg          publint, attw, ESM and CJS smoke tests on dist/
```
