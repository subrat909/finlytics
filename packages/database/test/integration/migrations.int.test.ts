import { readdirSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/index";
import { migrateDeploy, PACKAGE_ROOT, runPrismaCli } from "./database-admin";
import { connect, createEmptyDatabase, createMigratedDatabase, outputOf, prismaCliTarget, withClient } from "./harness";

const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "prisma", "migrations");

/** The drift check from plan D6: replays the migrations into the shadow database and compares with the schema. */
const DIFF_MIGRATIONS_TO_SCHEMA = [
  "migrate",
  "diff",
  "--from-migrations",
  "prisma/migrations",
  "--to-schema",
  "prisma/schema.prisma",
  "--exit-code",
];

/** Compares the configured database itself (DATABASE_DIRECT_URL) with the schema. */
const DIFF_DATABASE_TO_SCHEMA = [
  "migrate",
  "diff",
  "--from-config-datasource",
  "--to-schema",
  "prisma/schema.prisma",
  "--exit-code",
];

/** `--exit-code`: 0 = no difference, 1 = error, 2 = difference found. */
const DIFF_FOUND = 2;

/** Migration folder names in the order Prisma applies them. */
function migrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function tablesInPublic(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT table_name::text AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`;
  return rows.map((row) => row.name);
}

async function hypertableNames(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT hypertable_name::text AS name FROM timescaledb_information.hypertables
    WHERE hypertable_schema = 'public' ORDER BY 1`;
  return rows.map((row) => row.name);
}

describe("migrations", () => {
  // A database of its own, migrated in beforeAll, for the catalog checks: nothing else ever writes to it.
  let migratedUrl: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    migratedUrl = (await createMigratedDatabase("migrations")).url;
    prisma = connect(migratedUrl);
    return async () => {
      await prisma.$disconnect();
    };
  });

  it("applies all migrations to an empty database", async () => {
    const database = await createEmptyDatabase("deploy");

    await withClient(database.url, async (client) => {
      // A copy of template1: the TimescaleDB extensions, but no tables yet.
      expect(await tablesInPublic(client)).toEqual([]);

      const output = await migrateDeploy(prismaCliTarget(database.url));

      expect(output).toContain("All migrations have been successfully applied.");
      const applied = await client.$queryRaw<{ name: string; finished: boolean; rolledBack: boolean }[]>`
        SELECT migration_name AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack"
        FROM _prisma_migrations ORDER BY started_at, migration_name`;
      expect(applied).toEqual(migrationFolders().map((name) => ({ name, finished: true, rolledBack: false })));
      expect(applied.slice(0, 5).map(({ name }) => name.slice("YYYYMMDDHHMMSS_".length))).toEqual([
        "init",
        "timescale",
        "db_guards",
        "tenant_fks",
        "kill_switch_and_audit_guards",
      ]);
    });
  });

  it("has no drift between the migrated database and schema.prisma", async () => {
    const shadow = await createEmptyDatabase("shadow");
    const target = { databaseUrl: migratedUrl, shadowDatabaseUrl: shadow.url };

    const migrationsToSchema = await runPrismaCli(DIFF_MIGRATIONS_TO_SCHEMA, target);
    const databaseToSchema = await runPrismaCli(DIFF_DATABASE_TO_SCHEMA, target);

    expect(migrationsToSchema.exitCode, outputOf(migrationsToSchema)).toBe(0);
    expect(outputOf(migrationsToSchema)).toContain("No difference detected.");
    expect(databaseToSchema.exitCode, outputOf(databaseToSchema)).toBe(0);
    expect(outputOf(databaseToSchema)).toContain("No difference detected.");
    // The first diff replayed the migrations into this shadow database, which was empty: it ran in the container, not
    // against a SHADOW_DATABASE_URL from the root .env.
    expect(await withClient(shadow.url, hypertableNames)).toEqual(["Candle", "OptionChainSnapshot", "Tick"]);
  });

  // Control for the test above: the same diff does see a database that is behind the schema.
  it("reports drift against a database without the migrations", async () => {
    const empty = await createEmptyDatabase("unmigrated");

    const databaseToSchema = await runPrismaCli(DIFF_DATABASE_TO_SCHEMA, prismaCliTarget(empty.url));

    expect(databaseToSchema.exitCode, outputOf(databaseToSchema)).toBe(DIFF_FOUND);
    expect(outputOf(databaseToSchema)).toContain("[+] Added tables");
  });

  it("creates the three hypertables without default time indexes", async () => {
    const hypertables = await prisma.$queryRaw<
      { table: string; timeColumn: string; chunkInterval: string; columnstore: boolean }[]
    >`
      SELECT h.hypertable_name::text AS "table", d.column_name::text AS "timeColumn",
             d.time_interval::text AS "chunkInterval", h.compression_enabled AS columnstore
      FROM timescaledb_information.hypertables h
      JOIN timescaledb_information.dimensions d USING (hypertable_schema, hypertable_name)
      WHERE h.hypertable_schema = 'public'
      ORDER BY 1`;
    const indexes = await prisma.$queryRaw<{ table: string; index: string }[]>`
      SELECT tablename::text AS "table", indexname::text AS "index" FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('Tick', 'Candle', 'OptionChainSnapshot')
      ORDER BY 1, 2`;

    expect(hypertables).toEqual([
      { table: "Candle", timeColumn: "ts", chunkInterval: "7 days", columnstore: true },
      { table: "OptionChainSnapshot", timeColumn: "ts", chunkInterval: "1 day", columnstore: true },
      { table: "Tick", timeColumn: "ts", chunkInterval: "1 day", columnstore: true },
    ]);
    // Exactly the indexes schema.prisma declares. create_default_indexes => FALSE skipped TimescaleDB's own `ts DESC`
    // indexes, which Prisma would otherwise report as drift (plan D6).
    expect(indexes).toEqual([
      { table: "Candle", index: "Candle_pkey" },
      { table: "Candle", index: "Candle_timeframe_ts_idx" },
      { table: "OptionChainSnapshot", index: "OptionChainSnapshot_pkey" },
      { table: "OptionChainSnapshot", index: "OptionChainSnapshot_underlying_ts_idx" },
      { table: "Tick", index: "Tick_pkey" },
    ]);
  });

  it("registers compression, retention and continuous-aggregate refresh jobs", async () => {
    // config without the internal hypertable ids; TimescaleDB's own jobs (telemetry, job-history cleanup) are left out.
    const jobs = await prisma.$queryRaw<
      { policy: string; target: string; settings: unknown; every: string; scheduled: boolean }[]
    >`
      SELECT proc_name::text AS policy, hypertable_name::text AS target,
             config - 'hypertable_id' - 'mat_hypertable_id' AS settings,
             schedule_interval::text AS every, scheduled
      FROM timescaledb_information.jobs
      WHERE proc_name IN ('policy_compression', 'policy_retention', 'policy_refresh_continuous_aggregate')
      ORDER BY 1, 2`;

    expect(jobs).toEqual([
      {
        policy: "policy_compression",
        target: "Candle",
        settings: { compress_after: "30 days" },
        every: "12:00:00",
        scheduled: true,
      },
      {
        policy: "policy_compression",
        target: "OptionChainSnapshot",
        settings: { compress_after: "3 days" },
        every: "12:00:00",
        scheduled: true,
      },
      {
        policy: "policy_compression",
        target: "Tick",
        settings: { compress_after: "2 days" },
        every: "12:00:00",
        scheduled: true,
      },
      {
        policy: "policy_refresh_continuous_aggregate",
        target: "candle_m5",
        settings: { start_offset: "1 day", end_offset: "00:05:00" },
        every: "00:05:00",
        scheduled: true,
      },
      {
        policy: "policy_retention",
        target: "OptionChainSnapshot",
        settings: { drop_after: "730 days" },
        every: "1 day",
        scheduled: true,
      },
      {
        policy: "policy_retention",
        target: "Tick",
        settings: { drop_after: "30 days" },
        every: "1 day",
        scheduled: true,
      },
    ]);
  });

  it("creates candle_m5 with no materialised data", async () => {
    // chunks: chunks of the hypertable that stores the aggregate's materialised buckets.
    const aggregates = await prisma.$queryRaw<{ source: string; materializedIn: string; chunks: number }[]>`
      SELECT c.hypertable_name::text AS source, c.materialization_hypertable_schema::text AS "materializedIn",
             (SELECT count(*)::int FROM timescaledb_information.chunks k
              WHERE k.hypertable_schema = c.materialization_hypertable_schema
                AND k.hypertable_name = c.materialization_hypertable_name) AS chunks
      FROM timescaledb_information.continuous_aggregates c
      WHERE c.view_schema = 'public' AND c.view_name = 'candle_m5'`;
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM candle_m5`;

    expect(aggregates).toEqual([{ source: "Candle", materializedIn: "_timescaledb_internal", chunks: 0 }]);
    expect(rows).toEqual([{ count: 0 }]);
  });
});
