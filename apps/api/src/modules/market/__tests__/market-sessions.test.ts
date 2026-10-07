import { describe, expect, it } from "vitest";

import { exchangeStatus, holidayIndex, istDate } from "../market-sessions";
import type { HolidayEntry } from "../market-sessions";

/** Epoch ms of an IST wall-clock time. */
function ist(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000;
}

const iso = (ms: number): string => new Date(ms).toISOString();
const NONE = holidayIndex([]);

describe("exchange sessions (IST)", () => {
  it("walks NSE through a weekday: closed, pre-open, open, post-close, closed", () => {
    // Tuesday 2026-10-06.
    expect(exchangeStatus("NSE", ist(2026, 10, 6, 8), NONE)).toEqual({
      exchange: "NSE",
      phase: "closed",
      holiday: null,
      opensAt: iso(ist(2026, 10, 6, 9, 15)),
      closesAt: null,
    });
    expect(exchangeStatus("NSE", ist(2026, 10, 6, 9, 5), NONE)).toEqual({
      exchange: "NSE",
      phase: "pre_open",
      holiday: null,
      opensAt: iso(ist(2026, 10, 6, 9, 15)),
      closesAt: iso(ist(2026, 10, 6, 15, 30)),
    });
    expect(exchangeStatus("BSE", ist(2026, 10, 6, 10), NONE)).toEqual({
      exchange: "BSE",
      phase: "open",
      holiday: null,
      opensAt: null,
      closesAt: iso(ist(2026, 10, 6, 15, 30)),
    });
    expect(exchangeStatus("NSE", ist(2026, 10, 6, 15, 45), NONE)).toMatchObject({
      phase: "post_close",
      opensAt: iso(ist(2026, 10, 7, 9, 15)),
      closesAt: null,
    });
    expect(exchangeStatus("NSE", ist(2026, 10, 6, 16), NONE)).toMatchObject({
      phase: "closed",
      opensAt: iso(ist(2026, 10, 7, 9, 15)),
    });
  });

  it("skips the weekend: Friday evening and Saturday open on Monday, with no holiday name", () => {
    expect(exchangeStatus("NSE", ist(2026, 10, 9, 17), NONE).opensAt).toBe(iso(ist(2026, 10, 12, 9, 15)));
    expect(exchangeStatus("NSE", ist(2026, 10, 10, 11), NONE)).toEqual({
      exchange: "NSE",
      phase: "closed",
      holiday: null,
      opensAt: iso(ist(2026, 10, 12, 9, 15)),
      closesAt: null,
    });
  });

  it("closes on a trading holiday, names it, and skips it for the next open", () => {
    const holidays = holidayIndex([
      { date: "2026-10-02", exchange: "NSE", name: "Mahatma Gandhi Jayanti", closure: "FULL_DAY" },
    ]);
    expect(exchangeStatus("NSE", ist(2026, 10, 2, 11), holidays)).toEqual({
      exchange: "NSE",
      phase: "closed",
      holiday: "Mahatma Gandhi Jayanti",
      opensAt: iso(ist(2026, 10, 5, 9, 15)),
      closesAt: null,
    });
    expect(exchangeStatus("NSE", ist(2026, 10, 1, 16), holidays).opensAt).toBe(iso(ist(2026, 10, 5, 9, 15)));
    // BSE has its own calendar: open that day.
    expect(exchangeStatus("BSE", ist(2026, 10, 2, 11), holidays).phase).toBe("open");
  });

  it("runs MCX 09:00–23:30 with no pre-open, and follows its half-day closures", () => {
    expect(exchangeStatus("MCX", ist(2026, 10, 6, 22), NONE)).toMatchObject({
      phase: "open",
      closesAt: iso(ist(2026, 10, 6, 23, 30)),
    });
    expect(exchangeStatus("MCX", ist(2026, 10, 6, 8, 50), NONE)).toMatchObject({
      phase: "closed",
      opensAt: iso(ist(2026, 10, 6, 9)),
    });
    expect(exchangeStatus("MCX", ist(2026, 10, 6, 23, 45), NONE).opensAt).toBe(iso(ist(2026, 10, 7, 9)));

    const holidays: HolidayEntry[] = [
      { date: "2026-10-06", exchange: "MCX", name: "Morning closed", closure: "MORNING_SESSION" },
      { date: "2026-10-07", exchange: "MCX", name: "Evening closed", closure: "EVENING_SESSION" },
    ];
    const index = holidayIndex(holidays);
    expect(exchangeStatus("MCX", ist(2026, 10, 6, 10), index)).toEqual({
      exchange: "MCX",
      phase: "closed",
      holiday: "Morning closed",
      opensAt: iso(ist(2026, 10, 6, 17)),
      closesAt: null,
    });
    expect(exchangeStatus("MCX", ist(2026, 10, 6, 18), index)).toMatchObject({ phase: "open", holiday: null });
    expect(exchangeStatus("MCX", ist(2026, 10, 7, 10), index)).toMatchObject({
      phase: "open",
      closesAt: iso(ist(2026, 10, 7, 17)),
    });
    expect(exchangeStatus("MCX", ist(2026, 10, 7, 18), index)).toMatchObject({
      phase: "closed",
      holiday: "Evening closed",
      opensAt: iso(ist(2026, 10, 8, 9)),
    });
  });

  it("gives up looking for the next session beyond the lookahead", () => {
    const entries: HolidayEntry[] = Array.from({ length: 20 }, (_, index) => ({
      date: istDate(ist(2026, 10, 7 + index, 0)),
      exchange: "NSE",
      name: "Closed",
      closure: "FULL_DAY" as const,
    }));
    expect(exchangeStatus("NSE", ist(2026, 10, 6, 17), holidayIndex(entries)).opensAt).toBeNull();
  });
});
