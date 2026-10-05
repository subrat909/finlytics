---
name: broker-adapter
description: Step-by-step method for implementing or fixing a broker adapter in packages/broker-sdk (Upstox, Dhan, or new). Use when any broker API, feed, or symbol mapping work is needed.
---

# Broker Adapter Skill

1. **Docs first**: WebFetch the official docs listed in `packages/broker-sdk/README.md`. Paste exact request/response shapes into `types.ts`. Never guess.
2. **Canonical instrument**: `instrumentKey = "<exchange>_<segment>|<symbol>|<expiry?>|<strike?>|<CE|PE?>"`. Write `toBrokerSymbol()` / `fromBrokerSymbol()` with table-driven tests.
3. **Auth**: implement `getAuthUrl`, `exchangeToken`, `refreshToken`. Store only what `BrokerVaultService` encrypts. Set `tokenExpiresAt` precisely (Upstox: 03:30 IST next day; Dhan: 30 days).
4. **12 operations only**; wrap each in `withRateLimit(brokerId)` and `withCircuitBreaker()`; normalise errors to `BrokerError{code, retryable}`.
5. **Feeds**: binary parsing in a `Transform` stream; heartbeat; reconnect with backoff+jitter; resubscribe ref-counted keys; emit normalised `Tick` (`{k, ltp, ts, v, oi, bid, ask, depth?, greeks?}`).
6. **Fixtures & contract tests**: record one real response per operation (redacted) into `fixtures/`; run `adapter.contract.test.ts`.
7. **Register** in `BrokerRegistry` and document limits/quirks at the top of `adapter.ts`.
