import { describe, expect, expectTypeOf, it } from "vitest";

import {
  holidayCalendarFor,
  SEGMENT_TOKEN_INFO,
  SEGMENT_TOKENS,
  segmentTokenFor,
  SegmentTokenSchema,
} from "../constants/exchanges";
import type { HolidayCalendar, SegmentToken } from "../constants/exchanges";
import { EXCHANGES, SEGMENTS } from "../schemas/enums";
import type { Exchange } from "../schemas/enums";

describe("segment tokens", () => {
  it("maps every segment token to a Prisma exchange and its instrument kinds", () => {
    expect(SEGMENT_TOKEN_INFO).toEqual({
      NSE_EQ: { exchange: "NSE", kinds: ["EQ"] },
      NSE_INDEX: { exchange: "NSE", kinds: ["INDEX"] },
      NSE_FO: { exchange: "NFO", kinds: ["FUT", "OPT"] },
      NSE_CD: { exchange: "CDS", kinds: ["FUT", "OPT"] },
      BSE_EQ: { exchange: "BSE", kinds: ["EQ"] },
      BSE_INDEX: { exchange: "BSE", kinds: ["INDEX"] },
      BSE_FO: { exchange: "BFO", kinds: ["FUT", "OPT"] },
      MCX_FO: { exchange: "MCX", kinds: ["FUT", "OPT"] },
    });
    expect(Object.keys(SEGMENT_TOKEN_INFO)).toEqual([...SEGMENT_TOKENS]);
    for (const token of SEGMENT_TOKENS) {
      const { exchange, kinds } = SEGMENT_TOKEN_INFO[token];
      expect(EXCHANGES, token).toContain(exchange);
      for (const kind of kinds) expect(SEGMENTS, token).toContain(kind);
    }
  });

  it("derives the schema from the token tuple", () => {
    expect(SegmentTokenSchema.options).toEqual([...SEGMENT_TOKENS]);
    expect(SegmentTokenSchema.safeParse("NSE_FO").success).toBe(true);
    for (const candidate of ["nse_fo", "NFO", "NSE_FUT", "toString", ""]) {
      expect(SegmentTokenSchema.safeParse(candidate).success, candidate).toBe(false);
    }
  });

  it("finds the token for every exchange and segment pair it covers, and only those", () => {
    const covered: string[] = [];
    for (const exchange of EXCHANGES) {
      for (const segment of SEGMENTS) {
        const token = segmentTokenFor(exchange, segment);
        if (token === undefined) continue;
        covered.push(`${exchange}/${segment}→${token}`);
        const info = SEGMENT_TOKEN_INFO[token];
        expect(info.exchange).toBe(exchange);
        expect(info.kinds).toContain(segment);
      }
    }

    expect(covered).toEqual([
      "NSE/EQ→NSE_EQ",
      "NSE/INDEX→NSE_INDEX",
      "BSE/EQ→BSE_EQ",
      "BSE/INDEX→BSE_INDEX",
      "MCX/FUT→MCX_FO",
      "MCX/OPT→MCX_FO",
      "NFO/FUT→NSE_FO",
      "NFO/OPT→NSE_FO",
      "BFO/FUT→BSE_FO",
      "BFO/OPT→BSE_FO",
      "CDS/FUT→NSE_CD",
      "CDS/OPT→NSE_CD",
    ]);
  });

  it("returns undefined for pairs no token covers", () => {
    expect(segmentTokenFor("NSE", "FUT")).toBeUndefined();
    expect(segmentTokenFor("NFO", "EQ")).toBeUndefined();
    expect(segmentTokenFor("MCX", "INDEX")).toBeUndefined();
    expect(segmentTokenFor("CDS", "EQ")).toBeUndefined();
    expect(segmentTokenFor("NYSE" as Exchange, "EQ")).toBeUndefined();
  });

  it("freezes the token tables at every depth", () => {
    expect(Object.isFrozen(SEGMENT_TOKENS)).toBe(true);
    expect(Object.isFrozen(SEGMENT_TOKEN_INFO)).toBe(true);
    for (const token of SEGMENT_TOKENS) {
      expect(Object.isFrozen(SEGMENT_TOKEN_INFO[token]), token).toBe(true);
      expect(Object.isFrozen(SEGMENT_TOKEN_INFO[token].kinds), token).toBe(true);
    }
    expect(() => {
      (SEGMENT_TOKEN_INFO.NSE_EQ.kinds as unknown as string[]).push("FUT");
    }).toThrow(TypeError);
  });

  it("types tokens as their literal union", () => {
    expectTypeOf<SegmentToken>().toEqualTypeOf<
      "NSE_EQ" | "NSE_INDEX" | "NSE_FO" | "NSE_CD" | "BSE_EQ" | "BSE_INDEX" | "BSE_FO" | "MCX_FO"
    >();
  });
});

describe("holidayCalendarFor", () => {
  it("maps NFO and BFO to the NSE and BSE holiday calendars and keeps CDS separate", () => {
    expect(holidayCalendarFor("NFO")).toBe("NSE");
    expect(holidayCalendarFor("BFO")).toBe("BSE");
    expect(holidayCalendarFor("CDS")).toBe("CDS");
    expect(holidayCalendarFor("NSE")).toBe("NSE");
    expect(holidayCalendarFor("BSE")).toBe("BSE");
    expect(holidayCalendarFor("MCX")).toBe("MCX");
    expect(new Set(EXCHANGES.map((exchange) => holidayCalendarFor(exchange)))).toEqual(
      new Set(["NSE", "BSE", "MCX", "CDS"]),
    );
    expectTypeOf(holidayCalendarFor("NFO")).toEqualTypeOf<HolidayCalendar>();
    expectTypeOf<HolidayCalendar>().toEqualTypeOf<"NSE" | "BSE" | "MCX" | "CDS">();
  });

  it("gives every segment token's exchange a calendar", () => {
    const calendars = SEGMENT_TOKENS.map((token) => [token, holidayCalendarFor(SEGMENT_TOKEN_INFO[token].exchange)]);

    expect(Object.fromEntries(calendars)).toEqual({
      NSE_EQ: "NSE",
      NSE_INDEX: "NSE",
      NSE_FO: "NSE",
      NSE_CD: "CDS",
      BSE_EQ: "BSE",
      BSE_INDEX: "BSE",
      BSE_FO: "BSE",
      MCX_FO: "MCX",
    });
  });

  it("rejects a value that is not an exchange", () => {
    expect(() => holidayCalendarFor("NYSE" as Exchange)).toThrow(/^Unknown exchange: "NYSE"$/);
    expect(() => holidayCalendarFor("toString" as Exchange)).toThrow(RangeError);
  });
});
