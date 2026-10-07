# 03 — Database Schema

Source of truth: `packages/database/prisma/schema.prisma`, plus the hand-written SQL in the `timescale`, `db_guards`,
`kill_switch_and_audit_guards`, `audit_actor_checks` and `lowercase_email_checks` migrations (see
[Migrations](#migrations)): Prisma never generates TimescaleDB DDL, triggers, functions or CHECK constraints. Apps use the bundled client from
`@finlytics/database` (`getPrisma()`, `createPrismaClient()`); integration tests get a migrated database from
`@finlytics/database/testing` (see [Test databases](#test-databases)).

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
  - **Subject and actor**: `userId` is whose data the action concerns; `actorId` is who acted (a user or admin id, or
    an agent run id), indexed `(actorId, createdAt DESC)`. Two CHECK constraints guard every new row: `actorType` is
    one of `user`, `admin`, `system`, `agent`, and `actorId` is required unless `actorType` is `system`. They are
    `NOT VALID` (existing rows are not re-checked; append-only rows could never be corrected anyway), and unlike
    triggers and foreign keys they also hold in replica mode. The api writes `actorId` through `AuditService`.
- **Email is case-insensitive, by normalisation**: every writer stores `normalizeEmail(email)` (`@finlytics/shared`:
  trimmed, then lowercased) and looks users up the same way, so the plain unique index on `User.email` is
  case-insensitive in effect. `CHECK ("email" = lower("email"))` on `User` and `CHECK ("identifier" =
  lower("identifier"))` on `VerificationToken` (Auth.js stores the email as a magic-link identifier) reject a writer
  that forgets, instead of letting `Asha@x.in` open a second account. Both are validated (no row violated them when
  they were added) and, as CHECKs, also hold in replica mode. citext was rejected: an extension and a type Prisma maps
  poorly, for what one CHECK guarantees.
- **No OAuth provider tokens at rest**: `Account` keeps only `type`, `provider`, `providerAccountId`, `expires_at`,
  `token_type` and `scope`. Finlytics never calls a sign-in provider's API, so `refresh_token`, `access_token`,
  `id_token` and `session_state` are not columns; the web app's Auth.js adapter strips them before every write.
  (Broker tokens are a different thing: encrypted in `BrokerAccount`, see Secrets.)
- **Roles are RBAC only**: `Role` is `USER` or `ADMIN` (default `USER`). What a user pays for is their `Plan`
  (`User.planId`: free, pro, elite), never a role.
- **Sessions** (Auth.js, validated by the api): `Session.sessionToken` holds `hashSessionToken(token)` from
  `@finlytics/shared`: the SHA-256 of the cookie token's UTF-8 bytes, as lowercase hex (Web Crypto, so the web app's
  adapter and the api share one function). Never the token itself, so a database read can't be replayed as a session. `createdAt` (database default)
  anchors the 30-day absolute lifetime; `lastSeenAt` the 7-day idle limit, written by the api at most every 5 minutes.
  The contract (cookie names, token format, limits) is in `@finlytics/shared` (`SESSION_*`).
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
| `20261005191736_audit_actor_and_session_created_at` | Prisma (`--create-only`), plus a header comment and `IF NOT EXISTS` | Adds the nullable `AuditLog.actorId` (catalog-only: no row rewritten, no trigger fired, the guard triggers keep `ENABLE ALWAYS`) with the index `AuditLog(actorId, createdAt DESC)`, and `Session.createdAt` (`NOT NULL DEFAULT CURRENT_TIMESTAMP`, added without a table rewrite; existing rows get the migration time). |
| `20261005191803_audit_actor_checks` | hand-written | Two `NOT VALID` CHECKs on `AuditLog`: `AuditLog_actorType_check` (`actorType` in `user`, `admin`, `system`, `agent`) and `AuditLog_actorId_check` (`actorType = 'system' OR actorId IS NOT NULL`). Each is dropped if it exists before it is added. |
| `20261006100205_drop_oauth_tokens_and_pro_role` | Prisma (`--create-only`), rewritten by hand to be idempotent | Removes `PRO` from `Role`: Prisma's retype-and-swap (create `Role_new` with `USER`, `ADMIN`; retype `User.role`; rename; drop the old type; restore the `USER` default) runs inside one `DO` block, atomic in PostgreSQL, and only while the enum still has `PRO`, so a re-run does nothing. Any `PRO` user becomes `USER` first (there were none). Drops `Account.refresh_token`, `access_token`, `id_token` and `session_state` with `DROP COLUMN IF EXISTS` (all empty). |
| `20261006100229_lowercase_email_checks` | hand-written | Two validated CHECKs, each dropped if it exists before it is added: `User_email_lowercase_check` (`email = lower(email)`) and `VerificationToken_identifier_lowercase_check` (`identifier = lower(identifier)`). |

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
  `host:port/database`. To point the CLI at another database, set `DATABASE_DIRECT_URL` (and `SHADOW_DATABASE_URL`)
  explicitly: setting only `DATABASE_URL` is not enough when `.env` defines `DATABASE_DIRECT_URL`.

## Runtime connections
`getPrisma()` creates the process-wide client on its first call from the variables below, validated by Zod
(`loadDatabaseEnv`); `createPrismaClient()` takes the same settings as options. The api builds its env schema from the
same shape (`databaseEnvShape` plus the `checkDatabaseEnv` refinement) and its client with
`createPrismaClient({ ...prismaClientOptionsFromEnv(env), applicationName: "finlytics-api" })`.

| Variable | Rule | Default | Becomes |
|---|---|---|---|
| `NODE_ENV` | `development`, `test` or `production` | `development` | — |
| `DATABASE_URL` | required; a `postgres://` or `postgresql://` URL without `query_timeout`, `statement_timeout`, `idle_in_transaction_session_timeout`, `application_name` or `options` parameters; surrounding whitespace is trimmed | — | the pg pool's `connectionString` (trimmed) |
| `DB_POOL_MAX` | integer 1–100 | `10` | pool size (`max`) |
| `DB_CONNECT_TIMEOUT_MS` | integer 100–60 000 | `5000` | the longest wait for a pooled or new connection (`connectionTimeoutMillis`) |
| `DB_STATEMENT_TIMEOUT_MS` | integer 100–11 000, below the 12 s transaction timeout (and so the api's 15 s request timeout) | `10000` | the server-side `statement_timeout` |
| `DEBUG` | must be empty when `NODE_ENV=production` (Prisma's and ioredis' debug output includes query parameters) | unset | — |

- **Every connection** carries `statement_timeout`, `idle_in_transaction_session_timeout` (15 s) and `application_name`
  (`finlytics` unless the caller names itself) as startup parameters, so they hold for every query, including Prisma's
  own. Server-side timeouts cancel the work in PostgreSQL; there is deliberately no client-side `query_timeout`, which
  would give up on a query and leave it running. No URL parameter can change them: pg merges URL parameters over the
  pool's options, so `statement_timeout`, `idle_in_transaction_session_timeout` and `application_name` in the URL would
  replace the configured values, and `options` (`-c name=value`) would add server settings of its own. The URL rules
  above reject all of them, and `createPrismaClient()` applies the same rules to its `url` (TypeError).
- **One trimmed URL**: `createPrismaClient()` trims `url` once and both checks and connects with the trimmed string.
  pg would read a URL with a leading space as a relative path, so the whole URL, password included, would become the
  database name.
- **Interactive transactions** (`$transaction(async (tx) => …)`): by default at most 5 s to get a connection
  (`maxWait`) and 12 s to finish (`timeout`); the api passes `{ maxWaitMs: 2000, timeoutMs: 12000 }`. The statement
  timeout must stay below the transaction timeout, so PostgreSQL cancels a slow statement before Prisma gives up on the
  transaction: `createPrismaClient()` throws a `RangeError` unless `statementTimeoutMs < transaction.timeoutMs`, and
  `DB_STATEMENT_TIMEOUT_MS` is capped at 11 000 so any valid environment passes with a 12 s transaction timeout. The
  15 s idle-in-transaction timeout ends a session stranded inside a transaction and releases its locks.
- **How each limit fails** (what the api maps to `503 SERVICE_UNAVAILABLE`): a statement timeout is Prisma `P2010` with
  SQLSTATE `57014` in `meta.driverAdapterError.cause.originalCode`; a transaction past its timeout, or one that can't
  start within `maxWait`, is `P2028`; a query that waits longer than `DB_CONNECT_TIMEOUT_MS` for a pooled connection is
  a plain `Error` from pg-pool, `"timeout exceeded when trying to connect"`, with no Prisma name or code. A session
  ended by the idle-in-transaction timeout gets PostgreSQL's FATAL `25P03` ("terminating connection due to
  idle-in-transaction timeout") as an `error` event on its connection (adapter-pg's `onConnectionError`), and the
  transaction's next statement fails with a plain `Error`, `"Client has encountered a connection error and is not
  queryable"`. The pool recovers from all of them (`client.int.test.ts`).
- **Logging**: `log` accepts only the strings `info`, `warn` and `error`; `query` and log-event definitions
  (`{ level, emit }`) are refused, because query logs carry bound parameters.
- **One client per process**: `getPrisma()` caches the client on `globalThis` under
  `Symbol.for("@finlytics/database/prisma")` in every environment, so the ESM and CJS builds of the package (each with
  its own module scope) share one client and one pool. The client may come from the other build, so recognise Prisma
  errors by `name` and `code`, never with `instanceof`.

## Test databases
`@finlytics/database/testing` (source: `packages/database/src/testing/`, built as a separate entry, so the client
entry never loads testcontainers) gives integration tests a real PostgreSQL + TimescaleDB. It needs Docker and the
optional peer dependencies `testcontainers` and `@testcontainers/postgresql`.

- `startTestDatabase({ migrate = true })` starts one container from `TIMESCALE_IMAGE` (the tag pinned in
  `docker-compose.yml`; a unit test keeps them equal) with a **random password per container**, creates `finlytics_it`
  (migrated with `prisma migrate deploy`, target asserted) and an empty `finlytics_it_shadow`, and returns
  `{ adminUrl, databaseUrl, shadowDatabaseUrl, stop() }`. Testcontainers publishes the port on all host interfaces
  (it has no host-IP option); that is accepted, because the container lives for one run and its password is random.
  When a step after the start fails, it stops the container and rethrows that step's error; if stopping fails too, it
  throws an `AggregateError` holding both, so a failed stop never hides why the setup failed.
- `createDatabase(adminUrl, name)`, `uniqueDatabaseName(prefix)`, `migrateDeploy(target)`, `runPrismaCli(args, target)`
  and `runProcess(...)` are the building blocks. Every helper refuses a URL on port 5432 or 5433, or without a port,
  so a test can never touch the dev database, and every Prisma CLI run sets `DATABASE_URL`, `DATABASE_DIRECT_URL` and
  `SHADOW_DATABASE_URL` itself, so nothing from the root `.env` applies.

## Key queries & indexes
| Query | Index |
|---|---|
| Orders page | `Order(userId, placedAt DESC)`, `Order(userId, status)` |
| Order idempotency | unique `Order(userId, idempotencyKey)` |
| Session lookup (every authenticated request) | unique `Session(sessionToken)` (the token's SHA-256) |
| A user's audit trail / what an actor did | `AuditLog(userId, createdAt DESC)` / `AuditLog(actorId, createdAt DESC)` |
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
