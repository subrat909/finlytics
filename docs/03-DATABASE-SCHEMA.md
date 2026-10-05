# 03 — Database Schema

Source of truth: `packages/database/prisma/schema.prisma` (+ `migrations/0001_timescale/migration.sql`).

## Entity map
```
User ─┬─ Account/Session (Auth.js)      ─ ApiKey
      ├─ BrokerAccount ─┬─ Order ─ Trade
      │                 ├─ Position
      │                 └─ StrategyDeployment ─ StrategyRunEvent
      ├─ Watchlist ─ WatchlistItem ─ Instrument
      ├─ Strategy ─┬─ StrategyDeployment
      │            └─ Backtest
      ├─ AgentRun ─ AgentSignal       ─ AutoTradeConfig ─ RiskLimit ─ TradingControl
      ├─ Alert ─ AlertEvent           ─ Notification ─ NotificationChannel
      ├─ DailyPnl                     ─ AuditLog (append-only)
Instrument ─ Tick (hypertable) ─ Candle (hypertable) ; OptionChainSnapshot (hypertable) ; MarketHoliday ; Plan ; GlobalControl
```

## Design decisions
- **Ownership**: every user-owned row carries `userId` and an index `(userId, <time> DESC)` for the dominant "my recent
  X" query. Composite uniques prevent duplicates from broker replays (`brokerAccountId + brokerOrderId`).
- **Money**: `Decimal(18,4)`; never float. Quantities `Int`. Volumes/OI `BigInt`.
- **Secrets**: `BrokerAccount.encryptedCredentials` + wrapped data key + IV + key version (envelope encryption, rotatable).
- **Time-series in TimescaleDB**: `Tick` (30-day retention, compressed), `Candle` M1 base + continuous aggregates for
  M5/M15/…, `OptionChainSnapshot` 1-min JSONB rows per strike (2-year retention) → backtests read a day's snapshots
  in one range scan. JSONB per snapshot (~400 strikes × 2) is far cheaper than 800 rows/min.
- **Hot reads from Redis, not Postgres**: live quotes, chain, P&L are computed from Redis hashes; Postgres stores
  state and history only. `DailyPnl` is materialised for the calendar.
- **Settings as JSONB** validated by Zod (`UserSettingsSchema`) — one row, no migrations for new toggles.
- **Audit**: `AuditLog` append-only trigger; partition by month in production (pg_partman) and archive to object storage.
- **Soft delete** only on `User` and `Strategy` (history must remain for deployments/backtests).
- **Sizing (10k users)**: ticks ≈ 2k instruments × 10/s × 6.25 h ≈ 450M rows/day → compressed ~3 GB/day, 30-day
  retention ≈ 90 GB; chain snapshots ≈ 5 underlyings × 8 expiries × 375 min × 60 KB ≈ 9 GB/day uncompressed → ~1 GB
  compressed; orders/trades negligible.

## Key queries & indexes
| Query | Index |
|---|---|
| Orders page | `Order(userId, placedAt DESC)`, `Order(userId, status)` |
| Token refresh job | `BrokerAccount(status, tokenExpiresAt)` |
| Alerts evaluator | `Alert(status, instrumentKey)` |
| Strategy runner | `StrategyDeployment(status)` |
| Chart history | PK `(instrumentKey, timeframe, ts)` + chunk exclusion |
| Backtest day | PK `(underlying, expiry, ts)` range scan |
| Instrument search | trigram GIN on name & symbol |
