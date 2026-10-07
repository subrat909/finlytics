/**
 * Market holiday data files (prisma/seed-data/market-holidays-YYYY.json): the strict schema, the rules every file must
 * follow, and the mapping to MarketHoliday rows. Pure apart from loadHolidayFiles(), which reads the folder.
 *
 * One calendar per closing calendar (plan D12): NSE (NFO follows it), BSE (BFO follows it), MCX (which can close a
 * single session) and CDS (NSE currency derivatives, which also close on bank holidays). Every holiday cites a source
 * listed in its calendar, and every source is an official exchange or clearing-corporation document.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { HolidayClosure } from "../../src/index";
import type { Exchange } from "../../src/index";

/** The calendars every file lists, which are also the MarketHoliday exchanges the seed writes. */
export const HOLIDAY_CALENDARS = ["NSE", "BSE", "MCX", "CDS"] as const satisfies readonly Exchange[];
export type HolidayCalendar = (typeof HOLIDAY_CALENDARS)[number];

/** Hosts whose documents may be cited as sources; their subdomains (www., nsearchives.) are accepted too. */
export const OFFICIAL_SOURCE_HOSTS = [
  "nseindia.com",
  "nsearchives.nseindia.com",
  "nseclearing.in",
  "bseindia.com",
  "mcxindia.com",
  "mcxccl.com",
] as const;

/** The folder the seed reads holiday files from. */
export const HOLIDAY_DATA_DIR = fileURLToPath(new URL("../seed-data/", import.meta.url));

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FILE_NAME = /^market-holidays-(\d{4})\.json$/;

/** Thrown when a holiday file is missing, misnamed or invalid. The message lists every problem found. */
export class HolidayDataError extends Error {
  override readonly name = "HolidayDataError";
}

/** UTC midnight of a YYYY-MM-DD date, or undefined when the string is not a real calendar date (2026-02-30). */
export function parseIsoDate(value: string): Date | undefined {
  const match = ISO_DATE.exec(value);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const isSameDay = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isSameDay ? date : undefined;
}

/** https, no credentials, and a hostname that is an official host or a subdomain of one (never a substring match). */
function isOfficialSourceUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol, username, password, hostname } = new URL(value);
  if (protocol !== "https:" || username !== "" || password !== "") return false;
  return OFFICIAL_SOURCE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

const IsoDateSchema = z.string().refine((value) => parseIsoDate(value) !== undefined, {
  error: "must be a real date in YYYY-MM-DD form",
});

const SourceSchema = z
  .strictObject({
    /** The circular or notice number, cited by holidays as `source`. */
    id: z.string().trim().min(1),
    issuer: z.string().trim().min(1),
    title: z.string().trim().min(1),
    url: z.string().refine(isOfficialSourceUrl, {
      error: `must be an https URL on an official host (${OFFICIAL_SOURCE_HOSTS.join(", ")}) or a subdomain of one`,
    }),
    publishedOn: IsoDateSchema,
    retrievedOn: IsoDateSchema,
  })
  .refine((source) => source.publishedOn <= source.retrievedOn, {
    error: "publishedOn must not be after retrievedOn",
    path: ["retrievedOn"],
  });

const HolidaySchema = z.strictObject({
  date: IsoDateSchema,
  name: z.string().trim().min(1),
  /** The `id` of a source in the same calendar. */
  source: z.string().trim().min(1),
  /** MCX only (required there): the part of the day that is closed. Other calendars always close the full day. */
  closure: z.enum(HolidayClosure).optional(),
  note: z.string().trim().min(1).optional(),
});

const CalendarSchema = z.strictObject({
  sources: z.array(SourceSchema).min(1, { error: "every calendar needs at least one official source" }),
  // The seed makes a calendar-year's stored rows match this list, deleting the ones it doesn't name. Prisma compiles
  // `notIn: []` to TRUE, so an empty list would delete every stored holiday of that exchange and year.
  holidays: z.array(HolidaySchema).min(1, {
    error: "every calendar needs at least one holiday: an empty list would delete every stored holiday for its year",
  }),
});

export const HolidayFileSchema = z
  .strictObject({
    year: z.int().min(2000).max(2099),
    calendars: z.strictObject({ NSE: CalendarSchema, BSE: CalendarSchema, MCX: CalendarSchema, CDS: CalendarSchema }),
  })
  .superRefine((file, ctx) => {
    for (const calendar of HOLIDAY_CALENDARS) {
      const { sources, holidays } = file.calendars[calendar];
      const report = (path: readonly PropertyKey[], message: string): void => {
        ctx.addIssue({ code: "custom", path: ["calendars", calendar, ...path], message });
      };

      const sourceIds = new Set<string>();
      sources.forEach((source, index) => {
        if (sourceIds.has(source.id)) report(["sources", index, "id"], `source id ${source.id} is listed twice`);
        sourceIds.add(source.id);
      });

      const dates = new Set<string>();
      let previous: string | undefined;
      holidays.forEach((holiday, index) => {
        const at = ["holidays", index] as const;
        const date = parseIsoDate(holiday.date);
        if (date !== undefined) {
          if (date.getUTCFullYear() !== file.year) {
            report([...at, "date"], `${holiday.date} is not in ${String(file.year)}`);
          }
          const weekday = date.getUTCDay();
          if (weekday === 0 || weekday === 6) {
            const dayName = weekday === 0 ? "Sunday" : "Saturday";
            report([...at, "date"], `${holiday.date} is a ${dayName}: list weekday closures only`);
          }
          if (dates.has(holiday.date)) {
            report([...at, "date"], `${holiday.date} is listed twice`);
          } else if (previous !== undefined && holiday.date < previous) {
            report([...at, "date"], `${holiday.date} comes after ${previous}: keep holidays in date order`);
          }
          dates.add(holiday.date);
          previous = holiday.date;
        }
        if (calendar === "MCX" && holiday.closure === undefined) {
          report(
            [...at, "closure"],
            "MCX holidays must say what is closed: FULL_DAY, MORNING_SESSION or EVENING_SESSION",
          );
        }
        if (calendar !== "MCX" && holiday.closure !== undefined) {
          report([...at, "closure"], `only MCX closes a single session: omit closure for ${calendar}`);
        }
        if (!sourceIds.has(holiday.source)) {
          report([...at, "source"], `source ${holiday.source} is not one of the ${calendar} sources`);
        }
      });
    }
  });

/** A holiday file as written in JSON. */
export type HolidayFileInput = z.input<typeof HolidayFileSchema>;
/** A validated holiday file. */
export type HolidayFile = z.output<typeof HolidayFileSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path
        .map((segment, index) =>
          typeof segment === "number" ? `[${String(segment)}]` : `${index > 0 ? "." : ""}${String(segment)}`,
        )
        .join("");
      return `  ${location === "" ? "(file)" : location}: ${issue.message}`;
    })
    .join("\n");
}

/**
 * Validates one holiday file's contents.
 * @param label names the file in error messages.
 * @throws {HolidayDataError} listing every problem found.
 */
export function parseHolidayFile(raw: unknown, label = "holiday file"): HolidayFile {
  const result = HolidayFileSchema.safeParse(raw);
  if (!result.success) throw new HolidayDataError(`${label} is invalid:\n${formatIssues(result.error)}`);
  return result.data;
}

/**
 * Validates a holiday file and its name: market-holidays-YYYY.json, where YYYY is the file's `year`.
 * @throws {HolidayDataError}
 */
export function parseHolidayDataFile(fileName: string, raw: unknown): HolidayFile {
  const nameYear = FILE_NAME.exec(fileName)?.[1];
  if (nameYear === undefined)
    throw new HolidayDataError(`${fileName}: holiday files are named market-holidays-YYYY.json`);
  const file = parseHolidayFile(raw, fileName);
  if (String(file.year) !== nameYear) {
    throw new HolidayDataError(`${fileName}: "year" is ${String(file.year)}, but the file name says ${nameYear}`);
  }
  return file;
}

/**
 * Reads and validates every market-holidays-*.json file in `directory`, in year order.
 * @throws {HolidayDataError} when there is none, or any of them is misnamed or invalid.
 */
export function loadHolidayFiles(directory: string = HOLIDAY_DATA_DIR): HolidayFile[] {
  const fileNames = readdirSync(directory)
    .filter((name) => name.startsWith("market-holidays-") && name.endsWith(".json"))
    .sort();
  if (fileNames.length === 0) throw new HolidayDataError(`No market-holidays-*.json files in ${directory}`);
  return fileNames.map((fileName) =>
    parseHolidayDataFile(fileName, JSON.parse(readFileSync(path.join(directory, fileName), "utf8"))),
  );
}

/** A MarketHoliday row: the calendar's exchange, the date as UTC midnight (a @db.Date), and FULL_DAY by default. */
export interface HolidayRow {
  readonly exchange: HolidayCalendar;
  readonly date: Date;
  readonly name: string;
  readonly closure: HolidayClosure;
}

/** The rows one calendar of a validated file maps to. */
export function holidayRows(file: HolidayFile, calendar: HolidayCalendar): HolidayRow[] {
  return file.calendars[calendar].holidays.map((holiday) => {
    const date = parseIsoDate(holiday.date);
    if (date === undefined) throw new HolidayDataError(`Invalid date ${holiday.date}: validate the file first`);
    return { exchange: calendar, date, name: holiday.name, closure: holiday.closure ?? HolidayClosure.FULL_DAY };
  });
}
