import type { HoldingView, InstrumentKey, PositionView } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import {
  brokerClose,
  compareHoldings,
  comparePositions,
  instrumentColumns,
  toHoldingView,
  unrealisedPnl,
  wirePrice,
} from "../portfolio.mapper";

const key = (text: string) => text as InstrumentKey;

describe("instrumentColumns", () => {
  it("uses the exchange's trading symbol and our instrument's name and lot size", () => {
    expect(
      instrumentColumns(key("NSE_FO|NIFTY|2026-10-27|25000|CE"), {
        key: "NSE_FO|NIFTY|2026-10-27|25000|CE",
        exchange: "NFO",
        segment: "OPT",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY26OCT25000CE",
        name: "",
        lotSize: 0,
      }),
    ).toEqual({
      instrumentKey: "NSE_FO|NIFTY|2026-10-27|25000|CE",
      symbol: "NIFTY26OCT25000CE",
      name: null,
      exchange: "NFO",
      segment: "OPT",
      lotSize: null,
    });
  });

  it("reads exchange, segment and a readable symbol from a key we have no instrument for", () => {
    expect(instrumentColumns(key("BSE_EQ|ACME"), undefined)).toMatchObject({
      symbol: "ACME",
      exchange: "BSE",
      segment: "EQ",
      name: null,
      lotSize: null,
    });
    expect(instrumentColumns(key("MCX_FO|CRUDEOIL|2026-10-19"), undefined)).toMatchObject({
      symbol: "CRUDEOIL 2026-10-19 FUT",
      exchange: "MCX",
      segment: "FUT",
    });
    expect(instrumentColumns(key("NSE_FO|BANKNIFTY|2026-10-28|55000.5|PE"), undefined).symbol).toBe(
      "BANKNIFTY 2026-10-28 55000.5 PE",
    );
    expect(instrumentColumns(key("not a key"), undefined)).toEqual({
      instrumentKey: "not a key",
      symbol: "not a key",
      name: null,
      exchange: null,
      segment: null,
      lotSize: null,
    });
  });

  it("keeps symbols within 64 characters", () => {
    const long = `NSE_FO|${"A".repeat(60)}|2026-10-28|55000|PE`;
    expect(instrumentColumns(key(long), undefined).symbol).toHaveLength(64);
  });
});

describe("prices", () => {
  it("rounds cached prices to the wire's 4 decimals and drops unusable ones", () => {
    expect(wirePrice("3500.123456")).toBe("3500.1235");
    expect(wirePrice("100.50")).toBe("100.5");
    expect(wirePrice(undefined)).toBeNull();
    expect(wirePrice("-1")).toBeNull();
    expect(wirePrice("abc")).toBeNull();
    expect(wirePrice("123456789012345")).toBeNull();
  });

  it("computes unrealised P&L for long, short and closed positions", () => {
    const avg = { buyAvg: "100", sellAvg: "120" };
    expect(unrealisedPnl({ ...avg, netQty: 10 }, "105.5")).toBe("55");
    expect(unrealisedPnl({ ...avg, netQty: -10 }, "110")).toBe("100");
    expect(unrealisedPnl({ ...avg, netQty: 0 }, null)).toBe("0");
    expect(unrealisedPnl({ ...avg, netQty: 5 }, null)).toBeNull();
    expect(unrealisedPnl({ buyAvg: "0", sellAvg: "0", netQty: 2_000_000_000 }, "99999999")).toBeNull();
  });

  it("prefers the broker's holding close to the cached one", () => {
    const holding = { instrumentKey: key("NSE_EQ|INFY"), qty: 1, avgPrice: "10", close: "12" };
    expect(brokerClose(holding)).toBe("12");
    expect(toHoldingView(holding, undefined, { ltp: "13", close: "11" })).toMatchObject({ ltp: "13", close: "12" });
    expect(toHoldingView({ ...holding, close: undefined }, undefined, undefined)).toMatchObject({
      ltp: null,
      close: null,
      t1Qty: 0,
    });
  });
});

describe("ordering", () => {
  const position = (symbol: string, netQty: number, product: PositionView["product"] = "INTRADAY") =>
    ({ symbol, netQty, product }) as PositionView;
  const holding = (symbol: string, qty: number, ltp: string | null, avgPrice = "1") =>
    ({ symbol, qty, t1Qty: 0, ltp, avgPrice }) as HoldingView;

  it("puts open positions first, then sorts by symbol and product", () => {
    const sorted = [position("B", 0), position("C", 5, "MARGIN"), position("C", -1, "DELIVERY"), position("A", 0)].sort(
      comparePositions,
    );

    expect(sorted.map((row) => `${row.symbol}:${row.product}`)).toEqual([
      "C:DELIVERY",
      "C:MARGIN",
      "A:INTRADAY",
      "B:INTRADAY",
    ]);
  });

  it("sorts holdings by value, valuing a holding without a price at its average", () => {
    const sorted = [holding("SMALL", 1, "10"), holding("NOPRICE", 10, null, "50"), holding("BIG", 100, "10")].sort(
      compareHoldings,
    );

    expect(sorted.map((row) => row.symbol)).toEqual(["BIG", "NOPRICE", "SMALL"]);
    expect([holding("B", 1, "1"), holding("A", 1, "1")].sort(compareHoldings).map((row) => row.symbol)).toEqual([
      "A",
      "B",
    ]);
  });
});
