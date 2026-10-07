# Phase 0 — Foundations (roadmap 0.1–0.3)

Status: **built and reviewed — open review findings await decisions** · 2026-10-05 · branch `feat/phase-0-foundations` · build with `/build-feature phase-0-foundations`

**How this plan was made.** The `architect` subagent drafted it from `CLAUDE.md`, `.claude/rules/*` and `docs/01–04, 08`. It was then corrected against version facts verified on 2026-10-05 from the npm registry, release tags and source code (§2b).

**(verify)** marks a step whose exact syntax depends on the installed version. Keep the intent and adjust the syntax.

## 0. Bootstrap (already done)

Done before this plan, so PR0 is complete:
- git initialised with a repo-local identity; the kit is committed on `main` (`1fd6f49`); work happens on `feat/phase-0-foundations`.
- `.env` was created from `.env.example`:
  - `AUTH_SECRET` and `MASTER_KEY` generated with `openssl rand -base64 32`
  - `REDIS_HOST_PORT=6380` and `REDIS_URL=redis://localhost:6380` (host port 6379 is used by another local Redis)
  - `POSTGRES_HOST_PORT=5433`, with `DATABASE_URL` and `DATABASE_DIRECT_URL` on `localhost:5433`. A native PostgreSQL 18 (`/Library/PostgreSQL/18`, serving another project) owns 5432. **On this machine, anything on `localhost:5432` is NOT the Finlytics database.**
  - mode 600, ignored by git
- `docker-compose.yml` updated (PR1's compose task is done):
  - images pinned to `timescale/timescaledb-ha:pg16.15-ts2.30.2` and `redis:7.4-alpine`
  - Redis healthcheck added
  - every port bound to `127.0.0.1`
  - host ports configurable via `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT`
  - postgres, redis and mailpit are running
- `.env.example` updated (PR1's env-documentation task is done):
  - `connection_limit` dropped from `DATABASE_URL` (adapter-pg ignores it; the pool size is `DB_POOL_MAX`)
  - `DB_POOL_MAX=10` added
  - optional `SHADOW_DATABASE_URL` added
  - `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` added
- **Builders must not read or edit `.env` or `.env.example`.** `.claude/settings.json` denies `Read(./.env.*)`, and that pattern also matches `.env.example`. If a new variable turns out to be needed, stop and list it for the user.
- Holidays are seeded for **2025 and 2026**: backtests and expiry calendars need history. 2027 is added when the exchanges publish it, usually in December.
- No `apps/*` code in this phase. The first consumers arrive in 0.4–0.6.

## 1. Summary & user stories

Phase 0 has three parts:
- **0.1** makes the kit installable, with lint, format and commit rules enforced.
- **0.2** turns `packages/database` into a migrated, seeded TimescaleDB schema with no drift, plus database-level guards.
- **0.3** ships `@finlytics/shared`: the canonical instrument-key grammar, exact money helpers, the error contract and user settings.

Nothing in this phase is visible to users.

| # | Story | Acceptance criteria |
|---|---|---|
| US1 | As a developer I can install and check the monorepo with one command per check. | On Node 24 these all exit 0: `pnpm i --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. pre-commit runs lint-staged. commit-msg rejects messages that aren't Conventional Commits. CI runs static → unit → integration → security with `contents: read`. |
| US2 | As a developer with port clashes I can run the infra on configurable, localhost-only ports. | Every compose service comes up healthy with `POSTGRES_HOST_PORT=5433` and `REDIS_HOST_PORT=6380`. All ports are bound to 127.0.0.1. The Timescale tag is pinned. (Met by bootstrap.) |
| US3 | As a backend developer I get a migrated TimescaleDB with no drift. | `pnpm db:migrate` on a fresh DB applies `init → timescale → db_guards` (plus `tenant_fks → kill_switch_and_audit_guards`, added in review). `prisma migrate status` reports up to date. `prisma migrate diff --from-migrations … --to-schema … --exit-code` exits 0. The three hypertables have no default time indexes. Compression, retention and continuous-aggregate jobs are registered. |
| US4 | As an operator I can re-run the seed safely in any environment. | `pnpm db:seed` run twice leaves the same row counts. An engaged global kill switch and edited plan prices survive a re-seed. Every holiday row traces to an official circular recorded in its data file. |
| US5 | As the compliance owner I need AuditLog to be append-only in the database, without blocking user deletion. | UPDATE, DELETE and TRUNCATE on AuditLog raise an error. Deleting a User who has audit rows succeeds, and those rows keep their `userId`. |
| US6 | As a web or api developer I can use the shared and database packages from both ESM and CJS. | publint and attw report no issues. `require()` and `import()` smoke tests pass on Node 24. `shared` imports no Node built-ins and nothing from Prisma. `shared` coverage is ≥ 90%. |
| US7 | As a developer I can parse and format instrument keys with a guaranteed round-trip. | Property test: `format(parse(k)) === k`. Invalid keys return a typed reason. Every valid key maps to a Prisma `Exchange` and `Segment`. |
| US8 | As a developer I get exact money values end to end. | No `number` arithmetic on prices. Round-to-tick properties hold. INR formatting is deterministic: `₹1,23,45,678.90`, `₹1.23 Cr`. |
| US9 | As a developer I have one shared contract for errors and settings. | Every `ErrorCode` has an HTTP status and a type URL. `parseUserSettings({})` returns full defaults and never throws. A patch with an unknown key fails validation. |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Compiled internal packages built with tsdown `0.23.0`** (exact pin): ESM, CJS and types for both. The `exports` map lists types/import/require, with top-level `main`/`types` fallbacks and `sideEffects:false`. Gates: publint, attw, and `require`/`import` smoke scripts. Declarations come from tsc, not `isolatedDeclarations`, which doesn't fit `export const X = z.object(…)`. | Next 15 consumes ESM and Nest 11 consumes CJS. turbo already makes typecheck, lint and test depend on `^build`. tsup's README says it is unmaintained and points to tsdown. |
| D2 | `@finlytics/database` bundles the generated client into `dist`. `@prisma/client`, `@prisma/adapter-pg` and `pg` stay external. If the generated code breaks the CJS build (top-level await or `import.meta`), ship ESM-only and rely on Node 24 `require(esm)`. | One artefact serves web, api and the seed, so consumers never run `prisma generate`. |
| D3 | One root `eslint.config.mjs`, composed from `@finlytics/eslint-config` presets (`base`, `library`, `node`; react/next/nest come later) and scoped by globs. No per-package configs. Each package's `lint` is `eslint . --max-warnings=0`. It ignores `packages/ui/**` and `packages/broker-sdk/**` until 0.4 and 1.1 scaffold them. | turbo, lint-staged and the PostToolUse hook in `.claude/settings.json` (which runs from the repo root) then all use the same config. |
| D4 | lint-staged globs that don't overlap: `*.{ts,tsx,mts,cts}` → [`eslint --fix --max-warnings=0`, `prettier --write`]; `*.{js,mjs,cjs,json,md,css,yml,yaml}` → `prettier --write`. | In the kit both globs match `.ts`. lint-staged runs globs concurrently, so two tools would write the same file at once. |
| D5 | Three migrations: `<ts>_init` (generated, plus a pg_trgm line at the top), `<ts>_timescale`, `<ts>_db_guards`. The kit folder `0001_timescale` is removed with `git rm -r` **before any migrate command**: it sorts before Prisma's timestamped folders, so it would run first and fail. | Fixes the ordering bug and keeps the guards separate from TimescaleDB DDL. |
| D6 | Prevent drift by construction: `create_default_indexes => FALSE` on every hypertable, and trigram GIN indexes declared in the schema, replacing the btree `@@index([name])`. Acceptance is `prisma migrate diff --exit-code` exiting 0. A second `migrate dev` is not a reliable check: it is interactive when it finds drift. | Prisma emits `DROP INDEX` for any database index the schema doesn't declare. |
| D7 | `prisma.config.ts` loads the root `.env` with `config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true })` (no override). It sets `shadowDatabaseUrl` from `SHADOW_DATABASE_URL` through a conditional spread, required by `exactOptionalPropertyTypes`. It uses `process.env`, **not** the `env()` helper, because that throws when a variable is missing and would break `prisma generate` in CI. The test harness sets `DATABASE_URL`, `DATABASE_DIRECT_URL` **and** `SHADOW_DATABASE_URL`, and asserts which database it targets. | Prisma 7 doesn't auto-load `.env`, and the config prefers `DATABASE_DIRECT_URL`. A test that sets only `DATABASE_URL` would therefore migrate the dev DB. |
| D8 | AuditLog: **remove the foreign key** (keep `userId String?` and its indexes, no relation). Strict triggers: a row trigger blocks UPDATE and DELETE; a statement trigger blocks TRUNCATE. | Append-only and `ON DELETE SET NULL` contradict each other. SEBI's 5-year audit trail needs the actor id. |
| D9 | `createPrismaClient({ url, poolMax, log })` is pure and throws on an empty URL. A lazy `getPrisma()` reads env through Zod on its first call and caches on globalThis outside production. Nothing is constructed at import time. `DB_POOL_MAX` defaults to 10. | Constructing at import time reads env too early. `pg` given an undefined connection string silently falls back to `PG*` variables and localhost. |
| D10 | Schema corrections before the first migration: see §4. | Each is cheap only while no data exists. |
| D11 | Seed: `Plan` and `GlobalControl` are **create-only** (`update: {}`). Holidays are upserted from JSON, which is the source of truth for the years it covers. | The seed will run in production deploys. A re-seed must never switch off an engaged kill switch or overwrite prices an admin edited. |
| D12 | Holiday calendars: **NSE** (also NFO), **BSE** (also BFO), **MCX** (rows record which session is closed), and **CDS from its own currency-derivatives circular**. `holidayCalendarFor(exchange)` lives in shared. | NSE currency derivatives close on bank holidays such as Annual Bank Closing; MCX often closes only one session. |
| D13 | The instrument-key grammar in §5 is fixed now. Symbols are uppercase; display case lives in `Instrument.name`. Symbol characters are `[A-Z0-9 &\-._()/]`, up to 64. API: strict `parse`, lenient `normalize`, branded type. | Keys become the `Instrument` primary key and are stored inside compressed hypertables. Changing the grammar later would be the most expensive change in the system. |
| D14 | Money: a private `Decimal.clone({ precision: 40 })` (never a global `Decimal.set`). Input rejects leading zeros. Output uses `toFixed`, so never an exponent and never `-0`. INR is formatted without `Intl`. | Exact arithmetic, no config shared with Prisma's Decimal, and identical output on server and browser, so no hydration mismatch. |
| D15 | Errors: the docs/04 codes plus `INTERNAL`, `CONFLICT` and `INSUFFICIENT_FUNDS`. `INSUFFICIENT_FUNDS` is only for our own pre-trade check; broker margin rejections stay `BROKER_REJECTED` with `broker.code`. ProblemDetails adds `errors[]` and `retryAfterSec`, and follows RFC 9457 (which replaces 7807). | A stable, complete contract that forms can use. |
| D16 | Settings: lenient reads with per-field `.catch()`. Nested object defaults use Zod 4 `.prefault()`, because `.default()` does not apply inner defaults. Writes use a strict deep-partial patch that **rejects** unknown keys. `mergeUserSettings` is pure. docs/04 changes `PUT` to `PATCH /v1/me/settings`. | Silently dropping keys on write hides client bugs. A section-level patch can't overwrite another section edited in a second tab. |
| D17 | Zod mirrors of the Prisma enums live in shared, with a sync test in `packages/database` (shared is a devDependency there). shared never imports Prisma. | Keeps shared browser-safe, and CI catches drift between the two. |
| D18 | Compose is done (see §0). Testcontainers uses **the same pinned tag**, read from one constant; a unit test asserts compose and the constant match. | A floating `pg16` tag changes the extension version under existing volumes. |
| D19 | A pnpm `catalog:` (pnpm 9.12 supports it) pins typescript, zod, decimal.js, vitest, tsdown and the Prisma trio at one version each. When moving to pnpm 10, add an `onlyBuiltDependencies` allowlist (prisma, esbuild). **Done in review:** pnpm 10.34.6 (9.12.0 had 26 advisories, 12 high) with `onlyBuiltDependencies` and `ignoredBuiltDependencies` in `pnpm-workspace.yaml`. | A version mismatch between the Prisma CLI and client breaks generation. |
| D20 | CI: actions pinned by SHA; `permissions: contents: read`; `concurrency` cancels superseded PR runs; `HUSKY=0`; `timeout-minutes` per job; the integration job runs Testcontainers, including the drift test. | Supply-chain safety, cost and determinism. |
| D21 | `.nvmrc` is `24`; `engines.node` is `>=24.11`. TypeScript is **~6.0.3**. | lint-staged 17 and testcontainers 12 need Node ≥ 22.22, and tsdown needs ≥ 24.11 on the 24 line. TS 7 (Go) has no stable API, and typescript-eslint requires `<6.1`. |

## 2b. Verified versions & facts (2026-10-05)

| Package | Pin | Note |
|---|---|---|
| prisma, @prisma/client, @prisma/adapter-pg | **7.10.0 exact** | npm `latest` for `prisma` is **8.0.0-rc.19, a different product**. Never run `pnpm add prisma` without a version. Use the `prisma.io/docs/orm/v7/…` docs. |
| typescript | ~6.0.3 | — |
| eslint / typescript-eslint | ^9.39 / ^8.71 | ESLint 10 exists, but `eslint-config-next@15` and the react, import and jsx-a11y plugins support only ESLint 9. |
| tsdown / publint / @arethetypeswrong/cli | 0.23.0 / ^0.3 / ^0.18 | — |
| vitest + @vitest/coverage-v8 | **5.0.3 exact pair** | Peer is `vite ^6.4 ‖ ^7 ‖ ^8`; add vite if pnpm reports it missing. |
| zod | ^4.6 | `.default({})` doesn't apply inner defaults; use `.prefault({})`. nestjs-zod 5.5 and @hookform/resolvers 5.9 support Zod 4. |
| testcontainers, @testcontainers/postgresql | ^12.2 | — |
| husky / lint-staged / @commitlint/cli + config-conventional | ^9.1.7 / ^17.6 / ^21.2 | — |
| turbo / prettier / decimal.js / tsx / fast-check / dotenv / pg | ^2.11 / ^3.9 / ^10.6 / ^4.23 / ^4.10 / ^18 / ^8.23 | dotenv ≥ 17 logs on load: always pass `quiet: true`. |

**Prisma 7**
- `prisma.config.ts` is loaded by c12/jiti, so `import.meta.dirname` works. `.env` is not auto-loaded. The config is looked up in the current directory only.
- `migrate dev` no longer runs `generate` or the seed. The seed runs only through `prisma db seed` (config `migrations.seed`).
- Generated `prisma-client` files start with `// @ts-nocheck` and `/* eslint-disable */`. Under `moduleResolution: bundler`, imports are extensionless ESM.
- The drift check `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` (exit 2 = drift) **needs `datasource.shadowDatabaseUrl` in the config**. The CLI flag was removed in 7.8.
- Prisma never generates DDL for triggers, functions or CHECK constraints, never drops views in a diff, and never drops unknown extensions. `postgresqlExtensions` is still Preview, so don't use it.
- **Since 7.4, `migration.sql` runs statement by statement and is not atomic.** If Prisma's SQL parser fails, it falls back to one implicit transaction. Therefore every custom SQL statement must be idempotent.

**TimescaleDB 2.30.2** on PG 16.15 (amd64 and arm64)
- The legacy `create_hypertable(t, 'ts', chunk_time_interval => …)` and `timescaledb.compress*` options are deprecated but still work.
- Use `by_range(...)` and the `enable_columnstore` / `segmentby` / `orderby` options.
- `add_compression_policy` and `add_retention_policy` are supported functions. Use them rather than the `CALL add_columnstore_policy` procedure.
- A continuous aggregate created `WITH NO DATA` is allowed inside a transaction.

## 3. Files to create / modify

**Root**
- `package.json` (modify):
  - scripts: `format:check`, `test:integration`, `check:pkg`, `db:deploy`, `db:status`
  - devDeps: eslint, @commitlint/cli, @commitlint/config-conventional, publint, @arethetypeswrong/cli, @finlytics/prettier-config
  - `"prettier": "@finlytics/prettier-config"`
  - the lint-staged fix (D4)
  - `engines.node` `>=24.11`
  - bump the existing devDeps to §2b
- `pnpm-workspace.yaml` (modify): add `packages/config/*` and a `catalog:`.
- `turbo.json` (modify):
  - add `eslint.config.mjs` to `globalDependencies`
  - `globalPassThroughEnv`: `CI`, `GITHUB_ACTIONS`, `HUSKY`, `DOCKER_HOST`, `TESTCONTAINERS_*`
  - add `generate` to `lint.dependsOn`
  - `dev.dependsOn` → `[^build, generate]`
  - new `test:integration` task (`dependsOn [^build, generate]`, `cache: false`)
  - new `check:pkg` task (`dependsOn [build]`)
- New:
  - `eslint.config.mjs`, `commitlint.config.mjs`
  - `.husky/pre-commit` (`pnpm exec lint-staged`), `.husky/commit-msg` (`pnpm exec commitlint --edit "$1"`)
  - `.editorconfig`, `.nvmrc` (`24`)
  - `.prettierignore`: `dist`, `coverage`, `.turbo`, `pnpm-lock.yaml`, `packages/database/src/generated`, `CLAUDE.md`, `.claude/`, `docs/`
- `.gitignore` (modify): add `*.tsbuildinfo` and `packages/database/src/generated/`.
- New `.github/workflows/ci.yml` and `.github/dependabot.yml`: npm weekly, with a `prisma` group so the trio moves together; github-actions weekly.
- Docs (modify):
  - `docs/02-FOLDER-STRUCTURE.md`: seed-data folder, migration naming
  - `docs/03-DATABASE-SCHEMA.md`: §4 changes, migration names, partitioning still deferred
  - `docs/04-API-DESIGN.md`: §6 status table, settings verb
  - `docs/09-CLAUDE-CODE-WORKFLOW.md`: Node 24, ports, pnpm version
  - `CLAUDE.md` §5: add `db:seed`, `test:integration`, `check:pkg`
- Already done in bootstrap: `docker-compose.yml`, `.env.example`.

**packages/config**
- `tsconfig/{package.json, library.json, node.json}`:
  - presets extend `../../../tsconfig.base.json`, which stays the single source
  - `library.json`: DOM libs, declaration and declarationMap
  - `node.json`: lib ES2023, `types: ["node"]`
  - set `types` explicitly in every preset (verify the TS 6 defaults)
- `eslint-config/{package.json, base.js, library.js, node.js}`:
  - `base.js`: @eslint/js; typescript-eslint `strictTypeChecked` with `projectService`; `no-explicit-any: error`; `consistent-type-imports`; `disableTypeChecked` for `*.{js,mjs,cjs}`; eslint-config-prettier last
  - `library.js`: bans `node:*`, `@finlytics/database` and `@prisma/*` (used for shared)
- `prettier/{package.json, index.json}`: printWidth 120, double quotes, semicolons, `trailingComma: "all"`.

**packages/database**
- `package.json` (modify):
  - `"type": "module"`, exports/main/types/files, `sideEffects: false`
  - scripts: `generate`, `build` (tsdown), `dev` (`tsdown --watch`), `typecheck`, `lint`, `test`, `test:integration`, `check:pkg`, `migrate`, `deploy`, `status`, `studio`, and **`seed` = `prisma db seed`**
  - deps: @prisma/client, @prisma/adapter-pg, pg, dotenv, zod
  - devDeps: prisma, tsx, tsdown, vitest, testcontainers, @testcontainers/postgresql, @finlytics/tsconfig; `@finlytics/shared` is added in PR5
- New: `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `vitest.integration.config.ts`.
- Modify: `prisma.config.ts` (D7) and `prisma/schema.prisma` (§4).
- Migrations: `git rm -r prisma/migrations/0001_timescale`; create `migration_lock.toml`, `<ts>_init/`, `<ts>_timescale/`, `<ts>_db_guards/`.
- Seed:
  - `prisma/seed.ts` (entry point)
  - `prisma/seed/{run.ts, plans.ts, holidays.ts}` (`holidays.ts` holds the Zod schema for the data files)
  - `prisma/seed-data/market-holidays-2025.json`, `prisma/seed-data/market-holidays-2026.json`
- Source: `src/env.ts`, `src/client.ts` (modify), and `src/index.ts`, which exports `createPrismaClient`, `getPrisma`, and the generated types and enums.
- Tests:
  - unit: `src/__tests__/{client,migrations-layout,seed-data,enum-sync}.test.ts`
  - integration: `test/integration/{timescale-image.ts, global-setup.ts, migrations.int.test.ts, guards.int.test.ts, constraints.int.test.ts, seed.int.test.ts, cjs-smoke.cjs}`

**packages/shared**
- `package.json` (deps: zod and decimal.js only), `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` (coverage ≥ 90%), `README.md` (key grammar, URL encoding).
- `src/index.ts`, `src/types/result.ts`, `src/constants/exchanges.ts`, `src/schemas/{enums,errors,user-settings}.ts`, `src/money.ts`, `src/instrument-key.ts`.
- Tests: `src/__tests__/*.test.ts` plus `*.property.test.ts`.

## 4. Prisma changes & custom SQL

```diff
 // header comment: hypertables are converted by migrations/<ts>_timescale
 generator client { provider = "prisma-client"  output = "../src/generated" }   // defaults: ESM, extensionless (bundler resolution)
 enum Segment {
-  EQ FUT OPT INDEX COMMODITY CURRENCY
+  EQ INDEX FUT OPT          // instrument kind; asset class follows exchange (MCX = commodity, CDS = currency)
 }
+enum HolidayClosure { FULL_DAY MORNING_SESSION EVENING_SESSION }   // the part of the day that is CLOSED
 model Instrument {
-  symbol String // underlying/trading symbol
+  symbol String // EQ/INDEX: trading symbol; FUT/OPT: underlying symbol (= key token 2)
-  candles Candle[]   ticks Tick[]
-  @@index([name]) // + pg_trgm GIN index in raw migration
+  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "instrument_name_trgm")
+  @@index([symbol(ops: raw("gin_trgm_ops"))], type: Gin, map: "instrument_symbol_trgm")
 }
 model Tick   { - instrument Instrument @relation(fields: [instrumentKey], references: [key]) }
 model Candle { - instrument Instrument @relation(fields: [instrumentKey], references: [key]) }
 model MarketHoliday {
-  date DateTime @id @db.Date
+  date DateTime @db.Date
+  closure HolidayClosure @default(FULL_DAY)
+  @@id([exchange, date])
 }
 model Order { - idempotencyKey String @unique   + idempotencyKey String   + @@unique([userId, idempotencyKey]) }
 model User  { - auditLogs AuditLog[] }
 model AuditLog { - user User? @relation(fields: [userId], references: [id], onDelete: SetNull) }
   // comment: append-only via <ts>_db_guards; monthly partitioning deferred (pg_partman, prod)
 model GlobalControl { }   // comment: singleton enforced by CHECK (id = 1) in <ts>_db_guards
```

Why each of these must happen now:
- **MarketHoliday PK:** the seed in this phase writes NSE and BSE rows on the same dates.
- **`closure`:** without it, the MCX rows written now would be wrong.
- **Segment:** shared's mapping and the instrument master (1.2) build on it. Removing enum values later means a type swap plus a data remap.
- **Idempotency key:** a global unique lets one user's key block, or probe for, another user's order.
- **Hypertable FKs:** FK checks and KEY SHARE locks sit on the highest-volume insert path, and constraint DDL on compressed hypertables is restricted. Ingest validates keys against the instrument master instead.

**`<ts>_init/migration.sql`**: generated with `--create-only`, then this line is added at the top:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**`<ts>_timescale/migration.sql`**: every statement is idempotent (Prisma ≥ 7.4 executes them one by one).
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Tick: 1-day chunks, columnstore after 2 days, drop after 30 days
SELECT create_hypertable('"Tick"', by_range('ts', INTERVAL '1 day'), create_default_indexes => FALSE, if_not_exists => TRUE);
ALTER TABLE "Tick" SET (timescaledb.enable_columnstore, timescaledb.segmentby = '"instrumentKey"', timescaledb.orderby = 'ts DESC');
SELECT add_compression_policy('"Tick"', INTERVAL '2 days', if_not_exists => TRUE);
SELECT add_retention_policy('"Tick"', INTERVAL '30 days', if_not_exists => TRUE);

-- Candle: 7-day chunks, columnstore after 30 days, keep forever
SELECT create_hypertable('"Candle"', by_range('ts', INTERVAL '7 days'), create_default_indexes => FALSE, if_not_exists => TRUE);
ALTER TABLE "Candle" SET (timescaledb.enable_columnstore, timescaledb.segmentby = '"instrumentKey", timeframe', timescaledb.orderby = 'ts DESC');
SELECT add_compression_policy('"Candle"', INTERVAL '30 days', if_not_exists => TRUE);

-- OptionChainSnapshot: 1-day chunks, columnstore after 3 days, keep 2 years (backtests)
SELECT create_hypertable('"OptionChainSnapshot"', by_range('ts', INTERVAL '1 day'), create_default_indexes => FALSE, if_not_exists => TRUE);
ALTER TABLE "OptionChainSnapshot" SET (timescaledb.enable_columnstore, timescaledb.segmentby = 'underlying, expiry', timescaledb.orderby = 'ts DESC');
SELECT add_compression_policy('"OptionChainSnapshot"', INTERVAL '3 days', if_not_exists => TRUE);
SELECT add_retention_policy('"OptionChainSnapshot"', INTERVAL '730 days', if_not_exists => TRUE);

-- 5-minute candles from M1. WITH NO DATA keeps this valid inside an implicit transaction.
CREATE MATERIALIZED VIEW IF NOT EXISTS candle_m5 WITH (timescaledb.continuous) AS
SELECT "instrumentKey", time_bucket('5 minutes', ts) AS bucket,
       first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close,
       sum(volume) AS volume, last(oi, ts) AS oi
FROM "Candle" WHERE timeframe = 'M1'
GROUP BY "instrumentKey", bucket
WITH NO DATA;
SELECT add_continuous_aggregate_policy('candle_m5', start_offset => INTERVAL '1 day', end_offset => INTERVAL '5 minutes',
                                       schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
```

**`<ts>_db_guards/migration.sql`**
```sql
ALTER TABLE "GlobalControl" DROP CONSTRAINT IF EXISTS "GlobalControl_singleton";
ALTER TABLE "GlobalControl" ADD CONSTRAINT "GlobalControl_singleton" CHECK ("id" = 1);

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% rejected)', TG_OP;
END $$;
CREATE OR REPLACE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE OR REPLACE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
```

**Builder sequence for PR2**
1. Confirm the dev DB is empty: `docker compose exec -T postgres psql -U finlytics -tAc "select count(*) from information_schema.tables where table_schema='public'"` must print `0`. If it doesn't, **stop and ask**. Never run `docker compose down -v` without approval.
2. Remove the kit migration: `git rm -r packages/database/prisma/migrations/0001_timescale`. Its content lives on in git history and in the SQL above.
3. Make the schema edits from the diff above.
4. Create the init migration:
   - `pnpm db:migrate --create-only --name init`
   - add the `pg_trgm` line at the top of the generated file
   - `pnpm db:migrate`
5. Create the TimescaleDB migration:
   - `pnpm db:migrate --create-only --name timescale` should create an empty migration (verify); if it doesn't, create a later-timestamped folder by hand
   - write the SQL above
   - `pnpm db:migrate`
6. Repeat step 5 with the name `db_guards`.
7. Check status and drift:
   - `pnpm db:status` must report up to date
   - create a scratch shadow database: `docker compose exec -T postgres createdb -U finlytics finlytics_shadow`
   - run the drift check with the shadow URL inline (not in `.env`; 5433 is this machine's `POSTGRES_HOST_PORT`):
     `SHADOW_DATABASE_URL=postgresql://finlytics:finlytics@localhost:5433/finlytics_shadow pnpm --filter @finlytics/database exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` must exit 0
8. If a migration fails partway: fix the SQL, run `prisma migrate resolve --rolled-back <name>`, then re-apply. This is safe because the statements are idempotent. `migrate reset` and `db push` are blocked by the project hook.

## 5. Zod schemas & helpers (`packages/shared`)

```ts
// constants/exchanges.ts
SEGMENT_TOKENS = ["NSE_EQ","NSE_INDEX","NSE_FO","NSE_CD","BSE_EQ","BSE_INDEX","BSE_FO","MCX_FO"] as const
SEGMENT_TOKEN_INFO: Record<SegmentToken, { exchange: Exchange; kinds: readonly Segment[] }>
//  NSE_EQ→(NSE,[EQ]) NSE_INDEX→(NSE,[INDEX]) NSE_FO→(NFO,[FUT,OPT]) NSE_CD→(CDS,[FUT,OPT])
//  BSE_EQ→(BSE,[EQ]) BSE_INDEX→(BSE,[INDEX]) BSE_FO→(BFO,[FUT,OPT]) MCX_FO→(MCX,[FUT,OPT])
segmentTokenFor(exchange, segment): SegmentToken | undefined
holidayCalendarFor(exchange): "NSE" | "BSE" | "MCX" | "CDS"        // NFO→NSE, BFO→BSE
// schemas/enums.ts — Prisma mirrors: Exchange Segment OptionType BrokerCode Role OrderType ProductType Validity (+ types)
```

Instrument-key grammar (stored as primary keys, so treat it as permanent):
```
key    = token "|" symbol                               ; *_EQ, *_INDEX tokens
       | token "|" symbol "|" expiry                    ; FUT (NSE_FO, NSE_CD, BSE_FO, MCX_FO)
       | token "|" symbol "|" expiry "|" strike "|" opt ; OPT
symbol = 1–64 of [A-Z0-9 &\-._()/], starts [A-Z0-9], no trailing/double spaces, never "|"
expiry = YYYY-MM-DD, real calendar date, 2000–2099
strike = /^(0|[1-9]\d{0,13})(\.\d{0,3}[1-9])?$/ and > 0   ; "24000", "82.5", never "24000.00"
opt    = CE | PE ; whole key ≤ 128 chars, checked before any pattern
```

```ts
type InstrumentKey = string & z.$brand<"InstrumentKey">;  type IsoDate = string & z.$brand<"IsoDate">   // brand API (verify)
type InstrumentKeyError = { reason: "LENGTH"|"ARITY"|"TOKEN"|"SYMBOL"|"EXPIRY"|"STRIKE"|"OPTION_TYPE"; message: string }
parseInstrumentKey(s): Result<ParsedInstrumentKey, InstrumentKeyError>   // strict, canonical only, split-based
normalizeInstrumentKey(s): Result<InstrumentKey, InstrumentKeyError>    // trim, uppercase, canonical strike
formatInstrumentKey(parts): InstrumentKey;  isInstrumentKey(x): x is InstrumentKey;  InstrumentKeySchema (strict, branded)
canonicalStrike(x: DecimalLike): string;  expiryToDate(IsoDate): Date /* UTC */;  dateToExpiry(Date): IsoDate
instrumentKeyToParam(k) = encodeURIComponent(k);  instrumentKeyFromParam(s) = parseInstrumentKey(decodeURIComponent(s))
// money.ts
DecimalStringSchema /^-?(0|[1-9]\d{0,13})(\.\d{1,4})?$/ (wire input, fits Decimal(18,4))
PriceSchema (≥ 0)  MoneySchema (signed)  QuantitySchema = z.int().min(1).max(2_147_483_647)
type DecimalLike = string | Decimal | { toFixed(): string }   // Prisma Decimal fits structurally; number excluded
toDecimal(x); toDecimalString(x, rounding = "half-up")         // ≤ 4 dp, no exponent, never "-0"; RangeError > 14 int digits
roundToTick(price, tick, mode: "nearest"|"down"|"up"): string  // mode required; down = floor, up = ceil
isOnTick(price, tick); formatInr(x, { decimals?: 0|2|4, sign?: "auto"|"always", symbol?: boolean })  // "-₹1,23,45,678.90"
formatInrCompact(x, { maxDecimals = 2 })                        // "₹1.23 Cr" ≥1e7, "₹45.6 L" ≥1e5, "₹12.3 K" ≥1e3, "₹999"
// schemas/errors.ts
ErrorCodeSchema; ERROR_HTTP_STATUS; ERROR_TITLES; problemTypeUrl(code) → "https://finlytics.app/errors/<kebab-code>"
ProblemDetailsSchema = { type, title, status (400–599), code, detail?, instance?, requestId,
  errors?: { path; message; code? }[] (≤100), broker?: { code; message? }, retryAfterSec? }
isProblemDetails(x); isRetryableErrorCode(code)   // RATE_LIMITED, BROKER_UNAVAILABLE
```

| HTTP status | Error codes |
|---|---|
| 400 | VALIDATION |
| 401 | UNAUTHENTICATED |
| 403 | FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | CONFLICT, IDEMPOTENT_REPLAY, NEEDS_RELOGIN (never 401, which would trigger an app re-login) |
| 422 | BROKER_REJECTED, RISK_LIMIT, INSUFFICIENT_FUNDS, MARKET_CLOSED |
| 423 | KILL_SWITCH |
| 429 | RATE_LIMITED |
| 500 | INTERNAL |
| 503 | BROKER_UNAVAILABLE |

```ts
// schemas/user-settings.ts — UserSettingsSchema (strict, full, response shape); defaults in ()
appearance:    { theme: system|light|dark (system), density: comfortable|compact (comfortable) }
trading:       { defaultOrderMode: PAPER|LIVE (PAPER), defaultProduct: INTRADAY|DELIVERY|MARGIN (INTRADAY),
                 defaultOrderType: MARKET|LIMIT (LIMIT), defaultValidity: DAY|IOC (DAY), defaultQtyLots: 1–100 (1),
                 confirmBeforePlace: boolean (true) }
notifications: { sound (true), categories: Record<order|alert|agent|broker|system, { inApp, push, email, telegram }> }
  // defaults: inApp all true (literal true for broker/system); push order/alert/broker; email broker/system; telegram off
DEFAULT_USER_SETTINGS (deep-frozen; catch values via factory)   UserSettingsPatchSchema (strict deep-partial)
parseUserSettings(raw: unknown): UserSettings      // never throws; per-field .catch(); unknown stored keys stripped
parseUserSettingsWithIssues(raw) → { settings, issues: string[] };  mergeUserSettings(current, patch) → re-validated
```

Settings never hold risk limits, auto-trade, the kill switch or the default broker. Those live in `RiskLimit`, `AutoTradeConfig`, `TradingControl` and `BrokerAccount.isDefault`, behind step-up auth.

## 6. Contracts

- **REST, WebSocket, BullMQ:** this phase adds no endpoints, no WebSocket events and no jobs or queues. shared defines payload schemas for endpoints that are already documented:
  - `ProblemDetails`: the error contract for every endpoint (docs/04 §6)
  - `UserSettings` and its patch: `GET /v1/me/settings` and its update (verb change in D16)
- **UI:** no pages and no loading/empty/error states. This phase ships packages only. The first UI comes in 0.4 (`packages/ui`) and 0.6 (`apps/web`).
- **Broker budget:**
  - Zero broker REST calls and zero broker WebSockets.
  - The 12-operation budget and the limit of one market WS plus one order WS per broker are unchanged.
  - Holiday data comes from exchange circulars checked into git, not from broker APIs.

## 7. Tests (behaviour names)

**shared — unit, coverage ≥ 90%**
- **instrument-key:**
  - "parses equity, index, future and option keys with Prisma exchange and segment"
  - "rejects a key whose arity does not match its segment token"
  - "rejects non-canonical strikes in strict mode and normalises them in lenient mode"
  - "rejects 2026-02-30 as an expiry"
  - "rejects lowercase symbols in strict mode"
  - "rejects keys over 128 chars before pattern matching"
  - "maps NFO and BFO to the NSE and BSE holiday calendars and keeps CDS separate"
  - "round-trips keys through URL params"
  - property tests: "format(parse(k)) equals k", "parse(format(parts)) equals parts", "normalize is idempotent"
- **money:**
  - "rejects leading zeros, exponents, more than 4 decimals and more than 14 integer digits"
  - "never emits negative zero"
  - "accepts Prisma Decimal-like values without float conversion"
  - "formats INR with lakh and crore grouping" (fixtures: 0, 999.5, 100000, -12345678.9)
  - "formats compact INR at the K, L and Cr thresholds"
  - property tests: "round-trips canonical decimal strings", "roundToTick returns a tick multiple", "down ≤ price ≤ up", "nearest is within half a tick"
- **errors:**
  - "maps every error code to an HTTP status and type URL"
  - "builds kebab-case problem type URLs"
  - "rejects problem details without requestId"
  - "accepts field-level validation errors"
  - "treats only RATE_LIMITED and BROKER_UNAVAILABLE as retryable"
- **settings:**
  - "returns full defaults for an empty object"
  - "falls back per field when a stored value is invalid"
  - "drops unknown stored keys on read"
  - "rejects unknown keys in a patch"
  - "merges a section patch without touching other sections"
  - "keeps in-app delivery on for broker and system notifications"
  - "returns independent copies of the defaults"

**database — unit, no DB**
- "createPrismaClient rejects an empty URL"
- "getPrisma reuses one instance outside production"
- "orders migration folders as init, then timescale, then db_guards, with 14-digit timestamps" (five folders after the review follow-ups)
- "uses the same pinned Timescale image in compose and Testcontainers"
- holiday data:
  - "rejects a weekend holiday"
  - "rejects duplicate dates within an exchange"
  - "rejects a holiday outside the file's year"
  - "rejects session closures outside MCX"
  - "requires an official https source for every calendar"
- "keeps maxRtSubscriptions at or below 300 for every plan"
- "mirrors every Prisma enum value in @finlytics/shared" (added in PR5)

**database — integration, Testcontainers on the pinned image**
- migrations:
  - "applies all migrations to an empty database"
  - "has no drift between the migrated database and schema.prisma"
  - "creates the three hypertables without default time indexes"
  - "registers compression, retention and continuous-aggregate refresh jobs"
  - "creates candle_m5 with no materialised data"
- guards:
  - "rejects UPDATE, DELETE and TRUNCATE on AuditLog"
  - "deletes a user who has audit rows and keeps their userId"
  - "rejects a second GlobalControl row"
- constraints:
  - "scopes idempotency keys per user"
  - "allows NSE and BSE holidays on the same date"
  - "finds instruments by trigram similarity on name"
- packaging: "queries the database through both the ESM and the CJS build" (CJS through a `cjs-smoke.cjs` child process)
- seed:
  - "seeds plans, global control and holidays into an empty database"
  - "is idempotent across runs"
  - "does not reset an engaged global kill switch"
  - "does not overwrite edited plan prices"
  - "stores holiday dates without timezone shift"

**CI checks**
- `format:check`
- lint with `--max-warnings 0`
- typecheck
- unit tests with coverage gates
- `check:pkg` (publint, attw, smoke tests)
- integration tests, including drift
- `pnpm audit --audit-level high`

## 8. Risks, failure modes, performance & security

| Risk / failure mode | Mitigation |
|---|---|
| Prisma 8 installed by accident (`pnpm add prisma` resolves to 8.0.0-rc.19) | Exact `7.10.0` pins in the pnpm catalog, and a dependabot group for the trio |
| Prisma 7 detail differs from what's assumed here (config env, generator options, `migrate diff` flags, `db seed`) | Steps are marked (verify); the acceptance tests encode the intent, not the syntax |
| A migration fails partway (it isn't atomic in Prisma ≥ 7.4) | Every custom statement is idempotent. Fix the SQL, run `prisma migrate resolve --rolled-back <name>`, then re-apply. Never reset; `docker compose down -v` only with user approval. |
| The generated client fails the strict compiler flags | Generated files carry `// @ts-nocheck`. If that's not enough, give them their own tsconfig. Never loosen the base flags. |
| The generated client breaks the CJS bundle, or its type declarations are slow to build | CJS smoke query in the integration tests; fall back to ESM-only (D2) or tsc-emitted declarations |
| Two copies of zod or decimal.js in one process (ESM + CJS) | Never use `instanceof` across packages; use the structural `DecimalLike` and `isProblemDetails` |
| Tests migrate the dev DB instead of the test container | D7: set all three URL variables and assert the target |
| TimescaleDB API deprecations, or a production managed Postgres without TSL features | Pinned image tag; drift and catalog tests; carry-forward note 13 |
| Holiday data is wrong, or exchange sites block automated fetches | Official circulars only, checked with Zod and weekday checks. If a site won't load, stop and ask the user for the PDFs; never use blogs. |
| `pnpm audit` fails on a dev-only vulnerability that has no fix yet | A documented ignore, keyed by GHSA id, with an expiry date |
| Lenient settings reads hide corrupted data | `parseUserSettingsWithIssues`; the api logs the issues in 0.5 |
| The PostToolUse hook's `npx prettier/eslint` runs before dependencies are installed | Run `pnpm i` as soon as the config packages exist |

**Performance.** Nothing here is on the realtime path.
- Key parsing splits on `|` and is capped at 128 characters, so there's no regex backtracking on unbounded input.
- Hypertables carry only their primary-key indexes, plus `Candle (timeframe, ts)`.
- There are no runtime queries, so no N+1 risk.

**Security.**
- No secrets in the seed or test fixtures.
- Compose ports are bound to localhost.
- CI runs with `contents: read` and SHA-pinned actions.
- AuditLog is append-only at the database level.
- The kill switch is a singleton row that a re-seed never resets.
- Idempotency keys are scoped per user.
- Write schemas are strict.
- ProblemDetails has no stack trace or internal fields.
- Prisma never logs `query`.
- `.env*` files are never read or edited by agents.

**Broker failure modes** (broker down, token expiry, partial fill) don't apply: this phase does no broker I/O. The contracts already cover them: `BROKER_UNAVAILABLE`, `NEEDS_RELOGIN`, `PARTIALLY_FILLED`.

## 9. PR task list

Run `/review` on every PR. Also run `/security-audit` on PR2–PR4, which touch the audit log, the kill switch and the seed. Once PR2 is merged, PR5 and PR6 can run in parallel with PR3 and PR4.

**PR0 — Preconditions (done by bootstrap)**
- [x] `git init`, the kit commit and the feature branch
- [x] `.env` with secrets and the Redis host port
- [x] `.env` Postgres host port 5433 (edited by the user; the permission system blocks Claude from editing `.env`)
- [x] Stack verified: postgres on 127.0.0.1:5433, redis on 127.0.0.1:6380, mailpit, all healthy. TimescaleDB 2.30.2 on PostgreSQL 16.15. `public` schema empty.
- [x] compose: ports, `127.0.0.1`, pinned images, Redis healthcheck
- [x] `.env.example`: documented the new variables

**PR1 — chore(repo): monorepo scaffold (0.1)** — ✅ done
- [x] `packages/config`: tsconfig, eslint-config, prettier. Run `pnpm i` straight after.
- [x] Root files: `eslint.config.mjs` (with the ui/broker-sdk ignores), `.prettierignore`, `.editorconfig`, `.nvmrc`.
- [x] Workspace glob and catalog; root `package.json` (scripts, lint-staged fix, engines, version bumps).
- [x] `turbo.json` updates.
- [x] husky and commitlint.
- [x] `.gitignore`.
- [x] `ci.yml` with these jobs:
  - `static`: format, lint, typecheck, check:pkg
  - `unit`
  - `integration` (no-op until PR3)
  - `security`
  - commented placeholders for e2e, Trivy and image build
- [x] dependabot.
- [x] docs/02, docs/09 and the `CLAUDE.md` §5 commands.

Done when:
- `pnpm i && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` exits 0
- `echo "wip" | pnpm exec commitlint` fails and `echo "chore: x" | pnpm exec commitlint` passes

**PR2 — feat(database): wiring, pre-migration schema fixes, migrations (0.2a)** — ✅ done
- [x] `package.json`, tsconfig, tsdown, vitest; `prisma.config.ts` (D7).
- [x] `src/env.ts`, `client.ts`, `index.ts` (D9).
- [x] Schema edits (§4).
- [x] Migrations, following the builder sequence in §4.
- [x] Unit tests for the client and the migration layout.
- [x] docs/03.

Done when:
- `pnpm db:generate && pnpm db:migrate` applies 3 migrations (5 after the review follow-ups)
- `pnpm db:status` reports up to date
- the drift diff exits 0
- `pnpm check:pkg && pnpm lint && pnpm typecheck && pnpm test` passes

**PR3 — test(database): Testcontainers harness and DB integration tests (0.2b)** — ✅ done
- [x] `vitest.integration.config.ts` and the global setup:
  - pinned image constant
  - app and shadow databases
  - all three URL variables set and the target asserted
  - URLs passed through Vitest provide/inject (verify)
- [x] Integration tests for migrations, guards, constraints and packaging (§7).
- [x] The real CI integration job.

Done when:
- `pnpm test:integration` is green locally and in CI
- temporarily removing `create_default_indexes => FALSE` makes the drift test fail (then revert)

**PR4 — feat(database): seed (0.2c)** — ✅ done
- [x] Holiday JSON for 2025 and 2026 covering NSE, BSE, MCX (with `closure`) and CDS. Each calendar records the issuer, circular number, URL, published date and retrieved date. If any list can't be verified from an official exchange or clearing-corporation source, **stop and ask**.
- [x] Plans seed. Prices and limits are **placeholders**, all with `maxRtSubscriptions ≤ 300`:

  | Plan | Price | Broker accounts | Watchlists × items | Live strategies | Alerts | Live subscriptions | Backtest min/day | Agents | Auto-trade |
  |---|---|---|---|---|---|---|---|---|---|
  | free | ₹0 | 1 | 3 × 50 | 1 | 10 | 100 | 30 | off | off |
  | pro | ₹999 | 2 | 10 × 100 | 5 | 100 | 200 | 240 | on | off |
  | elite | ₹2,499 | 5 | 25 × 200 | 20 | 500 | 300 | 1000 | on | on |

- [x] GlobalControl `{ id: 1, killSwitch: false }`, create-only.
- [x] Seed unit and integration tests.

Done when:
- running `pnpm db:seed` twice leaves the same counts, checked with `docker compose exec -T postgres psql -U finlytics -c 'select exchange, count(*) from "MarketHoliday" group by 1'`
- `pnpm test && pnpm test:integration` passes

**PR5 — feat(shared): package, enums, errors, money (0.3a)** — ✅ done (the enum-sync test landed after PR4/PR6 so the parallel streams stayed independent)
- [x] Package scaffold: exports, tsdown, coverage gate, `library` lint preset.
- [x] `enums.ts`, plus the enum-sync test in database.
- [x] `errors.ts`, plus the docs/04 §6 update.
- [x] `money.ts` with unit and property tests.

Done when:
- `pnpm --filter @finlytics/shared test -- --coverage` reports ≥ 90%
- `pnpm check:pkg` passes
- `pnpm --filter @finlytics/database test` passes
- `pnpm lint && pnpm typecheck` passes

**PR6 — feat(shared): instrument keys and user settings (0.3b)** — ✅ done
- [x] `exchanges.ts` and `instrument-key.ts`, with property tests.
- [x] `user-settings.ts` and its tests.
- [x] docs/04 settings verb.

Done when `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm check:pkg` is all green.

## 10. Carry-forward notes

1. **Before 1.2 (security):** `BrokerAccount` has one `encIv` for two ciphertexts (`encryptedCredentials` and `brokerClientIdEnc`). Reusing an IV under the same key breaks AES-GCM. Store a separate IV and tag with each ciphertext, and do the same for `NotificationChannel.configEnc`. Also reconcile the AAD: docs/06 says `userId:accountId`, `security.md` says `userId`.
2. **Before 0.5:**
   - Add `AuditLog.actorId`.
   - Use the Redis idempotency key `idem:<userId>:<key>`.
   - Serialise BigInt columns (AuditLog.id, volume, oi) as strings.
   - Log the issues returned by the settings parser.
   - docs/01 mentions "Prisma middleware"; Prisma 7 has no `$use`, so use `$extends` query extensions.
3. **Before 0.6:** ✅ done in 0.6 (lowercase emails with CHECKs, no OAuth tokens at rest, roles USER/ADMIN, `proxy.ts` never imports the database).
   - Make email case-insensitive (citext or normalisation) before the first user exists.
   - Don't store OAuth provider tokens in `Account`, or encrypt them.
   - Role `PRO` duplicates the Plan tier; reduce Role to USER/ADMIN.
   - Edge middleware must not import `@finlytics/database`.
4. **2.1:**
   - RiskService treats a missing `GlobalControl` or `TradingControl` row as kill switch ON.
   - The app's production DB role gets no UPDATE, DELETE or TRUNCATE on AuditLog.
   - Split the roles (security finding F2): a migrator role owns every table, function and sequence; the app role
     owns nothing, is not a superuser and has no SET on `session_replication_role`. Replica mode disables foreign
     keys (including the tenancy keys) and every trigger not marked ENABLE ALWAYS.
   - Add a `STEP_UP_REQUIRED` error code alongside 2FA step-up.
5. **1.x market status:**
   - Model special sessions: Muhurat trading (which can fall on a weekend) and Budget-day weekend sessions.
   - Store session times per exchange.
   - Write a yearly holiday-refresh runbook, with an alert if next year's list is still missing in mid-December.
6. **1.2 instrument master:**
   - Handle symbol renames (e.g. ZOMATO → ETERNAL) with an alias table; never rewrite keys stored in hypertables.
   - Index key symbol = the F&O underlying symbol where one exists (`NSE_INDEX|NIFTY`).
   - Add a reverse lookup from broker token to key.
   - Never delete Instrument rows; set `isActive=false` instead.
7. **Before 1.4 (ticks):**
   - At the docs/03 sizing, a 1-day Tick chunk is about 27 GB uncompressed. Use a chunk interval of 1 h or less and compress sooner; this only affects new chunks.
   - Decide whether raw ticks are persisted at all.
   - Decide numeric vs scaled-integer prices.
8. **1.6 candles:**
   - Define how broker M5+ rows relate to `candle_m5`.
   - Decide on `materialized_only`.
   - Align M15/H1/D1 buckets to IST and the 09:15 open (`time_bucket` origin/timezone).
   - The `Timeframe` enum can only gain values.
9. **Before 3.1:** fix the format of `OptionChainSnapshot.underlying` (e.g. `NSE_FO|NIFTY`). It is the compression segment key and has 2-year retention.
10. **4.x/5.x:**
    - `cuid()` and `@updatedAt` are generated by the Prisma client, so ai-engine's SQLAlchemy writes must generate them in Python.
    - ai-engine.md mentions `BacktestResult`; reconcile it with `Backtest`.
    - `Strategy`'s `@@unique([userId, name])` combined with soft delete blocks reusing a deleted strategy's name.
    - Refresh the LLM model IDs in `.env.example`; the current values are outdated.
11. **2.2:** decimal.js on every tick is too slow for live P&L. Use scaled integers on the hot path and Decimal at the boundaries.
12. **1.1:** broker-sdk replaces its local `BrokerCode` and `InstrumentKey` with the ones from `@finlytics/shared`.
13. **6.4:**
    - The production DB must support Timescale's TSL features.
    - Ship a compiled seed (no tsx in images).
    - Check PgBouncer and prepared statements.
    - Consider `cuid(2)`.
    - Monthly AuditLog partitioning needs PK `(id, createdAt)`.
    - Add DPDP pseudonymisation for ip/userAgent.
    - Decide the retention of orders and trades on account deletion.
14. ~~**pnpm 10 upgrade:** add `onlyBuiltDependencies` (prisma, esbuild).~~ Done in the Phase 0 review (pnpm 10.34.6).

## Sources

- **Prisma v7:**
  - [config reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
  - [upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
  - [seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding)
  - [indexes](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes)
  - [7.10.0 release](https://github.com/prisma/orm/releases/tag/7.10.0)
  - [dropped-index issue #12914](https://github.com/prisma/orm/issues/12914)
- **TimescaleDB 2.30.2:** [`ddl_api.sql`](https://github.com/timescale/timescaledb/blob/2.30.2/sql/ddl_api.sql); image tag `timescale/timescaledb-ha:pg16.15-ts2.30.2` (Docker Hub).
- **Zod 4:** [changelog](https://zod.dev/v4/changelog), [API](https://zod.dev/api).
- **Holidays.** These are domain checks only; the builder must use the official circulars.
  - [NSE Clearing currency derivatives 2026 (PDF)](https://www.nseclearing.in/sites/default/files/2025-12/CURRENCY%20DERIVATIVES%202026.pdf)
  - [Zerodha: Annual Bank Closing, 1 Apr 2026](https://zerodha.com/marketintel/bulletin/445208/settlement-holiday-on-account-of-annual-bank-closing-on-april-01-2026)
  - [MCX split-session holidays](https://ismarketopen.in/mcx-holidays/)
