# 03 — Database Schema

Source of truth: `packages/database/prisma/schema.prisma`, plus the hand-written SQL in the `timescale`, `db_guards`
and `kill_switch_and_audit_guards` migrations (see [Migrations](#migrations)): Prisma never generates TimescaleDB DDL,
triggers, functions or CHECK constraints. Apps use the bundled client from `@finlytics/database` (`getPrisma()`,
`createPrismaClient()`).

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
      └─ DailyPnl
Also: User ─ StrategyDeployment ; AgentRun ─ Order (optional) ; StrategyDeployment ─ Order (optional) ;
      BrokerAccount ─ AutoTradeConfig (optional)
Every edge between two user-owned tables is a composite foreign key on (id, userId): see Tenancy below.
No foreign keys: AuditLog (append-only; userId kept after the user is deleted) ;
                 Tick, Candle, OptionChainSnapshot (hypertables, keyed by instrumentKey / underlying) ;
                 MarketHoliday ; Plan ; GlobalControl (permanent singleton)
```

## Design decisions
- **Ownership**: every user-owned row carries `userId` and an index `(userId, <time> DESC)` for the dominant "my recent
  X" query. Composite uniques prevent duplicates from broker replays (`brokerAccountId + brokerOrderId`).
  Idempotency keys are unique **per user** (`Order(userId, idempotencyKey)`): a global unique would let one user's key
  block, or probe for, another user's order.
- **Tenancy in the database**: every relation between two user-owned tables is a composite foreign key,
  `(<fk>, userId) REFERENCES <parent>(id, userId)`, so a row can only reference rows of its own user, whatever ids the
  app passes. Each referenced model declares `@@unique([id, userId])` (BrokerAccount, Strategy, StrategyDeployment,
  Order, AgentRun). The 11 keys: Order → BrokerAccount, StrategyDeployment, AgentRun; Trade → BrokerAccount, Order;
  Position → BrokerAccount; StrategyDeployment → Strategy, BrokerAccount; Backtest → Strategy; AgentSignal → AgentRun;
  AutoTradeConfig → BrokerAccount. A new relation between user-owned tables must follow the same pattern
  (`tenancy.int.test.ts` lists the keys and fails on one without `userId`).
  - Required keys are `ON DELETE CASCADE`. The optional ones (`Order.strategyDeploymentId`, `Order.agentRunId`,
    `AutoTradeConfig.brokerAccountId`) are `ON DELETE NO ACTION`, **never `SET NULL`**: on a composite key, SET NULL
    would also null the required `userId`.
  - NO ACTION is checked at the end of the statement, so deleting a User cascades through these keys in one statement
    (as does deleting a BrokerAccount whose orders link to deployments on it). Deleting, on its own, a parent that one
    of these keys still references fails: the app must clear `AutoTradeConfig.brokerAccountId` before deleting that
    broker account on its own, and an order's `strategyDeploymentId` / `agentRunId` before deleting that deployment
    (or its strategy) or agent run.
  - Each of these keys has an index that starts with its first column, so `ON DELETE` lookups never scan the child
    table. The one exception is `AutoTradeConfig.brokerAccountId`: its lookup also matches `userId`, the primary key.
  - Like every foreign key, these are not enforced while `session_replication_role = replica` (see the replica-mode
    rule under [Migrations](#migrations)), so the app's database roles must never be superuser or hold SET on that
    parameter.
- **Money**: `Decimal(18,4)`; never float. Quantities `Int`. Volumes/OI `BigInt`.
- **Secrets**: `BrokerAccount.encryptedCredentials` + wrapped data key + IV + key version (envelope encryption, rotatable).
- **Time-series in TimescaleDB**: `Tick` (30-day retention, compressed), `Candle` M1 base + the `candle_m5` continuous
  aggregate (M15/H1/D1 come with 1.6), `OptionChainSnapshot` 1-min JSONB rows per strike (2-year retention) →
  backtests read a day's snapshots in one range scan. JSONB per snapshot (~400 strikes × 2) is far cheaper than
  800 rows/min.
- **No foreign keys on hypertables**: FK checks and their KEY SHARE locks would sit on the highest-volume insert path,
  and constraint DDL on compressed hypertables is restricted. Ingest validates instrument keys against the instrument
  master instead. Hypertables carry only their primary key plus the indexes declared in `schema.prisma`.
- **Instrument kinds**: `Segment` is the instrument kind (`EQ`, `INDEX`, `FUT`, `OPT`); the asset class follows the
  exchange (`MCX` = commodity, `CDS` = currency). `Instrument.symbol` is the trading symbol for EQ/INDEX and the
  underlying symbol (key token 2) for FUT/OPT.
- **Holidays**: `MarketHoliday` has one row per exchange calendar and date (PK `(exchange, date)`), because NSE and BSE
  close on the same dates. `closure` (`HolidayClosure`) records which part of the day is closed: `FULL_DAY`, or
  `MORNING_SESSION` / `EVENING_SESSION` for MCX's single-session closures.
- **Hot reads from Redis, not Postgres**: live quotes, chain, P&L are computed from Redis hashes; Postgres stores
  state and history only. `DailyPnl` is materialised for the calendar.
- **Settings as JSONB** validated by Zod (`UserSettingsSchema`) — one row, no migrations for new toggles.
- **Audit**: `AuditLog` is append-only in the database: triggers reject `UPDATE`, `DELETE` and `TRUNCATE`, also with
  `session_replication_role = replica` (they are `ENABLE ALWAYS`). It has no foreign key to `User` (append-only and
  `ON DELETE SET NULL` contradict each other), so deleting a user succeeds and the audit rows keep their `userId`, which
  the 5-year SEBI audit trail needs. **Monthly partitioning is still deferred**: it is planned for production with
  pg_partman (plus archiving to object storage) and needs the primary key to become `(id, createdAt)`.
- **Kill switch**: `GlobalControl` is a singleton, enforced by `CHECK ("id" = 1)`. The seed creates the row but never
  updates it, so a re-seed cannot switch off an engaged kill switch. The row is also **permanent**: triggers reject
  `DELETE` and `TRUNCATE` (`ENABLE ALWAYS`, so replica mode doesn't bypass them). Otherwise a deleted row would come back
  from the next create-only seed with `killSwitch = false`, silently disengaging an engaged switch. `UPDATE` stays
  allowed: that is how the switch is toggled. `GlobalControl` has no foreign key in either direction, so no
  `TRUNCATE … CASCADE` (`TRUNCATE "User" CASCADE` included) ever reaches it.
- **Soft delete** only on `User` and `Strategy` (history must remain for deployments/backtests).
- **Sizing (10k users)**: ticks ≈ 2k instruments × 10/s × 6.25 h ≈ 450M rows/day → compressed ~3 GB/day, 30-day
  retention ≈ 90 GB; chain snapshots ≈ 5 underlyings × 8 expiries × 375 min × 60 KB ≈ 9 GB/day uncompressed → ~1 GB
  compressed; orders/trades negligible.

## Migrations
`packages/database/prisma/migrations/`, applied in folder-name order:

| Migration | Written by | What it does |
|---|---|---|
| `20261005144900_init` | Prisma (`--create-only`), plus one line | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` at the top (the trigram indexes need it), then every enum, table, index and foreign key in `schema.prisma`. |
| `20261005144924_timescale` | hand-written | Creates the `timescaledb` extension. Converts `Tick` (1-day chunks), `Candle` (7 days) and `OptionChainSnapshot` (1 day) into hypertables with `create_default_indexes => FALSE`. Enables the columnstore (segment by instrument key, timeframe, or underlying + expiry; order by `ts DESC`) with compression policies after 2, 30 and 3 days. Adds retention policies (Tick 30 days, OptionChainSnapshot 730 days, Candle kept forever). Creates the `candle_m5` continuous aggregate from M1 candles `WITH NO DATA`, refreshed every 5 minutes. |
| `20261005144949_db_guards` | hand-written | The `GlobalControl_singleton` CHECK (`id = 1`), and the `audit_log_append_only()` function with two triggers on `AuditLog`: a row trigger for `UPDATE`/`DELETE` and a statement trigger for `TRUNCATE`. |
| `20261005172722_tenant_fks` | Prisma (`--create-only`), plus a header comment | Tenancy binding (see Tenancy above). Adds the unique indexes `(id, userId)` on BrokerAccount, Strategy, StrategyDeployment, Order and AgentRun. Replaces 10 single-column foreign keys with composite `(<fk>, userId)` keys, and adds the new `AutoTradeConfig → BrokerAccount` key: CASCADE where the relation is required, NO ACTION where it is optional. Adds `StrategyDeployment.userId` (NOT NULL without a default, applied before any deployment existed; foreign key to User, cascade) with an index `(userId, startedAt DESC)`. Indexes the foreign key columns that had no leading index: `Trade(orderId)`, `Order(agentRunId)`, `Backtest(strategyId, createdAt DESC)`, `StrategyDeployment(brokerAccountId)`. |
| `20261005172756_kill_switch_and_audit_guards` | hand-written | `ENABLE ALWAYS` on both `AuditLog` triggers, so they fire with `session_replication_role = replica` too. The `global_control_permanent()` function with a row trigger rejecting `DELETE` and a statement trigger rejecting `TRUNCATE` on `GlobalControl`, both `ENABLE ALWAYS`. `UPDATE` is not guarded. |

Rules:
- Create a migration with `pnpm db:migrate --create-only --name <snake_case>`. When the schema hasn't changed, Prisma
  creates an empty migration for hand-written SQL. Never number folders by hand: `0001_…` sorts before every timestamp,
  so it would run first.
- **Prisma ≥ 7.4 runs `migration.sql` statement by statement, not atomically**, so every hand-written statement is
  idempotent (`IF NOT EXISTS`, `if_not_exists => TRUE`, `CREATE OR REPLACE`, `DROP … IF EXISTS` before `ADD`). If a
  migration fails partway: fix the SQL, run `prisma migrate resolve --rolled-back <migration>`, then re-apply. Never
  `migrate reset` or `db push`.
- **Guard triggers are `ENABLE ALWAYS`.** A trigger in the default (origin) mode does not fire while
  `session_replication_role = replica`, which any superuser, RDS `rds_superuser`, or a role granted SET on that
  parameter can set for its session. **`CREATE OR REPLACE TRIGGER` resets the mode to origin**, so a migration that
  replaces a guard trigger must repeat `ALTER TABLE … ENABLE ALWAYS TRIGGER …` after it (`guards.int.test.ts` checks
  every guard in replica mode). Foreign keys are internal origin-mode triggers, so replica mode skips them too.
- **`prisma migrate dev` refuses to run without a terminal when it has warnings to confirm**, for example "A unique
  constraint … will be added", which it prints even for empty tables. Read the warnings, then answer its prompt from a
  real terminal.
- **No drift by construction.** Prisma ignores views, triggers, functions and CHECK constraints when diffing, but not
  indexes: it would drop any index the database has and the schema doesn't declare. Hence `create_default_indexes =>
  FALSE` on every hypertable, and trigram indexes declared in the schema
  (`@@index([name(ops: raw("gin_trgm_ops"))], type: Gin)`) instead of raw SQL. The check (exit 0 = no drift, 2 = drift):
  ```
  SHADOW_DATABASE_URL=postgresql://finlytics:finlytics@localhost:5433/finlytics_shadow \
    pnpm --filter @finlytics/database exec prisma migrate diff \
    --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
  ```
  `--from-migrations` replays the migrations into the shadow database (an empty scratch database on the same server;
  Prisma wipes it before use). Prisma 7.8 removed the CLI flag, so its URL must come from the config.
- **Connections** (`packages/database/prisma.config.ts`, which loads the repo-root `.env` without overriding variables
  already set): Prisma CLI commands use `DATABASE_DIRECT_URL`, falling back to `DATABASE_URL` (blank counts as unset);
  `SHADOW_DATABASE_URL` is optional. The seed resolves its database the same way (`resolveCliDatabaseUrl` in
  `src/env.ts`), so `db:deploy && db:seed` always seed the database just migrated, and it prints that target as
  `host:port/database`. The runtime client (`getPrisma()`) reads `DATABASE_URL` and `DB_POOL_MAX` (default 10),
  validated by Zod on first use. To point the CLI at another database, set `DATABASE_DIRECT_URL` (and `SHADOW_DATABASE_URL`)
  explicitly: setting only `DATABASE_URL` is not enough when `.env` defines `DATABASE_DIRECT_URL`.

## Key queries & indexes
| Query | Index |
|---|---|
| Orders page | `Order(userId, placedAt DESC)`, `Order(userId, status)` |
| Order idempotency | unique `Order(userId, idempotencyKey)` |
| Deployments page | `StrategyDeployment(userId, startedAt DESC)` |
| Backtests of a strategy | `Backtest(strategyId, createdAt DESC)` |
| Trades of an order | `Trade(orderId)` |
| Token refresh job | `BrokerAccount(status, tokenExpiresAt)` |
| Alerts evaluator | `Alert(status, instrumentKey)` |
| Strategy runner | `StrategyDeployment(status)` |
| Chart history | PK `(instrumentKey, timeframe, ts)` + chunk exclusion |
| Backtest day | PK `(underlying, expiry, ts)` range scan |
| Market open/closed | PK `MarketHoliday(exchange, date)` |
| Instrument search | trigram GIN on name & symbol (`instrument_name_trgm`, `instrument_symbol_trgm`) |
