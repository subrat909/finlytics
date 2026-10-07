import { parseInstrumentKey } from "@finlytics/shared";
import type { ParsedInstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { isBrokerError } from "../../../errors";
import { BrokerOrderSchema, CandleSchema } from "../../../models";
import type { Candle } from "../../../models";
import { DhanInstrumentMap } from "../instruments";
import {
  aggregateCandles,
  alertSegment,
  alertToOrder,
  alertToTrade,
  candlePlan,
  cleanToken,
  decimalOf,
  finaliseCandles,
  intOf,
  istDate,
  istToDate,
  istToIso,
  istWallClock,
  jwtClientId,
  jwtExpiry,
  moneyOf,
  parsedKey,
  positivePriceOf,
  renewedToken,
  resolveKey,
  toBrokerHolding,
  toBrokerOrder,
  toBrokerPosition,
  toCandles,
  toDhanOrderType,
  toDhanProduct,
  toFunds,
  toProfile,
} from "../mappers";
import {
  dhanNumber,
  DhanFundLimitSchema,
  DhanHoldingSchema,
  DhanOrderAlertDataSchema,
  DhanOrderSchema,
  DhanPositionSchema,
  DhanProfileSchema,
} from "../types";

import { fakeJwt, fixture, seededInstruments } from "./fake-dhan";

const NOW = new Date("2025-10-06T04:00:00.000Z");
const now = (): Date => NOW;

function parsed(key: string): ParsedInstrumentKey {
  const result = parseInstrumentKey(key);
  if (!result.ok) throw new Error(key);
  return result.value;
}

function order(patch: Record<string, unknown> = {}): ReturnType<typeof DhanOrderSchema.parse> {
  return DhanOrderSchema.parse({ ...(fixture("order.json") as object), ...patch });
}

function alert(patch: Record<string, unknown> = {}): ReturnType<typeof DhanOrderAlertDataSchema.parse> {
  const message = fixture("order-update.json") as { Data: Record<string, unknown> };
  return DhanOrderAlertDataSchema.parse({ ...message.Data, ...patch });
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe("numbers and times", () => {
  it("renders broker numbers as decimal strings", () => {
    expect(decimalOf(3345.8)).toBe("3345.8");
    expect(decimalOf(0.1 + 0.2)).toBe("0.3");
    expect(decimalOf(Number.NaN)).toBeUndefined();
    expect(decimalOf(null)).toBeUndefined();
    expect(moneyOf(undefined)).toBe("0");
    expect(moneyOf(-420.25)).toBe("-420.25");
    expect(positivePriceOf(0)).toBeUndefined();
    expect(positivePriceOf(null)).toBeUndefined();
    expect(positivePriceOf(12.5)).toBe("12.5");
    expect(intOf(-3)).toBe(0);
    expect(intOf(7.9)).toBe(7);
    expect(intOf(Number.POSITIVE_INFINITY)).toBe(0);
    expect(intOf(undefined)).toBe(0);
  });

  it("reads IST wall-clock times", () => {
    expect(istToIso("2021-11-24 13:33:03")).toBe("2021-11-24T13:33:03+05:30");
    expect(istToIso("0001-01-01 00:00:00")).toBeUndefined();
    expect(istToIso("")).toBeUndefined();
    expect(istToIso(null)).toBeUndefined();
    expect(istToDate("2026-01-01T00:00:00.000")?.toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(istToDate("30/03/2025 15:37")?.toISOString()).toBe("2025-03-30T10:07:00.000Z");
    expect(istToDate("soon")).toBeUndefined();
    expect(istToDate(undefined)).toBeUndefined();
    expect(istWallClock(new Date("2025-10-06T03:45:00Z"))).toBe("2025-10-06 09:15:00");
    expect(istDate(new Date("2025-10-06T19:00:00Z"))).toBe("2025-10-07");
  });

  it("reads a JWT's exp claim, and nothing else", () => {
    expect(jwtExpiry(fakeJwt({ exp: 1_759_852_800 }))?.toISOString()).toBe("2025-10-07T16:00:00.000Z");
    expect(jwtExpiry(fakeJwt({ exp: "tomorrow" }))).toBeUndefined();
    expect(jwtExpiry(fakeJwt(["not", "an", "object"]))).toBeUndefined();
    expect(jwtExpiry("opaque-token")).toBeUndefined();
    expect(jwtExpiry("a.%%%.c")).toBeUndefined();
  });

  it("reads token validity in every form Dhan uses, as IST unless it says otherwise", () => {
    expect(istToDate("30/03/2025 15:37:20")?.toISOString()).toBe("2025-03-30T10:07:20.000Z");
    expect(istToDate("30-03-2025 15:37")?.toISOString()).toBe("2025-03-30T10:07:00.000Z");
    expect(istToDate("2025-09-23T12:37:23")?.toISOString()).toBe("2025-09-23T07:07:23.000Z");
    expect(istToDate("2025-09-23 12:37:23.0")?.toISOString()).toBe("2025-09-23T07:07:23.000Z");
    expect(istToDate("2025-09-23T07:07:23Z")?.toISOString()).toBe("2025-09-23T07:07:23.000Z");
    expect(istToDate("2025-09-23T12:37:23+05:30")?.toISOString()).toBe("2025-09-23T07:07:23.000Z");
    expect(istToDate("2025-09-23T02:07:23-0500")?.toISOString()).toBe("2025-09-23T07:07:23.000Z");
    expect(istToDate(1_759_852_800)?.toISOString()).toBe("2025-10-07T16:00:00.000Z");
    expect(istToDate("1759852800000")?.toISOString()).toBe("2025-10-07T16:00:00.000Z");
    for (const value of ["30/03/2025", "31/13/2025 10:00", "0001-01-01 00:00:00", "", 12, null, {}, Number.NaN]) {
      expect(istToDate(value), JSON.stringify(value)).toBeUndefined();
    }
  });

  it("finds the client id claim and cleans what a paste brings along", () => {
    expect(jwtClientId(fakeJwt({ dhanClientId: " 1000000001 " }))).toBe("1000000001");
    expect(jwtClientId(fakeJwt({ dhanClientId: 1000000001 }))).toBe("1000000001");
    expect(jwtClientId(fakeJwt({ dhanClientId: 1.5 }))).toBeUndefined();
    expect(jwtClientId(fakeJwt({ exp: 1 }))).toBeUndefined();
    expect(jwtClientId("opaque")).toBeUndefined();
    expect(cleanToken(' "Bearer eyJ.a.b\n" ')).toBe("eyJ.a.b");
    expect(cleanToken("access_token= 'eyJ.a\n.b'")).toBe("eyJ.a.b");
    expect(cleanToken(undefined)).toBe("");
  });

  it("finds a renewed token in every shape, or nothing", () => {
    const jwt = fakeJwt({ exp: 1 });
    expect(renewedToken({ accessToken: jwt, expiryTime: "2025-10-09T21:30:00.000" })).toEqual({
      token: jwt,
      expiry: "2025-10-09T21:30:00.000",
    });
    expect(renewedToken({ data: { access_token: ` ${jwt} ` } })).toEqual({ token: jwt });
    expect(renewedToken({ status: "success", data: { newToken: jwt, expiry: 5 } })).toEqual({ token: jwt, expiry: 5 });
    expect(renewedToken(` ${jwt}\n`)).toEqual({ token: jwt });
    for (const body of ["not a token", { accessToken: "" }, { data: "x" }, [jwt], null, 42]) {
      expect(renewedToken(body)).toBeUndefined();
    }
  });
});

describe("enums", () => {
  it("maps order types and products to Dhan's", () => {
    expect(toDhanOrderType("SL_M")).toBe("STOP_LOSS_MARKET");
    expect(toDhanOrderType("SL")).toBe("STOP_LOSS");
    expect(toDhanProduct("DELIVERY", parsed("NSE_EQ|TCS"))).toBe("CNC");
    expect(toDhanProduct("DELIVERY", parsed("NSE_FO|NIFTY|2025-10-28"))).toBe("MARGIN");
    expect(toDhanProduct("INTRADAY", parsed("NSE_EQ|TCS"))).toBe("INTRADAY");
    const error = caught(() => toDhanProduct("BO", parsed("NSE_EQ|TCS")));
    expect(isBrokerError(error) && error.code).toBe("VALIDATION");
  });
});

describe("profile and funds", () => {
  it("lists exchanges from the active segments and never puts the client id in the name", () => {
    expect(toProfile({ dhanClientId: "1000000001", activeSegment: "Equity, Derivative, Currency, Commodity" })).toEqual(
      {
        brokerClientId: "1000000001",
        name: "Dhan account",
        exchanges: ["NSE", "BSE", "MCX", "NFO", "BFO", "CDS"],
      },
    );
    expect(toProfile({ dhanClientId: "1", activeSegment: undefined }).exchanges).toEqual([]);
  });

  it("maps the fund limit, with or without a withdrawable balance", () => {
    expect(
      toFunds({ availabelBalance: 98440, utilizedAmount: 15202, collateralAmount: 0, withdrawableBalance: 98310 }),
    ).toEqual({
      availableMargin: "98440",
      usedMargin: "15202",
      collateral: "0",
      withdrawable: "98310",
    });
    expect(toFunds({ availabelBalance: 1 })).toEqual({ availableMargin: "1", usedMargin: "0", collateral: "0" });
    // Should Dhan ever fix the typo.
    expect(toFunds({ availableBalance: 2.5 }).availableMargin).toBe("2.5");
    expect(toFunds({ availabelBalance: 3, availableBalance: 4 }).availableMargin).toBe("3");
  });

  it("reads the fund limit and profile forgivingly: numeric strings, nulls, extra fields", () => {
    expect(DhanFundLimitSchema.parse({ availabelBalance: " 1e3 ", utilizedAmount: "NA", extra: [1] })).toMatchObject({
      availabelBalance: 1000,
    });
    expect(DhanFundLimitSchema.parse({ availabelBalance: "7" }).utilizedAmount).toBeUndefined();
    expect(DhanFundLimitSchema.safeParse({ sodLimit: 1 }).success).toBe(false);
    expect([Number.POSITIVE_INFINITY, "abc", " ", true].map(dhanNumber)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(DhanOrderSchema.safeParse({ ...(fixture("order.json") as object), quantity: "five" }).success).toBe(false);
    expect(DhanOrderSchema.parse({ ...(fixture("order.json") as object), quantity: "5" }).quantity).toBe(5);
    expect(DhanProfileSchema.parse({ dhanClientId: 1100003626, ddpi: 5, mtf: null })).toMatchObject({
      dhanClientId: "1100003626",
      ddpi: "5",
    });
    expect(DhanProfileSchema.safeParse({ dhanClientId: " " }).success).toBe(false);
    expect(DhanProfileSchema.safeParse({ dhanClientId: -1 }).success).toBe(false);
  });
});

describe("orders", () => {
  const map = seededInstruments();

  it("maps the docs' order book row, deriving an equity key from the trading symbol", () => {
    const mapped = toBrokerOrder(map, order({ tradingSymbol: "TCS" }), now);
    expect(BrokerOrderSchema.parse(mapped)).toEqual({
      brokerOrderId: "112111182198",
      instrumentKey: "NSE_EQ|TCS",
      side: "BUY",
      type: "MARKET",
      product: "INTRADAY",
      validity: "DAY",
      qty: 5,
      filledQty: 0,
      status: "OPEN",
      tag: "123abc678",
      placedAt: "2021-11-24T13:33:03+05:30",
      updatedAt: "2021-11-24T13:33:03+05:30",
    });
  });

  it.each([
    ["TRANSIT", "PENDING"],
    ["PENDING", "OPEN"],
    ["TRIGGERED", "OPEN"],
    ["PART_TRADED", "PARTIALLY_FILLED"],
    ["TRADED", "FILLED"],
    ["CLOSED", "FILLED"],
    ["CANCELLED", "CANCELLED"],
    ["REJECTED", "REJECTED"],
    ["EXPIRED", "EXPIRED"],
    ["SOMETHING_NEW", "PENDING"],
  ])("maps status %s to %s", (status, expected) => {
    expect(toBrokerOrder(map, order({ orderStatus: status, tradingSymbol: "TCS" }), now).status).toBe(expected);
  });

  it("keeps prices that apply to the order type, fills from the remaining quantity, and drops unusable tags", () => {
    const mapped = toBrokerOrder(
      map,
      order({
        orderType: "STOP_LOSS",
        productType: "CNC",
        validity: "IOC",
        transactionType: "SELL",
        exchangeSegment: "NSE_FNO",
        securityId: "52175",
        price: 101.5,
        triggerPrice: 100,
        averageTradedPrice: 101.45,
        filledQty: null,
        remainingQuantity: 2,
        correlationId: "has spaces!",
        omsErrorDescription: "  RMS: margin shortfall  ",
        createTime: null,
        exchangeTime: null,
        updateTime: null,
      }),
      now,
    );
    expect(mapped).toMatchObject({
      instrumentKey: "NSE_FO|NIFTY|2025-10-30|24000|CE",
      side: "SELL",
      type: "SL",
      product: "DELIVERY",
      validity: "IOC",
      price: "101.5",
      triggerPrice: "100",
      averagePrice: "101.45",
      filledQty: 3,
      statusMessage: "RMS: margin shortfall",
      placedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(mapped.tag).toBeUndefined();
    expect(
      toBrokerOrder(
        map,
        order({
          orderType: "STOP_LOSS_MARKET",
          triggerPrice: 99,
          tradingSymbol: "TCS",
          productType: "WEIRD",
          orderType2: 1,
        }),
        now,
      ),
    ).toMatchObject({ type: "SL_M", triggerPrice: "99", product: "INTRADAY" });
    expect(toBrokerOrder(map, order({ orderType: "ODD", price: 0, tradingSymbol: "TCS" }), now).type).toBe("LIMIT");
  });

  it("derives option and future keys from the derivative fields when the map doesn't know the security", () => {
    const empty = new DhanInstrumentMap();
    expect(
      resolveKey(empty, "NSE_FNO", "1", {
        tradingSymbol: "BANKNIFTY-Oct2025-55000-PE",
        expiry: "2025-10-28",
        optionType: "PUT",
        strike: 55000,
      }),
    ).toBe("NSE_FO|BANKNIFTY|2025-10-28|55000|PE");
    expect(
      resolveKey(empty, "MCX_COMM", "2", { tradingSymbol: "GOLD-Dec2025-FUT", expiry: "2025-12-05", strike: 0 }),
    ).toBe("MCX_FO|GOLD|2025-12-05");
  });

  it("refuses an instrument it can't identify", () => {
    const empty = new DhanInstrumentMap();
    for (const attempt of [
      () => resolveKey(empty, "IDX_I", "13", { tradingSymbol: "NIFTY" }),
      () => resolveKey(empty, "NSE_EQ", "1"),
      () => resolveKey(empty, "NSE_FNO", "1", { tradingSymbol: "NIFTY-X", expiry: null }),
      () => resolveKey(empty, "NSE_EQ", "1", { tradingSymbol: "BAD|SYMBOL" }),
    ]) {
      const error = caught(attempt);
      expect(isBrokerError(error) && error.code).toBe("INTERNAL");
    }
  });
});

describe("positions and holdings", () => {
  const map = seededInstruments();

  it("maps the docs' positions", () => {
    const positions = (fixture("positions.json") as unknown[]).map((row) =>
      toBrokerPosition(map, DhanPositionSchema.parse(row)),
    );
    expect(positions).toEqual([
      {
        instrumentKey: "NSE_EQ|TCS",
        product: "DELIVERY",
        netQty: 40,
        buyQty: 40,
        sellQty: 0,
        buyAvg: "3345.8",
        sellAvg: "0",
        realisedPnl: "0",
        unrealisedPnl: "6122",
      },
      {
        instrumentKey: "NSE_FO|BANKNIFTY|2025-10-28|55000|PE",
        product: "MARGIN",
        netQty: -35,
        buyQty: 0,
        sellQty: 35,
        buyAvg: "0",
        sellAvg: "212.35",
        realisedPnl: "0",
        unrealisedPnl: "-420.25",
      },
    ]);
    const row = DhanPositionSchema.parse({ ...(fixture("positions.json") as object[])[0], unrealizedProfit: null });
    expect(toBrokerPosition(map, row)?.unrealisedPnl).toBeUndefined();
    // Missing amounts are 0; an instrument nobody can identify is left out.
    const sparse = DhanPositionSchema.parse({ securityId: 11536, exchangeSegment: "NSE_EQ", productType: "CNC" });
    expect(toBrokerPosition(map, { ...sparse, tradingSymbol: "TCS" })).toMatchObject({
      instrumentKey: "NSE_EQ|TCS",
      netQty: 0,
      buyAvg: "0",
      realisedPnl: "0",
    });
    expect(toBrokerPosition(map, sparse)).toBeUndefined();
    expect(toBrokerHolding(new DhanInstrumentMap(), DhanHoldingSchema.parse({ securityId: "1" }))).toBeUndefined();
  });

  it("maps holdings through NSE, then BSE, then the symbol", () => {
    const [docs] = fixture("holdings.json") as object[];
    expect(toBrokerHolding(map, DhanHoldingSchema.parse(docs))).toEqual({
      instrumentKey: "NSE_EQ|HDFC",
      qty: 1000,
      avgPrice: "2655",
    });
    const bseMap = new DhanInstrumentMap();
    bseMap.load([{ instrumentKey: "BSE_EQ|HDFC", brokerToken: "BSE_EQ:1330" }]);
    expect(toBrokerHolding(bseMap, DhanHoldingSchema.parse({ ...docs, t1Qty: 5 }))).toEqual({
      instrumentKey: "BSE_EQ|HDFC",
      qty: 1000,
      t1Qty: 5,
      avgPrice: "2655",
    });
    expect(toBrokerHolding(bseMap, DhanHoldingSchema.parse({ ...docs, exchange: "BSE" }))?.instrumentKey).toBe(
      "BSE_EQ|HDFC",
    );
    expect(
      toBrokerHolding(new DhanInstrumentMap(), DhanHoldingSchema.parse({ ...docs, exchange: "BSE" }))?.instrumentKey,
    ).toBe("BSE_EQ|HDFC");
  });
});

describe("order updates", () => {
  const map = seededInstruments();

  it("maps the docs' order_alert", () => {
    const order = alertToOrder(map, alert(), now);
    expect(BrokerOrderSchema.parse(order)).toMatchObject({
      brokerOrderId: "1124091136546",
      instrumentKey: "NSE_EQ|IDEA",
      side: "BUY",
      type: "LIMIT",
      product: "DELIVERY",
      price: "13",
      status: "CANCELLED",
      placedAt: "2024-09-11T14:39:29+05:30",
    });
    expect(order.statusMessage).toBeUndefined();
    expect(alertToTrade(order, alert(), 0)).toBeUndefined();
  });

  it("keeps the reason on rejections and maps every segment letter", () => {
    expect(
      alertToOrder(map, alert({ Status: "REJECTED", ReasonDescription: "Margin shortfall" }), now).statusMessage,
    ).toBe("Margin shortfall");
    expect(
      alertToOrder(map, alert({ Status: "REJECTED", ReasonDescription: null, Remarks: "RMS" }), now).statusMessage,
    ).toBe("RMS");
    expect(alertSegment(alert({ Exchange: "nse", Segment: "d" }))).toBe("NSE_FNO");
    expect(alertSegment(alert({ Exchange: "MCX", Segment: "M" }))).toBe("MCX_COMM");
    expect(alertSegment(alert({ Exchange: "XYZ", Segment: "Q" }))).toBe("Q");
  });

  it("derives a fill from the growth of the traded quantity", () => {
    const data = alert({
      Status: "Part_Traded",
      Quantity: 10,
      TradedQty: 4,
      TradedPrice: 13.05,
      AvgTradedPrice: 13.02,
      TxnType: "S",
    });
    const order = alertToOrder(map, data, now);
    expect(alertToTrade(order, data, 1)).toEqual({
      brokerTradeId: "1124091136546-4",
      brokerOrderId: "1124091136546",
      instrumentKey: "NSE_EQ|IDEA",
      side: "SELL",
      product: "DELIVERY",
      qty: 3,
      price: "13.05",
      executedAt: "2024-09-11T14:39:29+05:30",
    });
    expect(alertToTrade(order, alert({ ...data, TradedPrice: 0 }), 0)?.price).toBe("13.02");
    expect(alertToTrade(order, data, 4)).toBeUndefined();
  });
});

describe("candles", () => {
  const nifty = parsed("NSE_FO|NIFTY|2025-10-28");
  const gold = parsed("MCX_FO|GOLD|2025-12-05");
  const minute = (ts: number, close: string, extra: Partial<Candle> = {}): Candle => ({
    ts,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
    ...extra,
  });

  it("plans each timeframe on Dhan's intervals", () => {
    expect(candlePlan("M3")).toMatchObject({ interval: "1", factor: 3 });
    expect(candlePlan("M30")).toMatchObject({ interval: "15", factor: 2 });
    expect(candlePlan("D1").daily).toBe(true);
  });

  it("converts the parallel arrays and drops malformed entries", () => {
    const candles = toCandles({
      open: [10, 10, -1, 10, 10],
      high: [11, 11, 11, 11, 9],
      low: [9, 9, 9, Number.NaN, 8],
      close: [10.5, 10.5, 10, 10, 10],
      volume: [5, 6, 7, 8, 9],
      timestamp: [1_759_722_300, 1_759_722_360, 1_759_722_420, 1_759_722_480, 1_759_722_540],
      open_interest: [0, 50],
    });
    expect(candles).toEqual([
      { ts: 1_759_722_300_000, open: "10", high: "11", low: "9", close: "10.5", volume: 5 },
      { ts: 1_759_722_360_000, open: "10", high: "11", low: "9", close: "10.5", volume: 6, oi: 50 },
    ]);
    for (const candle of candles) expect(CandleSchema.safeParse(candle).success).toBe(true);
  });

  it("aggregates into buckets aligned to the session open (09:15 NSE, 09:00 MCX)", () => {
    const at = (iso: string): number => new Date(iso).getTime();
    const ones = [
      minute(at("2025-10-06T03:45:00Z"), "10", { low: "9" }),
      minute(at("2025-10-06T03:46:00Z"), "12", { high: "13", oi: 7 }),
      minute(at("2025-10-06T03:48:00Z"), "11"),
    ];
    expect(aggregateCandles(ones, 180_000, nifty)).toEqual([
      { ts: at("2025-10-06T03:45:00Z"), open: "10", high: "13", low: "9", close: "12", volume: 20, oi: 7 },
      { ts: at("2025-10-06T03:48:00Z"), open: "11", high: "11", low: "11", close: "11", volume: 10 },
    ]);
    const fifteens = [minute(at("2025-10-06T03:45:00Z"), "10", { oi: 3 }), minute(at("2025-10-06T04:00:00Z"), "11")];
    expect(aggregateCandles(fifteens, 1_800_000, nifty)).toHaveLength(1);
    expect(aggregateCandles(fifteens, 1_800_000, nifty)[0]).toMatchObject({ oi: 3, close: "11" });
    // MCX opens at 09:00 IST: 09:15 and 09:30 fall in different 30-minute buckets.
    expect(aggregateCandles(fifteens, 1_800_000, gold).map((candle) => candle.ts)).toEqual([
      at("2025-10-06T03:30:00Z"),
      at("2025-10-06T04:00:00Z"),
    ]);
  });

  it("sorts, de-duplicates and clips to [from, to)", () => {
    const candles = [
      minute(3_000, "3"),
      minute(1_000, "1"),
      minute(2_000, "2"),
      minute(2_000, "2.5"),
      minute(4_000, "4"),
    ];
    expect(finaliseCandles(candles, new Date(1_000), new Date(4_000)).map((candle) => candle.close)).toEqual([
      "1",
      "2.5",
      "3",
    ]);
  });

  it("refuses an invalid key", () => {
    const error = caught(() => parsedKey("nope" as never));
    expect(isBrokerError(error) && error.code).toBe("VALIDATION");
  });
});
