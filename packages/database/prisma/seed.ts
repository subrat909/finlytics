/**
 * Seed entry point: `pnpm db:seed` → `prisma db seed` → `tsx prisma/seed.ts` (migrations.seed in prisma.config.ts).
 * Runs from source, so the client comes from src/, not dist/.
 *
 * Seeds the database the migrations target: DATABASE_DIRECT_URL, else DATABASE_URL (resolveCliDatabaseUrl, shared with
 * prisma.config.ts). Under `prisma db seed` they come from the environment or, when unset there, from the root .env
 * that prisma.config.ts loads without override. This file loads no .env of its own. It prints its target as
 * host:port/database, then one summary line per table, never a full URL or secret, and exits non-zero on failure,
 * which makes `prisma db seed` (and so `pnpm db:seed`) fail too.
 *
 * Outside production (NODE_ENV unset or not `production`) it also upserts the development instruments
 * (./seed/instruments.ts), so search, watchlists and charts work without a broker.
 */
import { describeDatabaseUrl, resolveCliDatabaseUrl } from "../src/env";
import { createPrismaClient } from "../src/index";
import { seedDevInstruments } from "./seed/instruments";
import { formatSeedSummary, runSeed } from "./seed/run";

async function main(): Promise<void> {
  const url = resolveCliDatabaseUrl();
  if (url === "") throw new Error("Set DATABASE_DIRECT_URL or DATABASE_URL to the database to seed");
  console.log(`Seeding ${describeDatabaseUrl(url)}`);
  // The seed runs one statement at a time: two connections are plenty, whatever DB_POOL_MAX says for the app. Errors
  // are printed once, by the catch below, so Prisma logs warnings only.
  const prisma = createPrismaClient({ url, poolMax: 2, applicationName: "finlytics-seed", log: ["warn"] });
  try {
    const summary = await runSeed(prisma);
    for (const line of formatSeedSummary(summary)) console.log(line);
    // Development instruments (plan P6) only outside production: there the instrument-master-sync job fills the table.
    if (process.env["NODE_ENV"] !== "production") {
      const instruments = await seedDevInstruments(prisma);
      console.log(
        `Instrument (development): ${String(instruments.upserted)} rows upserted, ` +
          `${String(instruments.deactivated)} expired derivatives deactivated`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error: unknown) {
  // The message only: Prisma, pg and env errors name hosts and users at most, never a password or a full URL.
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
