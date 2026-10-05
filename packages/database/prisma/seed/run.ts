/**
 * The seed itself (plan D11), separate from the CLI entry point (prisma/seed.ts) so tests can run it in-process.
 *
 * - Plan and GlobalControl are create-only: rows that exist are never updated, so a re-seed can't overwrite an edited
 *   price or switch off an engaged kill switch.
 * - MarketHoliday follows the data files: each file is the source of truth for the calendar-years it covers.
 */
import type { PrismaClient } from "../../src/index";
import { HOLIDAY_CALENDARS, HolidayDataError, holidayRows, loadHolidayFiles, parseHolidayFile } from "./holidays";
import type { HolidayCalendar, HolidayFile } from "./holidays";
import { PLANS } from "./plans";

/**
 * GlobalControl is a singleton (CHECK ("id" = 1), migrations/<timestamp>_db_guards) and permanent: triggers in
 * migrations/<timestamp>_kill_switch_and_audit_guards reject DELETE and TRUNCATE, so once this seed has created the row,
 * it can't disappear and come back with the kill switch off.
 */
const GLOBAL_CONTROL_ID = 1;

/** Generous limits, so a slow remote database doesn't time out a seed transaction (Prisma's default is 5 s). */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export interface SeedOptions {
  /** Holiday data to apply instead of prisma/seed-data (tests). It is validated again before anything is written. */
  readonly holidayFiles?: readonly HolidayFile[];
}

export interface SeedSummary {
  readonly plans: {
    /** Plans this run created (the rest already existed and were left as they are). */
    readonly created: number;
    /** Plan rows in the table after the run. */
    readonly total: number;
  };
  readonly globalControl: {
    readonly created: boolean;
    /** The kill switch after the run: whatever an operator set, if the row already existed. */
    readonly killSwitch: boolean;
  };
  readonly holidays: {
    /** The years the data files cover, ascending. */
    readonly years: readonly number[];
    /** Rows created or brought up to date: every row the files list. */
    readonly upserted: number;
    /** Rows removed from the covered calendar-years because the files no longer list them. */
    readonly deleted: number;
    /** Rows the files list, per calendar. */
    readonly byCalendar: Readonly<Record<HolidayCalendar, number>>;
  };
}

/**
 * Seeds plans, the global control row and market holidays. Safe to run any number of times, in any environment.
 * Every holiday file is validated before the first write, so invalid data never half-seeds a database.
 *
 * @throws {HolidayDataError} when the holiday data is invalid (nothing has been written then).
 */
export async function runSeed(prisma: PrismaClient, options: SeedOptions = {}): Promise<SeedSummary> {
  const holidayFiles = validateHolidayFiles(options.holidayFiles ?? loadHolidayFiles());
  const plans = await seedPlans(prisma);
  const globalControl = await seedGlobalControl(prisma);
  const holidays = await seedHolidays(prisma, holidayFiles);
  return { plans, globalControl, holidays };
}

/** One line per table, for the CLI. Counts only: never a URL, a credential or row contents. */
export function formatSeedSummary({ plans, globalControl, holidays }: SeedSummary): string[] {
  const perCalendar = HOLIDAY_CALENDARS.map((calendar) => `${calendar} ${String(holidays.byCalendar[calendar])}`);
  return [
    `Plan: ${String(plans.total)} rows, ${String(plans.created)} created (existing plans are never updated)`,
    `GlobalControl: ${globalControl.created ? "created" : "already present, left unchanged"}, ` +
      `kill switch ${globalControl.killSwitch ? "ENGAGED" : "off"}`,
    `MarketHoliday: ${String(holidays.upserted)} rows upserted for ${holidays.years.join(", ")} ` +
      `(${perCalendar.join(", ")}), ${String(holidays.deleted)} deleted`,
  ];
}

function validateHolidayFiles(files: readonly HolidayFile[]): HolidayFile[] {
  const years = new Set<number>();
  const valid = files.map((file) => parseHolidayFile(file, `holiday data for ${String(file.year)}`));
  for (const file of valid) {
    if (years.has(file.year))
      throw new HolidayDataError(`Two holiday files for ${String(file.year)}: one file per year`);
    years.add(file.year);
    for (const calendar of HOLIDAY_CALENDARS) {
      // Defensive, independent of the file schema (which also rejects this), and before the first write: seedHolidays
      // deletes the stored rows a calendar-year doesn't list, and Prisma compiles `notIn: []` to TRUE, so an empty
      // calendar-year would delete every stored holiday of that exchange and year.
      if (holidayRows(file, calendar).length === 0) {
        throw new HolidayDataError(
          `${calendar} ${String(file.year)} lists no holidays: seeding it would delete every stored ${calendar} ` +
            `holiday for ${String(file.year)}`,
        );
      }
    }
  }
  return valid.sort((a, b) => a.year - b.year);
}

async function seedPlans(prisma: PrismaClient): Promise<SeedSummary["plans"]> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.plan.count({ where: { code: { in: PLANS.map((plan) => plan.code) } } });
    for (const plan of PLANS) {
      // Create-only: `update: {}` leaves an existing plan exactly as it is, edited price and limits included.
      await tx.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
    }
    return { created: PLANS.length - existing, total: await tx.plan.count() };
  }, TRANSACTION_OPTIONS);
}

async function seedGlobalControl(prisma: PrismaClient): Promise<SeedSummary["globalControl"]> {
  return prisma.$transaction(async (tx) => {
    const existed = (await tx.globalControl.count({ where: { id: GLOBAL_CONTROL_ID } })) > 0;
    // Create-only: `update: {}` never switches off an engaged kill switch (nor touches its reason or updatedAt).
    const control = await tx.globalControl.upsert({
      where: { id: GLOBAL_CONTROL_ID },
      create: { id: GLOBAL_CONTROL_ID, killSwitch: false },
      update: {},
      select: { killSwitch: true },
    });
    return { created: !existed, killSwitch: control.killSwitch };
  }, TRANSACTION_OPTIONS);
}

async function seedHolidays(prisma: PrismaClient, files: readonly HolidayFile[]): Promise<SeedSummary["holidays"]> {
  const byCalendar: Record<HolidayCalendar, number> = { NSE: 0, BSE: 0, MCX: 0, CDS: 0 };
  let upserted = 0;
  let deleted = 0;

  for (const file of files) {
    const yearStart = new Date(Date.UTC(file.year, 0, 1));
    const nextYearStart = new Date(Date.UTC(file.year + 1, 0, 1));
    for (const calendar of HOLIDAY_CALENDARS) {
      const rows = holidayRows(file, calendar);
      // One transaction per calendar-year, in which the file is the source of truth: rows it no longer lists (a
      // cancelled holiday) are deleted, listed rows are created or updated. Other years and calendars are untouched.
      // `rows` is never empty (validateHolidayFiles): an empty `notIn` would delete the whole calendar-year.
      deleted += await prisma.$transaction(async (tx) => {
        const removed = await tx.marketHoliday.deleteMany({
          where: {
            exchange: calendar,
            date: { gte: yearStart, lt: nextYearStart, notIn: rows.map((row) => row.date) },
          },
        });
        for (const row of rows) {
          await tx.marketHoliday.upsert({
            where: { exchange_date: { exchange: row.exchange, date: row.date } },
            create: row,
            update: { name: row.name, closure: row.closure },
          });
        }
        return removed.count;
      }, TRANSACTION_OPTIONS);
      upserted += rows.length;
      byCalendar[calendar] += rows.length;
    }
  }

  return { years: files.map((file) => file.year), upserted, deleted, byCalendar };
}
