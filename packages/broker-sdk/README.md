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

Official docs re-read on 2026-10-06 (phase 1b); every adapter's `types.ts` copies field names and enums from them.

| Broker                                | Auth                | Token life                                | Market feed                                                      | Order feed            | Docs                                            |
| ------------------------------------- | ------------------- | ----------------------------------------- | ---------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Upstox (REST v2, V3 feed, V3 candles) | OAuth2 code         | till 03:30 IST next day, no refresh       | WSS protobuf (`MarketDataFeedV3`, modes ltpc/full/option_greeks) | WSS portfolio stream  | https://upstox.com/developer/api-documentation/ |
| Dhan (DhanHQ v2)                      | pasted access token | 24 h (since v2.4, Sep 2025); `RenewToken` | WSS binary packets, ≤ 5000 instruments/conn                      | WSS live order update | https://dhanhq.co/docs/v2/                      |
| Paper                                 | none                | never expires                             | quote source (mirrors a real feed)                               | simulated fills       | internal (`src/brokers/paper`)                  |

Each broker lives in `src/brokers/<name>/` (`adapter.ts`, `feed.ts`, `mappers.ts`, `types.ts`, `fixtures/`), registered
in `createBrokerRegistry()`. Rate limits and quirks are at the top of each `adapter.ts`.

### Market feed limits

`capabilities.feedLimits` (`FeedLimits`): the instruments one connection carries per feed mode, `single` (every key in
that mode) and `mixed` (each mode's cap while several modes share the connection); `maxFeedInstruments` caps the total.
A subscription beyond them is BROKER_REJECTED (`FEED_CAPACITY`).

| Broker | `single` ltp / quote / full | `mixed` ltp / quote / full | Notes                                                                                                 |
| ------ | --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Upstox | 5000 / 2000 / 2000          | 2000 / 1500 / 1500         | per user (one connection here); 2 connections per user (5 with Plus); `quote` = full or option_greeks |
| Dhan   | 5000 / 5000 / 5000          | 5000 / 5000 / 5000         | 5000 per connection in any mix, 100 per subscribe message, 5 connections per user                     |
| Paper  | 5000 / 5000 / 5000          | 5000 / 5000 / 5000         |                                                                                                       |

So "full up to the limit, ltp beyond" on Upstox is: all `full` up to 2000 keys, else 1500 `full` + up to 2000 `ltp`.

### Ticks

A `Tick` carries everything the feed knows at that moment: `ltp`, `ts`, `ltq`, `close` (previous close: Upstox `cp`,
Dhan's prev-close packet), the day's `open`/`high`/`low` (Upstox `marketOHLC` interval `1d`, also for indices; Dhan
quote/full packets), `atp`, `volume` (Upstox `vtt`), `oi`, `tbq`/`tsq` (book totals), best `bid`/`ask` with
quantities, and `depth` (5 levels, best first). Prices the broker reports as 0 ("none yet") and OI of 0 are left out.
Dhan splits an instrument across packets (trade, OI, prev close); its feed merges them so every tick is complete.

### Market indices

Both masters name the pinned indices exactly as `MARKET_INDEX_KEYS` (@finlytics/shared) through one table,
`MARKET_INDEX_ALIASES` (`src/index-aliases.ts`): Upstox `NSE_INDEX|Nifty 50` (trading symbol `NIFTY`) and Dhan
`IDX_I` 13 (`NIFTY`, "Nifty 50") both become `NSE_INDEX|NIFTY 50`, with the dev seed's trading symbol and name. Dhan's
fixed ids (13, 25, 27, 442, 21, 51, 69) win over symbols; other indices keep the broker's own name (`SENSEX50` stays
`BSE_INDEX|SENSEX50`). Equities are `NSE_EQ|<exchange symbol>` from both masters (`NSE_EQ|M&M`, `NSE_EQ|BAJAJ-AUTO`).

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

| Broker | orders (place/modify/cancel) | data (candles) | standard (everything else) | Broker's own limits                                                                       |
| ------ | ---------------------------- | -------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| Upstox | 8/s, burst 3 (≤ 10/s)        | 25/s, burst 10 | 25/s, burst 10 (broker.md) | orders 10/s (non-registered algo), others 50/s; 500/min, 2000/30 min per API              |
| Dhan   | 8/s, burst 3 (≤ 10/s)        | 4/s, burst 2   | 15/s, burst 5              | orders 10/s, 250/min, 1000/h, 7000/day; data 5/s, 100000/day; non-trading 20/s; quote 1/s |
| Paper  | 100/s                        | 100/s          | 100/s                      | none                                                                                      |

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

## Upstox broker (1.2)

`UpstoxAdapter` (`src/brokers/upstox/`; quirks and limits at the top of `adapter.ts`) needs an
`UpstoxInstrumentResolver` for canonical ↔ Upstox keys (`NSE_FO|52618`, `NSE_EQ|<ISIN>`): the api backs it with
`InstrumentBrokerToken`; `UpstoxInstrumentMap` is the in-memory one. `fetch` and the WebSocket factory are injectable
(Node 24's globals by default). Users bring their own Upstox app: `getAuthUrl({ state, redirectUri, apiKey })` and
`exchangeToken({ code, redirectUri, fields: { apiKey, apiSecret } })`, else the platform's `appCredentials`. Tokens end
at 03:30 IST (`upstoxTokenExpiry`); `refreshToken` is NEEDS_RELOGIN. Feeds: V3 protobuf market feed authorized by
`GET /v3/feed/market-data-feed/authorize` (single-use `authorized_redirect_uri`, re-authorized on every reconnect; the
`MarketDataFeedV3.proto` text ships inside the bundle; `quote` is `option_greeks` for options, `full` otherwise) and
the portfolio stream for orders (`orderFeedScope: "account"`). Candles: V3 historical + intraday (minutes and hours
from January 2022, days from January 2000; earlier days are never asked for). Positions and holdings carry
`close_price` as `close`; equity rows the resolver doesn't know yet map through their trading symbol (`NSE_EQ|YESBANK`,
series suffix `-EQ` dropped), derivatives need the synced master. Tests: `src/brokers/upstox/__tests__/` (a fake
Upstox serving the doc-derived fixtures, plus the contract suite).

## Dhan broker (1.3, hardened in 1b)

`DhanAdapter` (`src/brokers/dhan/`). Connect: the user pastes the access token (web.dhan.co → My Profile → Access
DhanHQ APIs; valid 24 hours) and optionally the client id. `exchangeToken` cleans the paste (whitespace, quotes,
`Bearer `), refuses an expired JWT or another client's token before calling Dhan, checks it with `GET /v2/profile`
(header `access-token`; read forgivingly: numbers for strings, nulls, extra fields), takes the client id from the token
or the profile when the form leaves it empty, and sets `expiresAt` from the JWT `exp`, else `tokenValidity`
(`DD/MM/YYYY HH:mm` IST). `refreshToken` is `GET /v2/RenewToken` with headers `access-token` + `dhanClientId`: the old
token dies and a new 24-hour one comes back (only a live token renews; an expired one is NEEDS_RELOGIN). The docs show
no response body, so any of `{ accessToken, expiryTime }`, snake case, a `data` envelope or the bare token is read;
`expiresAt` falls back to 24 hours from now. Errors: DH-901 and 807–810 (also in the legacy `remarks.error_code` form,
or by `errorType` `Invalid_Authentication`) are NEEDS_RELOGIN; DH-904/805 RATE_LIMITED; DH-907 NOT_FOUND (an empty
list for reads). Funds read `availabelBalance` (sic) or `availableBalance`. Positions, holdings and the order book skip
a row they can't read or identify instead of failing the list. Orders, positions and both feeds need the instrument
map: fill it with `downloadInstrumentMaster` or `DhanInstrumentMap.load(InstrumentBrokerToken rows)` and pass it as
`instruments`. The market feed stops reconnecting after a disconnect packet 806–810 (status `down` + the error).

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
