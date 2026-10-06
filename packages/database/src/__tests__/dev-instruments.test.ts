import { parseInstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import {
  devInstrumentRows,
  istToday,
  nextMonthlyExpiry,
  nextWeeklyExpiry,
  nseHolidays,
  previousTradingDay,
} from "../../prisma/seed/instruments";

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

describe("development instruments", () => {
  it("builds about 190 canonical, unique keys whose columns match the key", () => {
    const rows = devInstrumentRows(day("2026-10-06"), NO_HOLIDAYS);

    expect(rows.length).toBeGreaterThanOrEqual(180);
    expect(rows.length).toBeLessThanOrEqual(220);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    for (const row of rows) {
      const parsed = parseInstrumentKey(row.key);
      expect(parsed.ok, row.key).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.value.exchange, row.key).toBe(row.exchange);
      expect(parsed.value.segment, row.key).toBe(row.segment);
    }
    expect(rows.filter((row) => row.segment === "EQ")).toHaveLength(50);
    expect(rows.map((row) => row.key)).toContain("NSE_INDEX|NIFTY 50");
    expect(rows.map((row) => row.key)).toContain("NSE_EQ|M&M");
  });

  it("lists NIFTY weekly and monthly options and BANKNIFTY monthly options on Tuesdays", () => {
    const rows = devInstrumentRows(day("2026-10-06"), NO_HOLIDAYS);
    const expiries = (symbol: string) =>
      [
        ...new Set(
          rows
            .filter((row) => row.symbol === symbol && row.segment === "OPT")
            .map((row) => row.expiry?.toISOString().slice(0, 10)),
        ),
      ].sort();

    expect(expiries("NIFTY")).toEqual(["2026-10-06", "2026-10-27"]);
    expect(expiries("BANKNIFTY")).toEqual(["2026-10-27"]);
    expect(rows.find((row) => row.key === "NSE_FO|NIFTY|2026-10-06|25000|CE")).toMatchObject({
      tradingSymbol: "NIFTY26O0625000CE",
      strike: "25000",
      optionType: "CE",
    });
    expect(rows.find((row) => row.key === "NSE_FO|BANKNIFTY|2026-10-27")).toMatchObject({
      segment: "FUT",
      tradingSymbol: "BANKNIFTY26OCTFUT",
    });
  });

  it("moves an expiry that falls on a holiday to the previous trading day", () => {
    const holidays = new Set(["2026-10-13"]);

    expect(previousTradingDay(day("2026-10-13"), holidays)).toEqual(day("2026-10-12"));
    expect(previousTradingDay(day("2026-10-11"), NO_HOLIDAYS)).toEqual(day("2026-10-09")); // Sunday → Friday
    expect(nextWeeklyExpiry(day("2026-10-07"), holidays)).toEqual(day("2026-10-12"));
  });

  it("rolls the monthly expiry to next month once this month's has passed", () => {
    expect(nextMonthlyExpiry(day("2026-10-28"), NO_HOLIDAYS)).toEqual(day("2026-11-24"));
    expect(nextMonthlyExpiry(day("2026-10-27"), NO_HOLIDAYS)).toEqual(day("2026-10-27"));
  });

  it("reads NSE holidays from the seeded calendar and the IST date from a clock", () => {
    expect(nseHolidays().has("2026-01-26")).toBe(true);
    expect(istToday(new Date("2026-10-06T19:00:00.000Z"))).toEqual(day("2026-10-07"));
    expect(istToday(new Date("2026-10-06T18:00:00.000Z"))).toEqual(day("2026-10-06"));
  });
});
