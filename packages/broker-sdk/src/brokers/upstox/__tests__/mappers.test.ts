import { MARKET_INDEX_KEYS } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { MARKET_INDEX_ALIASES } from "../../../index-aliases";
import { BrokerOrderSchema, InstrumentRowSchema, TickSchema } from "../../../models";
import {
  candleSpec,
  count,
  decimalString,
  fallbackEquityKey,
  fromUpstoxOrderType,
  fromUpstoxProduct,
  fromUpstoxValidity,
  istDate,
  istTimestamp,
  segmentOf,
  toBrokerOrder,
  toCandle,
  toFunds,
  toHolding,
  toInstrumentRow,
  toOrderStatus,
  toPosition,
  toProfile,
  toTick,
  toUpstoxFeedMode,
  toUpstoxOrderType,
  toUpstoxProduct,
  upstoxTokenExpiry,
} from "../mappers";
import { decodeUpstoxFeedResponse } from "../proto";
import {
  UPSTOX_ORDER_STATUSES,
  UpstoxFundsSchema,
  UpstoxHoldingSchema,
  UpstoxInstrumentSchema,
  UpstoxOrderSchema,
  UpstoxPositionSchema,
  UpstoxProfileSchema,
} from "../types";
import type { UpstoxFeed, UpstoxOrder } from "../types";

import { fixture, fixtureBytes } from "./fake-upstox";
import { BANKNIFTY_PE, NIFTY_CE, NIFTY_INDEX, NOW, YESBANK } from "./setup";

const data = (name: string): unknown => (fixture(name) as { data: unknown }).data;
const firstRow = (name: string): unknown => (data(name) as unknown[])[0];
const FCONSUMER = "BSE_EQ|FCONSUMER" as InstrumentKey;

describe("upstoxTokenExpiry", () => {
  it.each([
    ["a morning login ends at 03:30 IST the next day", "2025-10-06T04:00:00.000Z", "2025-10-06T22:00:00.000Z"],
    ["a login between 00:00 and 03:30 IST ends the same day", "2025-10-06T20:30:00.000Z", "2025-10-06T22:00:00.000Z"],
    ["a login at exactly 03:30 IST lasts until the next day", "2025-10-06T22:00:00.000Z", "2025-10-07T22:00:00.000Z"],
    ["a late-evening login ends early next morning", "2025-10-06T18:00:00.000Z", "2025-10-06T22:00:00.000Z"],
  ])("%s", (_name, now, expiry) => {
    expect(upstoxTokenExpiry(new Date(now)).toISOString()).toBe(expiry);
  });
});

describe("time and number helpers", () => {
  it("reads IST dates and Upstox's offset-less IST timestamps", () => {
    expect(istDate(Date.parse("2025-10-06T18:29:59Z"))).toBe("2025-10-06");
    expect(istDate(Date.parse("2025-10-06T18:30:00Z"))).toBe("2025-10-07");
    expect(istTimestamp("2023-10-19 09:23:23")).toBe("2023-10-19T09:23:23+05:30");
    expect(istTimestamp("2023-10-19T09:23:23")).toBe("2023-10-19T09:23:23+05:30");
    for (const value of [null, undefined, "", "19-10-2023 09:23"]) expect(istTimestamp(value)).toBeUndefined();
  });

  it("renders numbers as canonical decimal strings and counts as non-negative integers", () => {
    expect(decimalString(219.3)).toBe("219.3");
    expect(decimalString(0.1 + 0.2)).toBe("0.3");
    expect(decimalString(1.23456)).toBe("1.2346");
    expect(decimalString(-0)).toBe("0");
    expect(decimalString(-658304.25)).toBe("-658304.25");
    expect([count(undefined), count(null), count(-5), count(Number.NaN), count(2.6)]).toEqual([0, 0, 0, 0, 3]);
  });
});

describe("enums", () => {
  it.each([
    ["INTRADAY", "OPT", "I", "INTRADAY"],
    ["DELIVERY", "EQ", "D", "DELIVERY"],
    ["MARGIN", "OPT", "D", "MARGIN"],
    ["MARGIN", "FUT", "D", "MARGIN"],
    ["MARGIN", "EQ", "MTF", "MARGIN"],
  ] as const)("maps product %s on %s to %s and back to %s", (ours, segment, theirs, back) => {
    expect(toUpstoxProduct(ours, segment)).toBe(theirs);
    expect(fromUpstoxProduct(theirs, segment)).toBe(back);
  });

  it("has no Upstox product for CO and BO, and reads CO and unknown products", () => {
    expect(toUpstoxProduct("CO", "EQ")).toBeUndefined();
    expect(toUpstoxProduct("BO", "EQ")).toBeUndefined();
    expect(fromUpstoxProduct("CO", "EQ")).toBe("CO");
    expect(fromUpstoxProduct("XYZ", "EQ")).toBeUndefined();
  });

  it("maps order types and validities", () => {
    expect((["MARKET", "LIMIT", "SL", "SL_M"] as const).map(toUpstoxOrderType)).toEqual([
      "MARKET",
      "LIMIT",
      "SL",
      "SL-M",
    ]);
    expect(["MARKET", "LIMIT", "SL", "SL-M", "AMO"].map(fromUpstoxOrderType)).toEqual([
      "MARKET",
      "LIMIT",
      "SL",
      "SL_M",
      undefined,
    ]);
    expect(["DAY", "IOC", "GTC"].map(fromUpstoxValidity)).toEqual(["DAY", "IOC", undefined]);
  });

  it("maps every documented order status", () => {
    const mapped = Object.fromEntries(UPSTOX_ORDER_STATUSES.map((status) => [status, toOrderStatus(status, 0)]));
    expect(mapped).toEqual({
      "validation pending": "PENDING",
      "modify pending": "OPEN",
      "trigger pending": "OPEN",
      "put order req received": "PENDING",
      "modify after market order req received": "PENDING",
      "cancelled after market order": "CANCELLED",
      open: "OPEN",
      complete: "FILLED",
      "modify validation pending": "OPEN",
      "after market order req received": "PENDING",
      modified: "OPEN",
      "not cancelled": "OPEN",
      "cancel pending": "OPEN",
      rejected: "REJECTED",
      cancelled: "CANCELLED",
      "open pending": "PENDING",
      "not modified": "OPEN",
    });
  });

  it("reports partial fills on working orders and keeps unknown statuses non-terminal", () => {
    expect(toOrderStatus("open", 25)).toBe("PARTIALLY_FILLED");
    expect(toOrderStatus("cancelled", 25)).toBe("CANCELLED");
    expect(toOrderStatus("something new", 0)).toBe("PENDING");
    expect(toOrderStatus("toString", 0)).toBe("PENDING");
  });

  it("maps feed modes per instrument kind", () => {
    expect(toUpstoxFeedMode(NIFTY_CE, "ltp")).toBe("ltpc");
    expect(toUpstoxFeedMode(NIFTY_CE, "quote")).toBe("option_greeks");
    expect(toUpstoxFeedMode(NIFTY_CE, "full")).toBe("full");
    expect(toUpstoxFeedMode(NIFTY_INDEX, "quote")).toBe("full");
    expect(segmentOf(NIFTY_INDEX)).toBe("INDEX");
    expect(segmentOf("garbage" as InstrumentKey)).toBe("EQ");
  });
});

describe("profile and funds", () => {
  it("keeps the exchanges the platform knows and drops BCD", () => {
    const profile = toProfile(UpstoxProfileSchema.parse(data("profile.json")));
    expect(profile).toEqual({
      brokerClientId: "******",
      name: "******",
      email: "******",
      exchanges: ["NSE", "NFO", "BSE", "CDS", "BFO"],
    });
    const noEmail = UpstoxProfileSchema.parse({ ...(data("profile.json") as object), email: null });
    expect(toProfile(noEmail)).not.toHaveProperty("email");
  });

  it("reads the combined funds from the equity segment", () => {
    expect(toFunds(UpstoxFundsSchema.parse(data("funds.json")))).toEqual({
      availableMargin: "15507.46",
      usedMargin: "0.8",
      collateral: "0",
    });
  });
});

describe("orders, positions and holdings", () => {
  const docRow = (): UpstoxOrder => UpstoxOrderSchema.parse(firstRow("order-book.json"));

  it("maps the documented order book row", () => {
    const order = toBrokerOrder(docRow(), FCONSUMER, NOW);
    expect(order).toEqual({
      brokerOrderId: "231019025057849",
      instrumentKey: FCONSUMER,
      side: "BUY",
      type: "LIMIT",
      product: "DELIVERY",
      validity: "DAY",
      qty: 1,
      filledQty: 1,
      price: "0.8",
      averagePrice: "0.8",
      status: "FILLED",
      placedAt: "2023-10-19T09:23:23+05:30",
      updatedAt: "2023-10-19T09:23:23+05:30",
    });
    expect(BrokerOrderSchema.safeParse(order).success).toBe(true);
  });

  it("keeps the trigger of stop orders, a valid tag and the status message", () => {
    const order = toBrokerOrder(
      {
        ...docRow(),
        order_type: "SL-M",
        price: 0,
        trigger_price: 50.5,
        average_price: 0,
        filled_quantity: 0,
        status: "trigger pending",
        tag: "algo_1",
        status_message: "  waiting for trigger  ",
        order_timestamp: null,
        exchange_timestamp: null,
      },
      FCONSUMER,
      NOW,
    );
    expect(order).toMatchObject({
      type: "SL_M",
      triggerPrice: "50.5",
      tag: "algo_1",
      statusMessage: "waiting for trigger",
    });
    expect(order).not.toHaveProperty("price");
    expect(order).not.toHaveProperty("averagePrice");
    expect(order?.placedAt).toBe(NOW.toISOString());
  });

  it("drops a tag outside the sdk's tag grammar", () => {
    expect(toBrokerOrder({ ...docRow(), tag: "has spaces in it" }, FCONSUMER, NOW)).not.toHaveProperty("tag");
  });

  it.each([
    ["an unknown product", { product: "XX" }],
    ["an unknown order type", { order_type: "AMO" }],
    ["an unknown side", { transaction_type: "SHORT" }],
    ["an unknown validity", { validity: "GTC" }],
    ["a zero quantity", { quantity: 0 }],
  ])("skips a row with %s", (_name, change) => {
    expect(toBrokerOrder({ ...docRow(), ...change }, FCONSUMER, NOW)).toBeUndefined();
  });

  it("maps the documented position (D on an option is carry-forward)", () => {
    const row = UpstoxPositionSchema.parse(firstRow("positions.json"));
    expect(toPosition(row, BANKNIFTY_PE)).toEqual({
      instrumentKey: BANKNIFTY_PE,
      product: "MARGIN",
      netQty: 15,
      buyQty: 15,
      sellQty: 0,
      buyAvg: "2.65",
      sellAvg: "0",
      realisedPnl: "0",
      ltp: "1.75",
      close: "1.95",
      unrealisedPnl: "-658304.25",
    });
    const sparse = UpstoxPositionSchema.parse({ product: "I", instrument_token: "NSE_FO|52618", quantity: 0 });
    expect(toPosition(sparse, BANKNIFTY_PE)).toEqual({
      instrumentKey: BANKNIFTY_PE,
      product: "INTRADAY",
      netQty: 0,
      buyQty: 0,
      sellQty: 0,
      buyAvg: "0",
      sellAvg: "0",
      realisedPnl: "0",
    });
    expect(toPosition({ ...row, product: "XX" }, BANKNIFTY_PE)).toBeUndefined();
  });

  it("maps the documented holding", () => {
    const row = UpstoxHoldingSchema.parse(firstRow("holdings.json"));
    expect(toHolding(row, YESBANK)).toEqual({
      instrumentKey: YESBANK,
      qty: 36,
      t1Qty: 0,
      avgPrice: "18.75",
      ltp: "17.05",
      close: "17.05",
    });
    const sparse = toHolding({ ...row, t1_quantity: null, last_price: null, close_price: 0 }, YESBANK);
    expect(sparse).toEqual({ instrumentKey: YESBANK, qty: 36, avgPrice: "18.75" });
  });
});

describe("candles", () => {
  it.each([
    ["M1", "minutes", 1],
    ["M3", "minutes", 3],
    ["M5", "minutes", 5],
    ["M15", "minutes", 15],
    ["M30", "minutes", 30],
    ["H1", "hours", 1],
    ["D1", "days", 1],
  ] as const)("requests %s as %s/%i", (timeframe, unit, interval) => {
    expect(candleSpec(timeframe)).toMatchObject({ unit, interval });
  });

  it("maps a V3 candle, with open interest only for derivatives", () => {
    const raw = ["2025-01-01T00:00:00+05:30", 53.1, 53.95, 51.6, 52.05, 235519861, 12] as const;
    expect(toCandle([...raw], true)).toEqual({
      ts: Date.parse("2024-12-31T18:30:00Z"),
      open: "53.1",
      high: "53.95",
      low: "51.6",
      close: "52.05",
      volume: 235519861,
      oi: 12,
    });
    expect(toCandle([...raw], false)).not.toHaveProperty("oi");
    expect(toCandle(["2025-01-01T00:00:00+05:30", 1, 1, 1, 1, 0], true)).not.toHaveProperty("oi");
    expect(toCandle(["not a time", 1, 1, 1, 1, 0], true)).toBeUndefined();
  });
});

describe("instrument master rows → canonical keys", () => {
  const rows = new Map(
    (fixture("instruments.json") as unknown[]).map((raw) => {
      const parsed = UpstoxInstrumentSchema.safeParse(raw);
      const key = (raw as { instrument_key: string }).instrument_key;
      return [key, parsed.success ? toInstrumentRow(parsed.data) : undefined];
    }),
  );

  it.each([
    ["NSE_EQ|INE839G01010", "NSE_EQ|JOCIL"],
    ["NSE_FO|36702", "NSE_FO|071NSETEST|2036-11-27"],
    ["NSE_FO|36708", "NSE_FO|IDEA|2024-01-25|22|CE"],
    ["BSE_INDEX|AUTO", "BSE_INDEX|AUTO"],
    ["NSE_INDEX|Nifty 50", "NSE_INDEX|NIFTY 50"],
    ["NSE_FO|45450", "NSE_FO|NIFTY|2025-03-06|22500|CE"],
    ["NSE_FO|52618", "NSE_FO|BANKNIFTY|2023-10-25|38000|PE"],
    ["NSE_EQ|INE528G01035", "NSE_EQ|YESBANK"],
    ["BSE_EQ|INE220J01025", "BSE_EQ|FCONSUMER"],
    ["MCX_FO|436953", "MCX_FO|CRUDEOIL|2025-11-19"],
    ["NCD_FO|1234", "NSE_CD|USDINR|2025-10-29"],
  ])("maps Upstox %s to %s", (token, key) => {
    const row = rows.get(token);
    expect(row?.instrumentKey).toBe(key);
    expect(row?.brokerToken).toBe(token);
    expect(InstrumentRowSchema.safeParse(row).success).toBe(true);
  });

  it.each([
    ["a mutual fund (no segment)", "INF846K016M6"],
    ["a global index", "GLOBAL_INDEX|SGX NIFTY"],
    ["NSE commodities (no canonical token)", "NSE_COM|9999"],
    ["a symbol outside the key grammar", "NSE_EQ|INE000X00000"],
    ["a future without an expiry", "NSE_FO|1"],
    ["an unknown derivative type", "NSE_FO|2"],
  ])("skips %s", (_name, token) => {
    expect(rows.get(token)).toBeUndefined();
  });

  it("converts tick sizes from paise and keeps lot, freeze, ISIN and option fields", () => {
    expect(rows.get("NSE_FO|45450")).toEqual({
      instrumentKey: "NSE_FO|NIFTY|2025-03-06|22500|CE",
      brokerToken: "NSE_FO|45450",
      exchange: "NFO",
      segment: "OPT",
      tradingSymbol: "NIFTY 22500 CE 06 MAR 25",
      name: "NIFTY",
      expiry: "2025-03-06",
      strike: "22500",
      optionType: "CE",
      lotSize: 75,
      tickSize: "0.05",
      freezeQty: 1800,
    });
    expect(rows.get("NSE_EQ|INE528G01035")).toMatchObject({ isin: "INE528G01035", tickSize: "0.01", lotSize: 1 });
    expect(rows.get("MCX_FO|436953")).toMatchObject({ exchange: "MCX", tickSize: "1", lotSize: 100 });
    expect(rows.get("NCD_FO|1234")).toMatchObject({ exchange: "CDS", tickSize: "0.0025" });
    expect(rows.get("NSE_INDEX|Nifty 50")).toMatchObject({
      tickSize: "0.05",
      lotSize: 1,
      tradingSymbol: "NIFTY 50",
      name: "Nifty 50",
    });
    expect(rows.get("NSE_INDEX|Nifty 50")).not.toHaveProperty("freezeQty");
  });

  it("falls back to the key's symbol for a row without names", () => {
    const row = toInstrumentRow(
      UpstoxInstrumentSchema.parse({ segment: "BSE_INDEX", instrument_key: "BSE_INDEX|AUTO" }),
    );
    expect(row).toMatchObject({ instrumentKey: "BSE_INDEX|AUTO", tradingSymbol: "AUTO", name: "AUTO" });
  });

  it("maps Upstox's index rows to exactly the pinned market index keys, with the seed's symbol and name", () => {
    const rows = (fixture("instruments-indices.json") as unknown[]).map((raw) =>
      toInstrumentRow(UpstoxInstrumentSchema.parse(raw)),
    );
    for (const row of rows) expect(InstrumentRowSchema.safeParse(row).success, row?.instrumentKey).toBe(true);
    const pinned = rows.filter((row) => MARKET_INDEX_ALIASES.some((alias) => alias.key === row?.instrumentKey));
    expect(pinned.map((row) => row?.instrumentKey)).toEqual(Object.values(MARKET_INDEX_KEYS));
    expect(pinned.map((row) => [row?.brokerToken, row?.tradingSymbol, row?.name])).toEqual([
      ["NSE_INDEX|Nifty 50", "NIFTY 50", "Nifty 50"],
      ["NSE_INDEX|Nifty Bank", "NIFTY BANK", "Nifty Bank"],
      ["NSE_INDEX|Nifty Fin Service", "NIFTY FIN SERVICE", "Nifty Financial Services"],
      ["NSE_INDEX|NIFTY MID SELECT", "NIFTY MID SELECT", "Nifty Midcap Select"],
      ["NSE_INDEX|Nifty Next 50", "NIFTY NEXT 50", "Nifty Next 50"],
      ["NSE_INDEX|Nifty IT", "NIFTY IT", "Nifty IT"],
      ["NSE_INDEX|India VIX", "INDIA VIX", "India VIX"],
      ["BSE_INDEX|SENSEX", "SENSEX", "BSE Sensex"],
      ["BSE_INDEX|BANKEX", "BANKEX", "BSE Bankex"],
    ]);
    // Other indices keep Upstox's own name; SENSEX50 is not SENSEX.
    expect(rows.map((row) => row?.instrumentKey)).toEqual(
      expect.arrayContaining(["NSE_INDEX|NIFTY AUTO", "BSE_INDEX|SNSX50"]),
    );
  });

  it("maps NIFTY 50 equity rows to NSE_EQ|<SYMBOL> like the dev seed", () => {
    const rows = (fixture("instruments-indices.json") as unknown[]).flatMap((raw) => {
      const row = toInstrumentRow(UpstoxInstrumentSchema.parse(raw));
      return row?.segment === "EQ" ? [row] : [];
    });
    expect(rows.map((row) => [row.instrumentKey, row.tradingSymbol])).toEqual([
      ["NSE_EQ|RELIANCE", "RELIANCE"],
      ["NSE_EQ|M&M", "M&M"],
      ["NSE_EQ|BAJAJ-AUTO", "BAJAJ-AUTO"],
    ]);
  });

  it("derives an equity key from the trading symbol for rows the resolver doesn't know", () => {
    expect(fallbackEquityKey("NSE_EQ|INE002A01018", " RELIANCE ")).toBe("NSE_EQ|RELIANCE");
    expect(fallbackEquityKey("BSE_EQ|INE220J01025", "fconsumer")).toBe("BSE_EQ|FCONSUMER");
    expect(fallbackEquityKey("NSE_EQ|INE848E01016", "NHPC-EQ")).toBe("NSE_EQ|NHPC");
    expect(fallbackEquityKey("NSE_EQ|INE917I01010", "BAJAJ-AUTO")).toBe("NSE_EQ|BAJAJ-AUTO");
    expect(fallbackEquityKey("NSE_EQ|INE848E01016", "-EQ")).toBeUndefined();
    expect(fallbackEquityKey("NSE_FO|52618", "BANKNIFTY23OCT38000PE")).toBeUndefined();
    expect(fallbackEquityKey("NSE_EQ|INE002A01018", null)).toBeUndefined();
    expect(fallbackEquityKey("NSE_EQ|INE002A01018", "BAD|SYMBOL")).toBeUndefined();
  });
});

describe("feed frames → ticks", () => {
  const feedOf = (name: string, token: string): UpstoxFeed => {
    const feed = decodeUpstoxFeedResponse(fixtureBytes(name)).feeds?.[token];
    if (feed === undefined) throw new Error(`no ${token} in ${name}`);
    return feed;
  };

  it("maps an LTPC frame", () => {
    expect(toTick(NIFTY_CE, feedOf("feed-ltpc.bin", "NSE_FO|45450"), 1, true)).toEqual({
      instrumentKey: NIFTY_CE,
      ltp: "219.3",
      ts: 1740729552723,
      ltq: 75,
      close: "494.05",
    });
  });

  it("maps a full option frame with depth, day OHLC and Greeks", () => {
    const tick = toTick(NIFTY_CE, feedOf("feed-full.bin", "NSE_FO|45450"), 1, true);
    expect(tick).toEqual({
      instrumentKey: NIFTY_CE,
      ltp: "219.3",
      ts: 1740729552723,
      ltq: 75,
      close: "494.05",
      open: "480.1",
      high: "495.6",
      low: "201.15",
      atp: "312.45",
      volume: 10234500,
      oi: 4521300,
      tbq: 512300,
      tsq: 498775,
      bid: "219.25",
      bidQty: 1500,
      ask: "219.4",
      askQty: 675,
      depth: {
        bids: [
          { price: "219.25", qty: 1500 },
          { price: "219.2", qty: 2250 },
        ],
        asks: [
          { price: "219.4", qty: 675 },
          { price: "219.45", qty: 900 },
        ],
      },
      greeks: { iv: 0.1432, delta: 0.4521, gamma: 0.0011, theta: -12.31, vega: 9.87, rho: 1.02 },
    });
    expect(TickSchema.safeParse(tick).success).toBe(true);
    expect(toTick(NIFTY_CE, feedOf("feed-full.bin", "NSE_FO|45450"), 1, false)).not.toHaveProperty("greeks");
  });

  it("maps a full index frame", () => {
    expect(toTick(NIFTY_INDEX, feedOf("feed-full.bin", "NSE_INDEX|Nifty 50"), 1, false)).toEqual({
      instrumentKey: NIFTY_INDEX,
      ltp: "22545.05",
      ts: 1740729552000,
      close: "22604.85",
      open: "22508.75",
      high: "22613.25",
      low: "22432.5",
    });
  });

  it("maps an option_greeks frame (top of book, Greeks, volume, OI)", () => {
    const tick = toTick(NIFTY_CE, feedOf("feed-option-greeks.bin", "NSE_FO|45450"), 1, true);
    expect(tick).toMatchObject({
      bid: "219.25",
      ask: "219.4",
      volume: 10234500,
      oi: 4521300,
      greeks: { iv: 0.1432, delta: 0.4521 },
    });
    expect(TickSchema.safeParse(tick).success).toBe(true);
  });

  it("uses the message time without a trade time, and skips entries without LTPC", () => {
    expect(toTick(NIFTY_CE, { ltpc: { ltp: 1 } }, 42, true)).toEqual({ instrumentKey: NIFTY_CE, ltp: "1", ts: 42 });
    expect(toTick(NIFTY_CE, { ltpc: {} }, 42, true)).toMatchObject({ ltp: "0", ts: 42 });
    expect(toTick(NIFTY_CE, { requestMode: "ltpc" }, 42, true)).toBeUndefined();
    const bare = toTick(
      NIFTY_CE,
      {
        fullFeed: { marketFF: { ltpc: { ltp: 2 }, optionGreeks: {}, marketOHLC: { ohlc: [{ interval: "1d" }] } } },
      },
      42,
      true,
    );
    // proto3 leaves "none yet" at 0: no zero prices and no zero OI on the tick; volume and book totals are counts.
    expect(bare).toEqual({
      instrumentKey: NIFTY_CE,
      ltp: "2",
      ts: 42,
      volume: 0,
      tbq: 0,
      tsq: 0,
      depth: { bids: [], asks: [] },
      greeks: { iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 },
    });
    expect(bare?.greeks).not.toHaveProperty("rho");
    const greeksOnly = toTick(NIFTY_CE, { firstLevelWithGreeks: { ltpc: { ltp: 3, cp: 0 } } }, 42, false);
    expect(greeksOnly).toEqual({ instrumentKey: NIFTY_CE, ltp: "3", ts: 42, volume: 0 });
  });
});
