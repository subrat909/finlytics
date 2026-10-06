import { describe, expect, it } from "vitest";

import {
  NO_VALUE,
  directionOf,
  formatChange,
  formatIstDate,
  formatIstDateTime,
  formatPercent,
  formatPrice,
  formatQuantityCompact,
} from "../format";
import { parseQuoteBatch, quoteToTick, rejectReasonText } from "../schemas";
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
  it("turns quotes into ticks aged by their own timestamp", () => {
    expect(quoteToTick({ ltp: "101.5", chg: "-1.5", chgPct: "-1.46", vol: "2500", ts: 5 })).toEqual({
      ltp: 101.5,
      chg: -1.5,
      chgPct: -1.46,
      vol: 2500,
      ts: 5,
      receivedAt: 5,
    });
    expect(quoteToTick({ ltp: "1", ts: 9 })).toMatchObject({ chg: 0, chgPct: 0, vol: null });
  });

  it("explains refused keys", () => {
    expect(rejectReasonText("limit")).toBe("your plan's live-price limit is reached");
    expect(rejectReasonText("something new")).toBe("not available");
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
