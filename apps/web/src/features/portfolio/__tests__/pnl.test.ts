import { describe, expect, it } from "vitest";

import { formatDuration, formatIstTime, formatMoney, formatMoneyCompact, moneyDirection } from "../lib/format";
import {
  dayChangePct,
  holdingMetrics,
  marginUsage,
  positionPnl,
  positionPrevClose,
  positionSide,
  priceDecimal,
  summariseHoldings,
  summarisePositions,
} from "../lib/pnl";

const LONG = {
  instrumentKey: "NSE_EQ|RELIANCE",
  netQty: 50,
  buyQty: 50,
  sellQty: 0,
  buyAvg: "2900.5",
  sellAvg: "0",
  realisedPnl: "0",
  ltp: "2910",
  unrealisedPnl: "475",
};
const SHORT = {
  instrumentKey: "NSE_FO|NIFTY|2026-10-27|24000|CE",
  netQty: -75,
  buyQty: 0,
  sellQty: 75,
  buyAvg: "0",
  sellAvg: "120.25",
  realisedPnl: "0",
  ltp: "110",
  unrealisedPnl: "768.75",
};
const CLOSED = {
  instrumentKey: "NSE_EQ|INFY",
  netQty: 0,
  buyQty: 10,
  sellQty: 10,
  buyAvg: "1500",
  sellAvg: "1512.4",
  realisedPnl: "124",
  ltp: "1510",
  unrealisedPnl: "0",
};

describe("positionPnl", () => {
  it("prices a long at the live tick against the buy average", () => {
    const pnl = positionPnl(LONG, 2920.25);
    expect(pnl.side).toBe("long");
    expect(pnl.live).toBe(true);
    expect(pnl.unrealised?.toString()).toBe("987.5");
    expect(pnl.total?.toString()).toBe("987.5");
    expect(pnl.returnPct).toBeCloseTo((987.5 / (2900.5 * 50)) * 100, 6);
  });

  it("prices a short against the sell average, so a falling price is a profit", () => {
    const pnl = positionPnl(SHORT, 100.05);
    expect(pnl.side).toBe("short");
    expect(pnl.avg.toString()).toBe("120.25");
    expect(pnl.unrealised?.toString()).toBe("1515");
    expect(positionPnl(SHORT, 130).unrealised?.toString()).toBe("-731.25");
  });

  it("falls back to the broker's last price without a tick", () => {
    const pnl = positionPnl(LONG);
    expect(pnl.live).toBe(false);
    expect(pnl.unrealised?.toString()).toBe("475");
  });

  it("falls back to the broker's unrealised figure without any price, and to null without that", () => {
    expect(positionPnl({ ...LONG, ltp: null }).unrealised?.toString()).toBe("475");
    const unknown = positionPnl({ ...LONG, ltp: null, unrealisedPnl: null });
    expect(unknown.unrealised).toBeNull();
    expect(unknown.total).toBeNull();
    expect(unknown.returnPct).toBeNull();
  });

  it("counts only the realised P&L of a closed position", () => {
    const pnl = positionPnl(CLOSED, 1600);
    expect(pnl.side).toBe("flat");
    expect(pnl.unrealised?.toString()).toBe("0");
    expect(pnl.total?.toString()).toBe("124");
    expect(pnl.returnPct).toBeNull();
  });

  it("ignores a non-finite tick", () => {
    expect(positionPnl(LONG, Number.NaN).live).toBe(false);
    expect(priceDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(positionSide(0)).toBe("flat");
  });
});

describe("previous close", () => {
  it("reads a position's close when the api sends one, and computes the day's move from it", () => {
    expect(positionPrevClose({ ...LONG, close: "2890" })).toBe("2890");
    expect(positionPrevClose(LONG)).toBeNull();
    expect(positionPrevClose({ ...LONG, close: null })).toBeNull();
    expect(dayChangePct(priceDecimal("2910"), priceDecimal("2900"))).toBeCloseTo((10 / 2900) * 100, 8);
    expect(dayChangePct(priceDecimal("2910"), null)).toBeNull();
  });
});

describe("summarisePositions", () => {
  it("adds realised and live unrealised P&L into the day's P&L", () => {
    const live = new Map([
      ["NSE_EQ|RELIANCE", 2920.5],
      ["NSE_FO|NIFTY|2026-10-27|24000|CE", 100.25],
    ]);
    const summary = summarisePositions([LONG, SHORT, CLOSED], (key) => live.get(key));
    // long (2920.5 − 2900.5) × 50 = 1000; short (120.25 − 100.25) × 75 = 1500; closed realised 124.
    expect(summary.unrealised.toString()).toBe("2500");
    expect(summary.realised.toString()).toBe("124");
    expect(summary.total.toString()).toBe("2624");
    expect(summary).toMatchObject({ open: 2, closed: 1, long: 1, short: 1, unpriced: 0 });
  });

  it("counts open positions it can't price", () => {
    const summary = summarisePositions([{ ...LONG, ltp: null, unrealisedPnl: null }], () => undefined);
    expect(summary.unpriced).toBe(1);
    expect(summary.total.toString()).toBe("0");
  });
});

const HOLDING = {
  instrumentKey: "NSE_EQ|TCS",
  qty: 8,
  t1Qty: 2,
  avgPrice: "3500",
  ltp: "3600",
  close: "3550",
};

describe("holdings", () => {
  it("values settled and T1 quantity at the live price, with the day's change from the previous close", () => {
    const metrics = holdingMetrics(HOLDING, { ltp: 3650, prevClose: 3540 });
    expect(metrics.qty).toBe(10);
    expect(metrics.invested.toString()).toBe("35000");
    expect(metrics.current?.toString()).toBe("36500");
    expect(metrics.pnl?.toString()).toBe("1500");
    expect(metrics.pnlPct).toBeCloseTo(4.2857, 3);
    // The api's close wins over the tick's derived one.
    expect(metrics.dayChange?.toString()).toBe("1000");
    expect(metrics.dayChangePct).toBeCloseTo((100 / 3550) * 100, 6);
  });

  it("uses the tick's previous close when the api has none, and nothing without prices", () => {
    expect(holdingMetrics({ ...HOLDING, close: null }, { ltp: 3650, prevClose: 3600 }).dayChange?.toString()).toBe(
      "500",
    );
    const unpriced = holdingMetrics({ ...HOLDING, ltp: null, close: null });
    expect(unpriced.current).toBeNull();
    expect(unpriced.dayChange).toBeNull();
  });

  it("summarises invested, current, P&L and the day's change; unpriced holdings count at cost", () => {
    const summary = summariseHoldings(
      [HOLDING, { ...HOLDING, instrumentKey: "NSE_EQ|INFY", ltp: null, close: null, avgPrice: "1000" }],
      (key) => (key === "NSE_EQ|TCS" ? { ltp: 3650 } : undefined),
    );
    expect(summary.invested.toString()).toBe("45000");
    expect(summary.current.toString()).toBe("46500");
    expect(summary.pnl.toString()).toBe("1500");
    expect(summary.dayChange.toString()).toBe("1000");
    expect(summary.dayChangePct).toBeCloseTo((1000 / 45500) * 100, 6);
    expect(summary.unpriced).toBe(1);
  });

  it("has no percentages for an empty portfolio", () => {
    const summary = summariseHoldings([], () => undefined);
    expect(summary.pnlPct).toBeNull();
    expect(summary.dayChangePct).toBeNull();
  });
});

describe("marginUsage", () => {
  it("is used over used + available", () => {
    expect(marginUsage({ usedMargin: "25000", availableMargin: "75000" })).toBe(0.25);
  });

  it("treats a negative available margin as none, and no margin as unknown", () => {
    expect(marginUsage({ usedMargin: "1000", availableMargin: "-50" })).toBe(1);
    expect(marginUsage({ usedMargin: "0", availableMargin: "0" })).toBeNull();
  });
});

describe("format", () => {
  it("formats money, signed and compact, with a direction after rounding", () => {
    expect(formatMoney("1234.5")).toBe("₹1,234.50");
    expect(formatMoney("1234.5", { signed: true })).toBe("+₹1,234.50");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoneyCompact("123456.78")).toBe("₹1.23 L");
    expect(moneyDirection("-0.004")).toBe("flat");
    expect(moneyDirection("-12")).toBe("down");
    expect(moneyDirection("0.5")).toBe("up");
    expect(moneyDirection(null)).toBe("flat");
  });

  it("formats IST clock times and countdowns", () => {
    expect(formatIstTime("2026-10-06T05:02:09.000Z")).toBe("10:32:09 IST");
    expect(formatIstTime("nope")).toBe("—");
    expect(formatDuration(5 * 3_600_000 + 12 * 60_000)).toBe("5h 12m");
    expect(formatDuration(42 * 60_000)).toBe("42m");
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
    expect(formatDuration(-5)).toBe("0m");
  });
});
