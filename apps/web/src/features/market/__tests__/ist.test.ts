import { describe, expect, it } from "vitest";

import { describeSession, formatIstTime, formatSessionTime } from "../lib/ist";

const TUESDAY_1330_IST = Date.parse("2026-10-06T08:00:00.000Z");

describe("formatIstTime", () => {
  it("shows Indian time whatever the device's zone, with or without seconds", () => {
    expect(formatIstTime(Date.parse("2026-10-06T03:45:09.000Z"))).toBe("09:15");
    expect(formatIstTime(Date.parse("2026-10-06T03:45:09.000Z"), true)).toBe("09:15:09");
    expect(formatIstTime(Date.parse("2026-10-06T18:29:59.000Z"), true)).toBe("23:59:59");
    expect(formatIstTime(Date.parse("2026-10-06T18:30:00.000Z"), true)).toBe("00:00:00");
  });
});

describe("formatSessionTime", () => {
  it("shows the time alone today, the weekday within the week, and the date beyond", () => {
    expect(formatSessionTime("2026-10-06T10:00:00.000Z", TUESDAY_1330_IST)).toBe("15:30");
    expect(formatSessionTime("2026-10-07T03:45:00.000Z", TUESDAY_1330_IST)).toBe("Wed 09:15");
    expect(formatSessionTime("2026-10-12T03:45:00.000Z", TUESDAY_1330_IST)).toBe("Mon 09:15");
    expect(formatSessionTime("2026-10-20T03:45:00.000Z", TUESDAY_1330_IST)).toBe("20 Oct 09:15");
  });

  it("decides 'today' by the IST calendar, not UTC's", () => {
    // 23:00 IST on Tuesday is still Tuesday 17:30 UTC; 01:00 IST on Wednesday is Tuesday 19:30 UTC.
    const lateTuesday = Date.parse("2026-10-06T17:30:00.000Z");
    expect(formatSessionTime("2026-10-06T18:00:00.000Z", lateTuesday)).toBe("23:30");
    expect(formatSessionTime("2026-10-07T03:30:00.000Z", lateTuesday)).toBe("Wed 09:00");
  });

  it("gives nothing for an unreadable time", () => {
    expect(formatSessionTime("soon", TUESDAY_1330_IST)).toBeUndefined();
  });
});

describe("describeSession", () => {
  it("says when an open session closes", () => {
    const view = describeSession(
      { exchange: "NSE", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T10:00:00.000Z" },
      TUESDAY_1330_IST,
    );
    expect(view).toEqual({ exchange: "NSE", label: "Open", detail: "closes 15:30", dot: "bg-profit", holiday: null });
  });

  it("says when pre-open turns into the session", () => {
    const view = describeSession(
      {
        exchange: "BSE",
        phase: "pre_open",
        holiday: null,
        opensAt: "2026-10-06T03:45:00.000Z",
        closesAt: "2026-10-06T10:00:00.000Z",
      },
      Date.parse("2026-10-06T03:35:00.000Z"),
    );
    expect(view).toMatchObject({ label: "Pre-open", detail: "opens 09:15", dot: "bg-info" });
  });

  it("falls back to the close time in pre-open when the open time is missing", () => {
    const view = describeSession(
      { exchange: "NSE", phase: "pre_open", holiday: null, opensAt: null, closesAt: "2026-10-06T10:00:00.000Z" },
      Date.parse("2026-10-06T03:35:00.000Z"),
    );
    expect(view.detail).toBe("closes 15:30");
  });

  it("says when the next session opens after the close, on a weekend and on a holiday", () => {
    expect(
      describeSession(
        { exchange: "NSE", phase: "post_close", holiday: null, opensAt: "2026-10-07T03:45:00.000Z", closesAt: null },
        Date.parse("2026-10-06T10:10:00.000Z"),
      ),
    ).toMatchObject({ label: "Post-close", detail: "opens Wed 09:15", dot: "bg-warning" });

    expect(
      describeSession(
        { exchange: "NSE", phase: "closed", holiday: null, opensAt: "2026-10-12T03:45:00.000Z", closesAt: null },
        Date.parse("2026-10-10T06:00:00.000Z"),
      ),
    ).toMatchObject({ label: "Closed", detail: "opens Mon 09:15", dot: "bg-fg-muted" });

    expect(
      describeSession(
        { exchange: "MCX", phase: "closed", holiday: "Gandhi Jayanti", opensAt: null, closesAt: null },
        Date.parse("2026-10-02T06:00:00.000Z"),
      ),
    ).toMatchObject({ label: "Holiday", detail: undefined, holiday: "Gandhi Jayanti" });
  });
});
