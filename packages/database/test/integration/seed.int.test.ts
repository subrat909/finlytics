import { describe, expect, it } from "vitest";

import { HOLIDAY_CALENDARS, loadHolidayFiles } from "../../prisma/seed/holidays";
import type { HolidayFile } from "../../prisma/seed/holidays";
import { PLANS } from "../../prisma/seed/plans";
import type { PlanSeed } from "../../prisma/seed/plans";
import { runSeed } from "../../prisma/seed/run";
import type { PrismaClient } from "../../src/index";
import { runPrismaCli } from "../../src/testing/index";
import {
  createEmptyDatabase,
  createMigratedDatabase,
  outputOf,
  prismaCliTarget,
  setDatabaseTimeZone,
  withClient,
} from "./harness";

/** A holiday as PostgreSQL itself prints it: the date is the column's text, untouched by any client time zone. */
interface StoredHoliday {
  exchange: string;
  date: string;
  name: string;
  closure: string;
}

/** Every MarketHoliday row, in (exchange, date) order. */
async function storedHolidays(prisma: PrismaClient): Promise<StoredHoliday[]> {
  return prisma.$queryRaw<StoredHoliday[]>`
    SELECT exchange::text AS exchange, date::text AS date, name, closure::text AS closure
    FROM "MarketHoliday"
    ORDER BY exchange::text, date`;
}

/** The rows the given files describe, in the same order as storedHolidays(). */
function holidaysIn(files: readonly HolidayFile[]): StoredHoliday[] {
  return files
    .flatMap((file) =>
      HOLIDAY_CALENDARS.flatMap((exchange) =>
        file.calendars[exchange].holidays.map((holiday) => ({
          exchange,
          date: holiday.date,
          name: holiday.name,
          closure: holiday.closure ?? "FULL_DAY",
        })),
      ),
    )
    .sort((a, b) => a.exchange.localeCompare(b.exchange) || a.date.localeCompare(b.date));
}

/** Every plan with its price as text (Decimal(10,2)), without the generated id. */
async function storedPlans(prisma: PrismaClient): Promise<PlanSeed[]> {
  const plans = await prisma.plan.findMany({ omit: { id: true }, orderBy: { code: "asc" } });
  return plans.map((plan) => ({ ...plan, priceInrMonthly: plan.priceInrMonthly.toFixed(2) }));
}

/** Everything the seed writes, ids and timestamps included, so a comparison shows any row it touched. */
async function snapshot(prisma: PrismaClient): Promise<unknown> {
  const plans = await prisma.plan.findMany({ orderBy: { code: "asc" } });
  return {
    plans: plans.map((plan) => ({ ...plan, priceInrMonthly: plan.priceInrMonthly.toFixed(2) })),
    globalControl: await prisma.globalControl.findMany(),
    holidays: await storedHolidays(prisma),
  };
}

/** Connection-string schemes: seed output must never contain a database URL. */
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\//;

describe("seed", () => {
  it("seeds plans, global control and holidays into an empty database", async () => {
    const database = await createMigratedDatabase("seed");
    const files = loadHolidayFiles();

    // The real path: prisma db seed → tsx prisma/seed.ts, with the database URLs from the harness only.
    const result = await runPrismaCli(["db", "seed"], prismaCliTarget(database.url));

    const output = outputOf(result);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("Plan: 3 rows, 3 created");
    expect(output).toContain("GlobalControl: created, kill switch off");
    expect(output).toContain(`MarketHoliday: ${String(holidaysIn(files).length)} rows upserted`);
    expect(output).not.toMatch(DATABASE_URL_PATTERN);
    await withClient(database.url, async (prisma) => {
      expect(await storedPlans(prisma)).toEqual([...PLANS].sort((a, b) => a.code.localeCompare(b.code)));
      expect(await prisma.globalControl.findMany({ select: { id: true, killSwitch: true, reason: true } })).toEqual([
        { id: 1, killSwitch: false, reason: null },
      ]);
      expect(await storedHolidays(prisma)).toEqual(holidaysIn(files));
    });
  });

  it("seeds the database the migrations target when DATABASE_DIRECT_URL and DATABASE_URL differ", async () => {
    // As in production behind a pooler: DATABASE_URL is the app's (pooled) URL, DATABASE_DIRECT_URL the one
    // `migrate deploy` uses. The seed must follow the migrations, never write to the other database.
    const direct = await createMigratedDatabase("seed_direct");
    const pooled = await createMigratedDatabase("seed_pooled");

    const result = await runPrismaCli(["db", "seed"], {
      ...prismaCliTarget(direct.url),
      pooledDatabaseUrl: pooled.url,
    });

    const output = outputOf(result);
    expect(result.exitCode, output).toBe(0);
    const target = new URL(direct.url);
    expect(output).toContain(`Seeding ${target.hostname}:${target.port}/${direct.name}`);
    expect(output).not.toMatch(DATABASE_URL_PATTERN);
    expect(await withClient(direct.url, (prisma) => prisma.plan.count())).toBe(PLANS.length);
    await withClient(pooled.url, async (prisma) => {
      expect(await prisma.plan.count()).toBe(0);
      expect(await prisma.globalControl.count()).toBe(0);
      expect(await prisma.marketHoliday.count()).toBe(0);
    });
  });

  it("is idempotent across runs", async () => {
    const database = await createMigratedDatabase("seed");

    await withClient(database.url, async (prisma) => {
      const first = await runSeed(prisma);
      const afterFirst = await snapshot(prisma);
      const second = await runSeed(prisma);

      expect(await snapshot(prisma)).toEqual(afterFirst);
      expect(first).toMatchObject({ plans: { created: 3, total: 3 }, globalControl: { created: true } });
      expect(second).toEqual({
        plans: { created: 0, total: 3 },
        globalControl: { created: false, killSwitch: false },
        holidays: first.holidays,
      });
      expect(second.holidays.deleted).toBe(0);
    });
  });

  it("does not reset an engaged global kill switch", async () => {
    const database = await createMigratedDatabase("seed");

    await withClient(database.url, async (prisma) => {
      await runSeed(prisma);
      const engaged = await prisma.globalControl.update({
        where: { id: 1 },
        data: { killSwitch: true, reason: "engaged by an operator during an incident" },
      });

      const summary = await runSeed(prisma);

      expect(await prisma.globalControl.findMany()).toEqual([engaged]);
      expect(summary.globalControl).toEqual({ created: false, killSwitch: true });
    });
  });

  it("brings existing plans up to the seed's values, and leaves plans it doesn't list alone", async () => {
    const database = await createMigratedDatabase("seed");

    await withClient(database.url, async (prisma) => {
      await runSeed(prisma);
      // An older seed's limits (the free plan allowed 1 broker account), and a plan only the database knows.
      await prisma.plan.update({ where: { code: "free" }, data: { maxBrokerAccounts: 1, maxAlerts: 150 } });
      const custom = await prisma.plan.create({
        data: { code: "partner", name: "Partner", priceInrMonthly: "1.00", maxBrokerAccounts: 9 },
        omit: { id: true },
      });

      const summary = await runSeed(prisma);

      const stored = await storedPlans(prisma);
      expect(stored.filter((plan) => plan.code !== "partner")).toEqual(
        [...PLANS].sort((a, b) => a.code.localeCompare(b.code)),
      );
      expect(stored.find((plan) => plan.code === "free")).toMatchObject({ maxBrokerAccounts: 2, maxAlerts: 10 });
      expect(stored.find((plan) => plan.code === "partner")).toEqual({ ...custom, priceInrMonthly: "1.00" });
      expect(summary.plans).toEqual({ created: 0, total: 4 });
    });
  });

  it("stores holiday dates without timezone shift", async () => {
    const database = await createMigratedDatabase("seed");
    // Time zones on both sides of UTC: the seed process runs ahead of it (IST), the database session behind it
    // (Los Angeles, the database's default for new sessions). A date built from local time, or sent as a timestamp,
    // would land on a neighbouring day.
    await setDatabaseTimeZone(database, "America/Los_Angeles");
    const sessionTimeZone = await withClient(database.url, async (prisma) => {
      const rows = await prisma.$queryRaw<{ timeZone: string }[]>`SELECT current_setting('TimeZone') AS "timeZone"`;
      return rows[0]?.timeZone;
    });

    const result = await runPrismaCli(["db", "seed"], prismaCliTarget(database.url), { TZ: "Asia/Kolkata" });

    expect(sessionTimeZone).toBe("America/Los_Angeles");
    expect(result.exitCode, outputOf(result)).toBe(0);
    expect(await withClient(database.url, storedHolidays)).toEqual(holidaysIn(loadHolidayFiles()));
  });

  it("deletes holidays the files no longer list, only in the calendar-years they cover", async () => {
    const database = await createMigratedDatabase("seed");
    const files = loadHolidayFiles();
    // A year with no file and a calendar the seed never writes (NFO follows NSE): both must survive.
    const uncovered = [
      { exchange: "NSE", date: "2024-01-26", name: "Republic Day", closure: "FULL_DAY" },
      { exchange: "NFO", date: "2026-01-26", name: "Republic Day", closure: "FULL_DAY" },
    ] as const;
    // The edit: the last 2026 NSE holiday is cancelled, and MCX now closes all day on 2026-01-01.
    const edited = structuredClone(files);
    const year2026 = edited.find((file) => file.year === 2026);
    const cancelled = year2026?.calendars.NSE.holidays.pop();
    const newYearDay = year2026?.calendars.MCX.holidays.find((holiday) => holiday.date === "2026-01-01");
    if (cancelled === undefined || newYearDay === undefined) throw new Error("2026 data changed: update this test");
    newYearDay.closure = "FULL_DAY";

    await withClient(database.url, async (prisma) => {
      await runSeed(prisma, { holidayFiles: files });
      expect(await storedHolidays(prisma)).toContainEqual({
        exchange: "NSE",
        date: cancelled.date,
        name: cancelled.name,
        closure: "FULL_DAY",
      });
      await prisma.marketHoliday.createMany({
        data: uncovered.map((row) => ({ ...row, date: new Date(`${row.date}T00:00:00.000Z`) })),
      });

      const summary = await runSeed(prisma, { holidayFiles: edited });

      expect(summary.holidays.deleted).toBe(1);
      expect(await storedHolidays(prisma)).toEqual(
        [...holidaysIn(edited), ...uncovered].sort(
          (a, b) => a.exchange.localeCompare(b.exchange) || a.date.localeCompare(b.date),
        ),
      );
    });
  });

  it("writes nothing when the holiday data is invalid", async () => {
    const database = await createMigratedDatabase("seed");
    const invalid = structuredClone(loadHolidayFiles());
    const firstHoliday = invalid[0]?.calendars.NSE.holidays[0];
    if (firstHoliday === undefined) throw new Error("No NSE holiday in the first file: update this test");
    firstHoliday.date = `${String(invalid[0]?.year)}-01-04`;

    await withClient(database.url, async (prisma) => {
      await expect(runSeed(prisma, { holidayFiles: invalid })).rejects.toThrow(/is a (Saturday|Sunday)/);

      expect(await prisma.plan.count()).toBe(0);
      expect(await prisma.globalControl.count()).toBe(0);
      expect(await prisma.marketHoliday.count()).toBe(0);
    });
  });

  it("exits non-zero when the seed fails", async () => {
    // No migrations: the seed's first query fails.
    const database = await createEmptyDatabase("unmigrated");

    const result = await runPrismaCli(["db", "seed"], prismaCliTarget(database.url));

    const output = outputOf(result);
    expect(result.exitCode, output).toBe(1);
    expect(output).toContain("Seed failed:");
    expect(output).not.toMatch(DATABASE_URL_PATTERN);
  });
});
