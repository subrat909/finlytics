import { describe, expect, it } from "vitest";

import {
  InstrumentSchema,
  InstrumentSearchQuerySchema,
  InstrumentSyncRequestSchema,
  InstrumentSyncResultSchema,
} from "../schemas/instruments";
import { quoteFromHash, QuoteSchema, QuotesQuerySchema, QuotesResultSchema } from "../schemas/quotes";
import {
  AddWatchlistItemSchema,
  CreateWatchlistSchema,
  ReorderWatchlistItemsSchema,
  UpdateWatchlistSchema,
  WatchlistNameSchema,
  WatchlistSchema,
} from "../schemas/watchlists";

const INSTRUMENT = {
  key: "NSE_FO|NIFTY|2026-10-13|25000|CE",
  exchange: "NFO",
  segment: "OPT",
  symbol: "NIFTY",
  tradingSymbol: "NIFTY26O1325000CE",
  name: "NIFTY 13 OCT 2026 25000 CE",
  expiry: "2026-10-13",
  strike: "25000",
  optionType: "CE",
  lotSize: 65,
  tickSize: "0.05",
  isActive: true,
} as const;

describe("instrument schemas", () => {
  it("defaults the limit to 20 and caps it at 50", () => {
    expect(InstrumentSearchQuerySchema.parse({ q: " nifty " })).toEqual({ q: "nifty", limit: 20 });
    expect(InstrumentSearchQuerySchema.parse({ q: "x", limit: "50", exchange: "NSE", segment: "EQ" })).toEqual({
      q: "x",
      limit: 50,
      exchange: "NSE",
      segment: "EQ",
    });
    for (const bad of [{ q: "" }, { q: "x".repeat(65) }, { q: "x", limit: "51" }, { q: "x", limit: "abc" }]) {
      expect(InstrumentSearchQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("describes an instrument with decimal strings and nullable derivative fields", () => {
    expect(InstrumentSchema.parse(INSTRUMENT)).toEqual(INSTRUMENT);
    expect(
      InstrumentSchema.safeParse({ ...INSTRUMENT, expiry: null, strike: null, optionType: null, tradingSymbol: null })
        .success,
    ).toBe(true);
    expect(InstrumentSchema.safeParse({ ...INSTRUMENT, strike: 25000 }).success).toBe(false);
  });

  it("takes an optional broker for a sync and lists the queued jobs", () => {
    expect(InstrumentSyncRequestSchema.parse({})).toEqual({});
    expect(InstrumentSyncRequestSchema.safeParse({ broker: "NOPE" }).success).toBe(false);
    expect(InstrumentSyncResultSchema.parse({ jobs: [{ broker: "UPSTOX", jobId: "manual:UPSTOX:1" }] })).toEqual({
      jobs: [{ broker: "UPSTOX", jobId: "manual:UPSTOX:1" }],
    });
  });
});

describe("watchlist schemas", () => {
  it("validates names as one line of plain text", () => {
    expect(WatchlistNameSchema.parse("  Swing  ")).toBe("Swing");
    expect(WatchlistNameSchema.safeParse("<script>").success).toBe(false);
    expect(CreateWatchlistSchema.safeParse({ name: "A", extra: 1 }).success).toBe(false);
  });

  it("needs a field in a patch and a non-negative position", () => {
    expect(UpdateWatchlistSchema.safeParse({}).success).toBe(false);
    expect(UpdateWatchlistSchema.parse({ position: 0 })).toEqual({ position: 0 });
    expect(UpdateWatchlistSchema.safeParse({ position: -1 }).success).toBe(false);
  });

  it("takes canonical keys and distinct item ids", () => {
    expect(AddWatchlistItemSchema.safeParse({ instrumentKey: "NSE_EQ|RELIANCE" }).success).toBe(true);
    expect(AddWatchlistItemSchema.safeParse({ instrumentKey: "nse_eq|reliance" }).success).toBe(false);
    expect(ReorderWatchlistItemsSchema.safeParse({ itemIds: ["a", "b"] }).success).toBe(true);
    expect(ReorderWatchlistItemsSchema.safeParse({ itemIds: ["a", "a"] }).success).toBe(false);
    expect(ReorderWatchlistItemsSchema.safeParse({ itemIds: [] }).success).toBe(false);
  });

  it("describes a list with its items", () => {
    const list = {
      id: "w1",
      name: "Main",
      position: 0,
      items: [{ id: "i1", instrumentKey: INSTRUMENT.key, position: 0, instrument: INSTRUMENT }],
    };
    expect(WatchlistSchema.parse(list)).toEqual(list);
  });
});

describe("quote schemas", () => {
  it("reads a feed hash, leaving out invalid optional fields", () => {
    expect(
      quoteFromHash({
        ltp: "24012.5",
        close: "23950",
        chg: "62.5",
        chgPct: "0.26096033",
        vol: "1200",
        oi: "",
        bid: "abc",
        ask: "24013",
        ts: "1791273600000",
      }),
    ).toEqual({
      ltp: "24012.5",
      close: "23950",
      chg: "62.5",
      chgPct: "0.26096033",
      vol: "1200",
      ask: "24013",
      ts: 1_791_273_600_000,
    });
  });

  it("drops a hash without a valid ltp or ts", () => {
    expect(quoteFromHash({})).toBeUndefined();
    expect(quoteFromHash({ ltp: "1", ts: "x" })).toBeUndefined();
    expect(quoteFromHash({ ltp: "1e5", ts: "1" })).toBeUndefined();
    expect(quoteFromHash({ ltp: "1", ts: "99999999999999999" })).toBeUndefined();
  });

  it("splits, validates and de-duplicates the keys parameter", () => {
    expect(QuotesQuerySchema.parse({ keys: "NSE_EQ|RELIANCE, NSE_INDEX|NIFTY 50,NSE_EQ|RELIANCE," })).toEqual({
      keys: ["NSE_EQ|RELIANCE", "NSE_INDEX|NIFTY 50"],
    });
    expect(QuotesQuerySchema.safeParse({ keys: "" }).success).toBe(false);
    expect(QuotesQuerySchema.safeParse({ keys: "NSE_EQ|RELIANCE,bad" }).success).toBe(false);
    const tooMany = Array.from({ length: 51 }, (_, index) => `NSE_EQ|S${String(index)}`).join(",");
    expect(QuotesQuerySchema.safeParse({ keys: tooMany }).success).toBe(false);
  });

  it("describes the result as a record of quotes", () => {
    expect(QuotesResultSchema.parse({ "NSE_EQ|INFY": { ltp: "1500", ts: 1 } })).toEqual({
      "NSE_EQ|INFY": { ltp: "1500", ts: 1 },
    });
    expect(QuoteSchema.safeParse({ ltp: "1", ts: 1, extra: "x" }).success).toBe(false);
  });
});
