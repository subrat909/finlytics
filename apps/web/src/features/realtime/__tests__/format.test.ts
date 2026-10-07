import { describe, expect, it } from "vitest";

import {
  NO_VALUE,
  directionOf,
  formatChange,
  formatIstDate,
  formatIstDateTime,
  formatIstTime,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatQuantityCompact,
} from "../format";
import {
  depthRejectText,
  mergeTick,
  parseDepth,
  parseQuoteBatch,
  parseStatus,
  quoteToTick,
  rejectReasonText,
} from "../schemas";
import type { Depth, Tick } from "../schemas";
import { isStale, marketActions, useMarketStore } from "../store";

describe("live number formatting", () => {
  it("formats prices with Indian grouping and no rupee sign", () => {
    expect(formatPrice(2401235.5)).toBe("24,01,235.50");
    expect(formatPrice(undefined)).toBe(NO_VALUE);
    expect(formatPrice(Number.NaN)).toBe(NO_VALUE);
  });

  it("signs changes and percentages, never printing -0.00", () => {
    expect(formatChange(120.5)).toBe("+120.50");
    expect(formatChange(-3.05)).toBe("-3.05");
    expect(formatChange(-0.001)).toBe("0.00");
    expect(formatPercent(0.523)).toBe("+0.52%");
    expect(formatPercent(-1.1)).toBe("-1.10%");
    expect(formatPercent(null)).toBe(NO_VALUE);
    expect(formatChange(null)).toBe(NO_VALUE);
  });

  it("formats volume compactly in lakh and crore", () => {
    expect(formatQuantityCompact(1_234_567)).toBe("12.3 L");
    expect(formatQuantityCompact(null)).toBe(NO_VALUE);
  });

  it("formats whole quantities with Indian grouping", () => {
    expect(formatQuantity(1_234_567)).toBe("12,34,567");
    expect(formatQuantity(75.4)).toBe("75");
    expect(formatQuantity(undefined)).toBe(NO_VALUE);
  });

  it("formats a tick's time in IST", () => {
    expect(formatIstTime(Date.UTC(2026, 9, 6, 9, 59, 59))).toBe("15:29:59");
    expect(formatIstTime(Number.NaN)).toBe(NO_VALUE);
  });

  it("reads the direction from the rounded change", () => {
    expect(directionOf(0.5)).toBe("up");
    expect(directionOf(-0.5)).toBe("down");
    expect(directionOf(0.001)).toBe("flat");
    expect(directionOf(undefined)).toBe("flat");
  });

  it("formats dates in IST whatever the device zone", () => {
    expect(formatIstDateTime("2026-10-06T22:00:00.000Z")).toBe("7 Oct 2026, 03:30 IST");
    expect(formatIstDate(Date.UTC(2026, 9, 6, 22, 0))).toBe("7 Oct 2026");
    expect(formatIstDateTime(new Date(Date.UTC(2026, 0, 1)))).toBe("1 Jan 2026, 05:30 IST");
    expect(formatIstDateTime("not a date")).toBe(NO_VALUE);
    expect(formatIstDate("not a date")).toBe(NO_VALUE);
  });
});

describe("realtime messages", () => {
  it("turns quotes into ticks aged by their own timestamp, with the day statistics", () => {
    expect(
      quoteToTick({
        ltp: "101.5",
        chg: "-1.5",
        chgPct: "-1.46",
        vol: "2500",
        ts: 5,
        open: "102",
        high: "103.25",
        low: "100",
        close: "103",
        oi: "1200",
        atp: "101.75",
      }),
    ).toEqual({
      ltp: 101.5,
      chg: -1.5,
      chgPct: -1.46,
      vol: 2500,
      ts: 5,
      receivedAt: 5,
      open: 102,
      high: 103.25,
      low: 100,
      close: 103,
      oi: 1200,
      atp: 101.75,
    });
    expect(quoteToTick({ ltp: "1", ts: 9 })).toMatchObject({
      chg: 0,
      chgPct: 0,
      vol: null,
      open: null,
      high: null,
      low: null,
      close: null,
      oi: null,
      atp: null,
    });
  });

  it("reads 12-field quote rows, nulls included, and pads six-field ones", () => {
    const [[key, tick] = ["", undefined]] = parseQuoteBatch(
      { t: 1, d: [["NSE_EQ|INFY", "1500", "-3.5", "-0.23", 10, 2, "1501", null, "1490", "1503.5", null, "1499.1"]] },
      7,
    );
    expect(key).toBe("NSE_EQ|INFY");
    expect(tick).toEqual({
      ltp: 1500,
      chg: -3.5,
      chgPct: -0.23,
      vol: 10,
      ts: 2,
      receivedAt: 7,
      open: 1501,
      high: null,
      low: 1490,
      close: 1503.5,
      oi: null,
      atp: 1499.1,
    });
    expect(parseQuoteBatch({ t: 1, d: [["NSE_EQ|INFY", "1", "0", "0", 0, 2]] }, 0)[0]?.[1]).toMatchObject({
      open: null,
      atp: null,
    });
    // Too short, or a bad tail value: skipped.
    expect(parseQuoteBatch({ t: 1, d: [["NSE_EQ|INFY", "1", "0", "0", 0]] }, 0)).toEqual([]);
    expect(
      parseQuoteBatch({ t: 1, d: [["NSE_EQ|INFY", "1", "0", "0", 0, 2, "x", null, null, null, null, null]] }, 0),
    ).toEqual([]);
  });

  it("keeps day statistics a newer tick doesn't carry", () => {
    const previous: Tick = { ltp: 1, chg: 0, chgPct: 0, vol: 1, ts: 1, receivedAt: 1, open: 9, high: 12, oi: 4 };
    const next: Tick = { ltp: 2, chg: 1, chgPct: 1, vol: 2, ts: 2, receivedAt: 2, open: null, high: 13 };
    expect(mergeTick(next, previous)).toMatchObject({ ltp: 2, open: 9, high: 13, low: null, oi: 4, atp: null });
    expect(mergeTick(next, undefined)).toBe(next);
    const complete: Tick = { ...next, open: 1, low: 1, close: 1, oi: 1, atp: 1 };
    expect(mergeTick(complete, previous)).toBe(complete);
  });

  it("reads depth and status messages", () => {
    expect(parseDepth({ k: "NSE_EQ|INFY", t: 3, bids: [["1500", 10, 2]], asks: [], tbq: null, tsq: 40 }, 9)).toEqual([
      "NSE_EQ|INFY",
      { t: 3, bids: [{ price: 1500, qty: 10, orders: 2 }], asks: [], tbq: null, tsq: 40, receivedAt: 9 },
    ]);
    expect(parseDepth({ k: "NSE_EQ|INFY", t: 3, bids: [["-1", 10, 2]], asks: [], tbq: null, tsq: null }, 9)).toBe(
      undefined,
    );
    expect(parseStatus({ feed: "up", source: "DHAN", live: true })).toEqual({
      feed: "up",
      source: { source: "DHAN", live: true },
    });
    expect(parseStatus({ feed: "down" })).toEqual({ feed: "down", source: undefined });
    expect(parseStatus({ feed: "up", source: "NSE", live: true })).toBeUndefined();
    expect(parseStatus("up")).toBeUndefined();
  });

  it("explains refused keys", () => {
    expect(rejectReasonText("limit")).toBe("your plan's live-price limit is reached");
    expect(rejectReasonText("something new")).toBe("not available");
    expect(depthRejectText("limit")).toMatch(/too many market depth panels/);
    expect(depthRejectText("unavailable")).toBe("the live service is busy");
  });

  it("parses only well-formed rows", () => {
    expect(parseQuoteBatch({ t: 1, d: [] }, 0)).toEqual([]);
    expect(parseQuoteBatch(null, 0)).toEqual([]);
  });
});

describe("market store", () => {
  it("never lets an older REST quote overwrite a newer tick", () => {
    marketActions.reset();
    const tick = { ltp: 2, chg: 0, chgPct: 0, vol: null, ts: 200, receivedAt: 200 };
    marketActions.applyTicks(new Map([["K", tick]]));
    marketActions.seedTicks(new Map([["K", { ...tick, ltp: 1, ts: 100 }]]));
    expect(useMarketStore.getState().ticks.get("K")?.ltp).toBe(2);
    marketActions.seedTicks(new Map([["K", { ...tick, ltp: 3, ts: 300 }]]));
    expect(useMarketStore.getState().ticks.get("K")?.ltp).toBe(3);
  });

  it("forgets released keys and their refusals", () => {
    marketActions.reset();
    marketActions.applyTicks(new Map([["K", { ltp: 1, chg: 0, chgPct: 0, vol: null, ts: 1, receivedAt: 1 }]]));
    marketActions.setRejected([{ key: "R", reason: "limit" }]);
    const before = useMarketStore.getState();
    marketActions.forget(["unknown"]);
    expect(useMarketStore.getState()).toBe(before);
    marketActions.forget(["K", "R"]);
    expect(useMarketStore.getState().ticks.size).toBe(0);
    expect(useMarketStore.getState().rejected.size).toBe(0);
  });

  it("calls a tick stale after five seconds", () => {
    const tick = { ltp: 1, chg: 0, chgPct: 0, vol: null, ts: 0, receivedAt: 10_000 };
    expect(isStale(tick, 15_000)).toBe(false);
    expect(isStale(tick, 15_001)).toBe(true);
    expect(isStale(undefined, 15_001)).toBe(false);
  });
});

function depth(t: number, price = 100): Depth {
  return { t, bids: [{ price, qty: 1, orders: 1 }], asks: [], tbq: null, tsq: null, receivedAt: t };
}

describe("market store depth and source", () => {
  it("applies ticks and depth from one flush in one update", () => {
    marketActions.reset();
    const updates: unknown[] = [];
    const unsubscribe = useMarketStore.subscribe((state) => updates.push(state));
    marketActions.applyBatch(
      new Map([["K", { ltp: 1, chg: 0, chgPct: 0, vol: null, ts: 1, receivedAt: 1 }]]),
      new Map([["K", depth(1)]]),
    );
    marketActions.applyBatch(new Map(), new Map());
    unsubscribe();
    expect(updates).toHaveLength(1);
    expect(useMarketStore.getState().depth.get("K")?.bids[0]?.price).toBe(100);
  });

  it("never lets an older depth snapshot overwrite a newer book, and forgets books nothing shows", () => {
    marketActions.reset();
    marketActions.applyDepth(new Map([["K", depth(200)]]));
    marketActions.seedDepth("K", depth(100, 1));
    expect(useMarketStore.getState().depth.get("K")?.t).toBe(200);
    marketActions.seedDepth("K", depth(300, 3));
    expect(useMarketStore.getState().depth.get("K")?.bids[0]?.price).toBe(3);
    marketActions.setDepthRejected("R", "limit");
    marketActions.setDepthRejected("R", "limit");
    const before = useMarketStore.getState();
    marketActions.forgetDepthExcept(new Set(["K", "R"]));
    expect(useMarketStore.getState()).toBe(before);
    marketActions.forgetDepthExcept(new Set());
    expect(useMarketStore.getState().depth.size).toBe(0);
    expect(useMarketStore.getState().depthRejected.size).toBe(0);
    marketActions.setDepthRejected("R", "limit");
    marketActions.setDepthRejected("R", undefined);
    expect(useMarketStore.getState().depthRejected.size).toBe(0);
    marketActions.setDepthRejected("R", "limit");
    marketActions.clearDepthRejected();
    expect(useMarketStore.getState().depthRejected.size).toBe(0);
  });

  it("keeps the feed source's identity while it doesn't change", () => {
    marketActions.reset();
    marketActions.setSource({ source: "PAPER", live: false });
    const first = useMarketStore.getState().source;
    marketActions.setSource({ source: "PAPER", live: false });
    expect(useMarketStore.getState().source).toBe(first);
    marketActions.setSource({ source: "UPSTOX", live: true });
    expect(useMarketStore.getState().source).toEqual({ source: "UPSTOX", live: true });
    marketActions.setSource(undefined);
    expect(useMarketStore.getState().source).toBeUndefined();
  });
});
