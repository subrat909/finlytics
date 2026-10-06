import { describe, expect, it } from "vitest";

import {
  CandleBarSchema,
  CandlesQuerySchema,
  CandleTimeSchema,
  UdfHistoryQuerySchema,
  UdfHistorySchema,
  UdfSearchQuerySchema,
} from "../schemas/candles";

describe("CandleTimeSchema", () => {
  it("reads epoch seconds and ISO date-times with an offset", () => {
    expect(CandleTimeSchema.parse("1759700000").getTime()).toBe(1_759_700_000_000);
    expect(CandleTimeSchema.parse("2026-10-06T09:15:00+05:30").toISOString()).toBe("2026-10-06T03:45:00.000Z");
  });

  it("rejects other formats and dates outside 2000–2099", () => {
    expect(CandleTimeSchema.safeParse("yesterday").success).toBe(false);
    expect(CandleTimeSchema.safeParse("2026-10-06").success).toBe(false);
    expect(CandleTimeSchema.safeParse("100").success).toBe(false);
    expect(CandleTimeSchema.safeParse("4200000000").success).toBe(false);
  });
});

describe("CandlesQuerySchema", () => {
  const base = { key: "NSE_EQ|RELIANCE", tf: "M1", from: "1759700000", to: "1759703600" };

  it("accepts a valid range", () => {
    const query = CandlesQuerySchema.parse(base);
    expect(query.tf).toBe("M1");
    expect(query.to.getTime() - query.from.getTime()).toBe(3_600_000);
  });

  it("rejects an empty or reversed range", () => {
    expect(CandlesQuerySchema.safeParse({ ...base, to: base.from }).success).toBe(false);
  });

  it("rejects a range of more than 5000 bars", () => {
    const result = CandlesQuerySchema.safeParse({ ...base, to: String(1_759_700_000 + 5_001 * 60) });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys and timeframes", () => {
    expect(CandlesQuerySchema.safeParse({ ...base, key: "bad" }).success).toBe(false);
    expect(CandlesQuerySchema.safeParse({ ...base, tf: "M3" }).success).toBe(false);
  });
});

describe("CandleBarSchema", () => {
  it("accepts a bar with decimal-string prices", () => {
    expect(
      CandleBarSchema.safeParse({ ts: 0, open: "1", high: "2", low: "0.5", close: "1.5", volume: 3 }).success,
    ).toBe(true);
  });
});

describe("UDF schemas", () => {
  it("coerces history query numbers and maps known resolutions", () => {
    const query = UdfHistoryQuerySchema.parse({
      symbol: "NSE_EQ|RELIANCE",
      resolution: "1D",
      from: "1",
      to: "2",
      countback: "300",
    });
    expect(query).toMatchObject({ resolution: "1D", from: 1, to: 2, countback: 300 });
    expect(
      UdfHistoryQuerySchema.safeParse({ symbol: "NSE_EQ|RELIANCE", resolution: "3", from: 1, to: 2 }).success,
    ).toBe(false);
  });

  it("defaults the search query", () => {
    expect(UdfSearchQuerySchema.parse({})).toEqual({ query: "", limit: 20 });
  });

  it("accepts ok and no_data history answers", () => {
    expect(UdfHistorySchema.safeParse({ s: "no_data" }).success).toBe(true);
    expect(UdfHistorySchema.safeParse({ s: "ok", t: [1], o: [1], h: [1], l: [1], c: [1], v: [0] }).success).toBe(true);
    expect(UdfHistorySchema.safeParse({ s: "ok", t: [1], o: [1] }).success).toBe(false);
  });
});
