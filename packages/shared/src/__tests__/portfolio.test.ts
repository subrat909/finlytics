import { describe, expect, it } from "vitest";

import {
  FundsViewSchema,
  HoldingsViewSchema,
  HoldingViewSchema,
  PortfolioQuerySchema,
  PositionsViewSchema,
  PositionViewSchema,
} from "../schemas/portfolio";

const STAMP = { accountId: "cabc123", broker: "DHAN", asOf: "2026-10-06T05:00:00.000Z" } as const;

const INSTRUMENT = {
  instrumentKey: "NSE_FO|NIFTY|2026-10-27|25000|CE",
  symbol: "NIFTY26OCT25000CE",
  name: "NIFTY 27 OCT 25000 CE",
  exchange: "NFO",
  segment: "OPT",
  lotSize: 75,
} as const;

const POSITION = {
  ...INSTRUMENT,
  product: "MARGIN",
  netQty: -75,
  buyQty: 0,
  sellQty: 75,
  buyAvg: "0",
  sellAvg: "120.5",
  realisedPnl: "0",
  ltp: "100.25",
  unrealisedPnl: "1518.75",
} as const;

const HOLDING = {
  ...INSTRUMENT,
  instrumentKey: "NSE_EQ|INFY",
  symbol: "INFY",
  exchange: "NSE",
  segment: "EQ",
  lotSize: 1,
  qty: 10,
  t1Qty: 0,
  avgPrice: "1400",
  ltp: null,
  close: "1490",
} as const;

describe("portfolio schemas", () => {
  it("takes an optional account id and nothing else", () => {
    expect(PortfolioQuerySchema.parse({})).toEqual({});
    expect(PortfolioQuerySchema.parse({ accountId: "cabc123" })).toEqual({ accountId: "cabc123" });
    expect(PortfolioQuerySchema.safeParse({ accountId: "../x" }).success).toBe(false);
    expect(PortfolioQuerySchema.safeParse({ account: "cabc123" }).success).toBe(false);
  });

  it("describes funds with decimal strings and a nullable withdrawable amount", () => {
    const funds = { ...STAMP, availableMargin: "1000.5", usedMargin: "-2", collateral: "0", withdrawable: null };
    expect(FundsViewSchema.parse(funds)).toEqual(funds);
    expect(FundsViewSchema.safeParse({ ...funds, availableMargin: 1000 }).success).toBe(false);
    expect(FundsViewSchema.safeParse({ ...funds, asOf: "yesterday" }).success).toBe(false);
  });

  it("describes positions, with instrument columns that may be unknown", () => {
    expect(PositionViewSchema.parse(POSITION)).toEqual(POSITION);
    const unknown = { ...POSITION, name: null, exchange: null, segment: null, lotSize: null, ltp: null };
    expect(PositionsViewSchema.parse({ ...STAMP, positions: [{ ...unknown, unrealisedPnl: null }] })).toBeDefined();
    expect(PositionViewSchema.safeParse({ ...POSITION, buyQty: -1 }).success).toBe(false);
    expect(PositionViewSchema.safeParse({ ...POSITION, ltp: "-1" }).success).toBe(false);
    expect(PositionViewSchema.safeParse({ ...POSITION, symbol: "" }).success).toBe(false);
    expect(PositionViewSchema.safeParse({ ...POSITION, token: "x" }).success).toBe(false);
  });

  it("describes holdings with the previous close", () => {
    expect(HoldingsViewSchema.parse({ ...STAMP, holdings: [HOLDING] })).toEqual({ ...STAMP, holdings: [HOLDING] });
    expect(HoldingViewSchema.safeParse({ ...HOLDING, t1Qty: -1 }).success).toBe(false);
    expect(HoldingViewSchema.safeParse({ ...HOLDING, close: "1.23456" }).success).toBe(false);
  });
});
