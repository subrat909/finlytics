---
description: Broker integration rules — the 12-endpoint budget, adapter contract, Upstox/Dhan specifics.
globs: ["packages/broker-sdk/**", "apps/api/src/modules/broker/**", "apps/api/src/modules/market-feed/**"]
---

# Broker Integration Rules

## The adapter contract
Every broker implements `BrokerAdapter` (`packages/broker-sdk/src/adapter.ts`). The platform only ever calls these **12 operations** — nothing else may hit a broker:

| # | Operation                 | When called                                  |
|---|---------------------------|----------------------------------------------|
| 1 | `getAuthUrl` / `exchangeToken` | Once per login (OAuth) — one-time login UX   |
| 2 | `refreshToken`            | Scheduled job before expiry                  |
| 3 | `getProfile`              | Once on connect                              |
| 4 | `getFunds`                | On dashboard open + after fills (cached 5 s) |
| 5 | `downloadInstrumentMaster`| Once per day at 08:00 IST (job)              |
| 6 | `placeOrder`              | User/strategy action                         |
| 7 | `modifyOrder`             | User/strategy action                         |
| 8 | `cancelOrder`             | User/strategy action                         |
| 9 | `getOrderBook`            | Reconcile on reconnect / every 60 s fallback |
|10 | `getPositions` + `getHoldings` | On page open + after fills (cached 5 s) |
|11 | `getHistoricalCandles`    | Chart backfill (cached in Timescale; never re-fetch what we have) |
|12 | `connectMarketFeed` / `connectOrderFeed` | **One** WS each per broker, shared by all users |

Quotes, LTP, option chain, depth, OI → **always from the market feed WS → Redis**, never REST.

## Upstox specifics (apps using Upstox API v2)
- OAuth2 authorization code; access token valid till 03:30 next day; no refresh → daily re-login prompt scheduled 08:30 IST (one-click, we keep client creds).
- Market data feed: protobuf over WSS (`MarketDataFeedV3`), modes `ltpc | full | option_greeks` (Upstox provides Greeks in full mode for options — prefer broker Greeks, compute fallback).
- Order updates: portfolio stream WSS.
- Rate limits: 50 req/s, 500/min, 2000/30 min per user — enforce 25 req/s in our limiter.

## Dhan specifics (DhanHQ v2)
- Static access token (30-day) generated from the Dhan dashboard; user pastes once → encrypted vault; renewal reminder 3 days before expiry.
- Market feed: binary WSS with packet codes (ticker/quote/full/depth); max 5000 instruments per connection; option chain REST exists but is rate-limited (1 req/3 s) → we use the feed instead.
- Order update WSS ("Live Order Update").

## Adding a new broker (use `/add-broker <name>`)
1. Create `packages/broker-sdk/src/brokers/<name>/` with `adapter.ts`, `feed.ts`, `mappers.ts`, `types.ts`, `fixtures/`.
2. Map broker symbols to our canonical `instrumentKey` (`NSE_FO|NIFTY|2025-10-30|24000|CE`).
3. Implement contract tests from `packages/broker-sdk/src/__tests__/adapter.contract.ts`.
4. Register in `BrokerRegistry`; add logo + OAuth settings in `apps/web/src/features/brokers/config.ts`.

## Never
- Never store broker password. Never call broker from the frontend. Never bypass `BrokerGateway`.
