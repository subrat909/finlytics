import { describe, expect, it } from "vitest";

import {
  HOLIDAY_CALENDARS,
  holidayRows,
  loadHolidayFiles,
  parseHolidayDataFile,
  parseHolidayFile,
} from "../../prisma/seed/holidays";
import type { HolidayCalendar, HolidayFileInput } from "../../prisma/seed/holidays";
import { MAX_RT_SUBSCRIPTIONS, PLANS } from "../../prisma/seed/plans";
import { formatSeedSummary } from "../../prisma/seed/run";

function source(id: string, url: string): HolidayFileInput["calendars"]["NSE"]["sources"][number] {
  return {
    id,
    issuer: "Exchange",
    title: "Trading holidays for 2026",
    url,
    publishedOn: "2025-12-12",
    retrievedOn: "2026-01-05",
  };
}

/** A small valid 2026 file: one official source per calendar (bare hosts and subdomains), weekday holidays only. */
function validFile(): HolidayFileInput {
  return {
    year: 2026,
    calendars: {
      NSE: {
        sources: [source("NSE/FAOP/1", "https://nsearchives.nseindia.com/content/circulars/FAOP1.pdf")],
        holidays: [
          { date: "2026-01-26", name: "Republic Day", source: "NSE/FAOP/1" },
          { date: "2026-03-03", name: "Holi", source: "NSE/FAOP/1" },
        ],
      },
      BSE: {
        sources: [source("BSE/1", "https://www.bseindia.com/markets/MarketInfo/DispNewNoticesCirculars.aspx")],
        holidays: [{ date: "2026-01-26", name: "Republic Day", source: "BSE/1" }],
      },
      MCX: {
        sources: [source("MCX/TRD/1", "https://www.mcxindia.com/circulars/1")],
        holidays: [
          { date: "2026-01-01", name: "New Year Day", source: "MCX/TRD/1", closure: "EVENING_SESSION" },
          { date: "2026-01-26", name: "Republic Day", source: "MCX/TRD/1", closure: "FULL_DAY" },
        ],
      },
      CDS: {
        sources: [source("NSE/CD/1", "https://nseclearing.in/circulars/CD1.pdf")],
        holidays: [{ date: "2026-01-26", name: "Republic Day", source: "NSE/CD/1" }],
      },
    },
  };
}

type HolidayInput = HolidayFileInput["calendars"]["NSE"]["holidays"][number];

function holidayAt(file: HolidayFileInput, calendar: HolidayCalendar, index: number): HolidayInput {
  const holiday = file.calendars[calendar].holidays[index];
  if (holiday === undefined) throw new Error(`No ${calendar} holiday at ${String(index)}`);
  return holiday;
}

describe("holiday data", () => {
  it("accepts the checked-in holiday files", () => {
    const files = loadHolidayFiles();

    const years = files.map((file) => file.year);
    expect(years).toContain(2025);
    expect(years).toContain(2026);
    for (const file of files) {
      for (const calendar of HOLIDAY_CALENDARS) expect(holidayRows(file, calendar).length).toBeGreaterThan(0);
    }
  });

  it("accepts a well-formed file", () => {
    expect(parseHolidayFile(validFile()).calendars.MCX.holidays).toHaveLength(2);
  });

  it("rejects a weekend holiday", () => {
    const file = validFile();
    holidayAt(file, "NSE", 0).date = "2026-01-24";

    expect(() => parseHolidayFile(file)).toThrow("calendars.NSE.holidays[0].date: 2026-01-24 is a Saturday");
  });

  it("rejects duplicate dates within an exchange", () => {
    const file = validFile();
    file.calendars.BSE.holidays.push({ date: "2026-01-26", name: "Republic Day (again)", source: "BSE/1" });

    expect(() => parseHolidayFile(file)).toThrow("calendars.BSE.holidays[1].date: 2026-01-26 is listed twice");
  });

  it("rejects a holiday outside the file's year", () => {
    const file = validFile();
    holidayAt(file, "CDS", 0).date = "2025-12-25";

    expect(() => parseHolidayFile(file)).toThrow("calendars.CDS.holidays[0].date: 2025-12-25 is not in 2026");
  });

  it("rejects session closures outside MCX", () => {
    for (const closure of ["MORNING_SESSION", "EVENING_SESSION", "FULL_DAY"] as const) {
      const file = validFile();
      holidayAt(file, "NSE", 1).closure = closure;

      expect(() => parseHolidayFile(file)).toThrow(
        "calendars.NSE.holidays[1].closure: only MCX closes a single session",
      );
    }
  });

  it("requires a closure on every MCX holiday", () => {
    const file = validFile();
    Reflect.deleteProperty(holidayAt(file, "MCX", 1), "closure");

    expect(() => parseHolidayFile(file)).toThrow(
      "calendars.MCX.holidays[1].closure: MCX holidays must say what is closed",
    );
  });

  it("requires an official https source for every calendar", () => {
    const withoutSources = validFile();
    withoutSources.calendars.CDS.sources = [];
    expect(() => parseHolidayFile(withoutSources)).toThrow("every calendar needs at least one official source");

    const unofficial = [
      "http://nsearchives.nseindia.com/content/circulars/FAOP1.pdf", // not https
      "https://example.com/nse-holidays.pdf", // not an exchange
      "https://nseindia.com.example.net/holidays.pdf", // official name as a prefix of another domain
      "https://fakenseindia.com/holidays.pdf", // official name as a suffix without the dot
      "https://someone@www.nseindia.com/holidays.pdf", // credentials in the URL
      "nsearchives.nseindia.com/content/circulars/FAOP1.pdf", // not a URL
    ];
    for (const url of unofficial) {
      const file = validFile();
      file.calendars.NSE.sources = [source("NSE/FAOP/1", url)];

      expect(() => parseHolidayFile(file), url).toThrow(
        "calendars.NSE.sources[0].url: must be an https URL on an official host",
      );
    }
  });

  it("rejects a holiday whose source is not listed in its calendar", () => {
    const file = validFile();
    holidayAt(file, "NSE", 0).source = "BSE/1";

    expect(() => parseHolidayFile(file)).toThrow(
      "calendars.NSE.holidays[0].source: source BSE/1 is not one of the NSE sources",
    );
  });

  it("rejects dates that do not exist", () => {
    const file = validFile();
    holidayAt(file, "NSE", 1).date = "2026-02-30";

    expect(() => parseHolidayFile(file)).toThrow(
      "calendars.NSE.holidays[1].date: must be a real date in YYYY-MM-DD form",
    );
  });

  it("rejects holidays out of date order", () => {
    const file = validFile();
    file.calendars.NSE.holidays.reverse();

    expect(() => parseHolidayFile(file)).toThrow("2026-01-26 comes after 2026-03-03: keep holidays in date order");
  });

  it("rejects a source published after it was retrieved", () => {
    const file = validFile();
    file.calendars.BSE.sources = [{ ...source("BSE/1", "https://www.bseindia.com/x"), publishedOn: "2026-02-01" }];

    expect(() => parseHolidayFile(file)).toThrow(
      "calendars.BSE.sources[0].retrievedOn: publishedOn must not be after retrievedOn",
    );
  });

  it("rejects unknown keys", () => {
    const file = { ...validFile(), comment: "not part of the format" };

    expect(() => parseHolidayFile(file)).toThrow('Unrecognized key: "comment"');
  });

  it("requires all four calendars", () => {
    const file = validFile();
    Reflect.deleteProperty(file.calendars, "CDS");

    expect(() => parseHolidayFile(file)).toThrow("calendars.CDS:");
  });

  it("rejects an empty calendar, which would delete every stored holiday for its year", () => {
    // The seed deletes the stored rows a calendar-year doesn't list, and `notIn: []` matches every row.
    const file = validFile();
    file.calendars.BSE.holidays = [];

    expect(() => parseHolidayFile(file)).toThrow(
      "calendars.BSE.holidays: every calendar needs at least one holiday: an empty list would delete every stored " +
        "holiday for its year",
    );
  });

  it("rejects a file whose name does not match its year", () => {
    expect(() => parseHolidayDataFile("market-holidays-2025.json", validFile())).toThrow(
      'market-holidays-2025.json: "year" is 2026, but the file name says 2025',
    );
    expect(() => parseHolidayDataFile("holidays-2026.json", validFile())).toThrow("named market-holidays-YYYY.json");
  });

  it("maps every calendar to its own exchange, at UTC midnight, closing the full day unless MCX says otherwise", () => {
    const file = parseHolidayFile(validFile());

    expect(holidayRows(file, "NSE")[0]).toEqual({
      exchange: "NSE",
      date: new Date("2026-01-26T00:00:00.000Z"),
      name: "Republic Day",
      closure: "FULL_DAY",
    });
    expect(holidayRows(file, "MCX").map((row) => row.closure)).toEqual(["EVENING_SESSION", "FULL_DAY"]);
  });
});

describe("plans", () => {
  it("keeps maxRtSubscriptions at or below 300 for every plan", () => {
    expect(MAX_RT_SUBSCRIPTIONS).toBe(300);
    for (const plan of PLANS) expect(plan.maxRtSubscriptions, plan.code).toBeLessThanOrEqual(MAX_RT_SUBSCRIPTIONS);
  });

  it("gives every plan its own code", () => {
    const codes = PLANS.map((plan) => plan.code);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("seed summary", () => {
  it("prints one line per table, with counts only", () => {
    const lines = formatSeedSummary({
      plans: { created: 0, total: 3 },
      globalControl: { created: false, killSwitch: true },
      holidays: { years: [2025, 2026], upserted: 130, deleted: 1, byCalendar: { NSE: 30, BSE: 30, MCX: 32, CDS: 38 } },
    });

    expect(lines).toEqual([
      "Plan: 3 rows, 0 created (existing plans are never updated)",
      "GlobalControl: already present, left unchanged, kill switch ENGAGED",
      "MarketHoliday: 130 rows upserted for 2025, 2026 (NSE 30, BSE 30, MCX 32, CDS 38), 1 deleted",
    ]);
  });
});
