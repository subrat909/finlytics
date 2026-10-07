import { describe, expect, it } from "vitest";

import { INSTRUMENTS, NIFTY_CE, order } from "../brokers/paper/__tests__/fixtures";
import {
  AuthStartSchema,
  BrokerOrderSchema,
  CandleSchema,
  InstrumentRowSchema,
  ModifyOrderInputSchema,
  PlaceOrderInputSchema,
  TickSchema,
} from "../models";

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}): string[] => result.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? [];

describe("order inputs", () => {
  it("accepts each order type with exactly the prices it needs", () => {
    for (const input of [
      order(),
      order({ type: "LIMIT", price: "100.05" }),
      order({ type: "SL", price: "101", triggerPrice: "100" }),
      order({ type: "SL_M", triggerPrice: "100", tag: "algo_42-x" }),
    ]) {
      expect(issues(PlaceOrderInputSchema.safeParse(input))).toEqual([]);
    }
  });

  it("rejects missing or extra prices, float-ish prices, bad quantities and tags", () => {
    expect(issues(PlaceOrderInputSchema.safeParse(order({ type: "LIMIT" })))).toEqual([
      "price: Required for this order type",
    ]);
    expect(issues(PlaceOrderInputSchema.safeParse(order({ price: "1" })))).toEqual([
      "price: Not allowed for this order type",
    ]);
    expect(issues(PlaceOrderInputSchema.safeParse(order({ type: "SL", price: "1" })))).toEqual([
      "triggerPrice: Required for this order type",
    ]);
    expect(issues(PlaceOrderInputSchema.safeParse(order({ triggerPrice: "1" })))).toEqual([
      "triggerPrice: Not allowed for this order type",
    ]);
    expect(PlaceOrderInputSchema.safeParse(order({ type: "LIMIT", price: "0" })).success).toBe(false);
    expect(PlaceOrderInputSchema.safeParse({ ...order({ type: "LIMIT" }), price: 100.05 }).success).toBe(false);
    expect(PlaceOrderInputSchema.safeParse(order({ qty: 0 })).success).toBe(false);
    expect(PlaceOrderInputSchema.safeParse(order({ qty: 1.5 })).success).toBe(false);
    expect(PlaceOrderInputSchema.safeParse(order({ tag: "has space" })).success).toBe(false);
    expect(PlaceOrderInputSchema.safeParse({ ...order(), instrumentKey: "nse_fo|nifty" }).success).toBe(false);
    expect(PlaceOrderInputSchema.safeParse({ ...order(), extra: 1 }).success).toBe(false);
  });

  it("requires a modification to change something", () => {
    expect(ModifyOrderInputSchema.safeParse({ brokerOrderId: "1" }).success).toBe(false);
    expect(ModifyOrderInputSchema.safeParse({ brokerOrderId: "1", qty: 75 }).success).toBe(true);
    expect(ModifyOrderInputSchema.safeParse({ brokerOrderId: "has space", qty: 75 }).success).toBe(false);
  });
});

describe("broker outputs", () => {
  it("keeps instrument rows consistent with their canonical key", () => {
    const [option, equity] = INSTRUMENTS;
    expect(InstrumentRowSchema.safeParse(option).success).toBe(true);
    expect(InstrumentRowSchema.safeParse(equity).success).toBe(true);
    expect(issues(InstrumentRowSchema.safeParse({ ...option, exchange: "NSE" }))).toEqual([
      "instrumentKey: Key does not match exchange and segment",
    ]);
    expect(
      issues(InstrumentRowSchema.safeParse({ ...option, expiry: "2025-11-27", strike: "24000.0", optionType: "PE" })),
    ).toEqual(["expiry: Must equal the key's expiry", "optionType: Must equal the key's option type"]);
    expect(issues(InstrumentRowSchema.safeParse({ ...option, strike: "24050" }))).toEqual([
      "strike: Must equal the key's strike",
    ]);
    expect(issues(InstrumentRowSchema.safeParse({ ...equity, strike: "1" }))).toEqual([
      "strike: Must equal the key's strike",
    ]);
    expect(InstrumentRowSchema.safeParse({ ...option, instrumentKey: "bad" }).success).toBe(false);
  });

  it("refuses an order filled beyond its quantity", () => {
    const base = {
      brokerOrderId: "1",
      instrumentKey: NIFTY_CE,
      side: "BUY",
      type: "MARKET",
      product: "INTRADAY",
      validity: "DAY",
      qty: 75,
      filledQty: 75,
      status: "FILLED",
      placedAt: "2025-10-06T09:15:00+05:30",
      updatedAt: "2025-10-06T09:15:01+05:30",
    };
    expect(BrokerOrderSchema.safeParse(base).success).toBe(true);
    expect(issues(BrokerOrderSchema.safeParse({ ...base, filledQty: 76 }))).toEqual(["filledQty: Cannot exceed qty"]);
  });

  it("refuses candles whose open or close lies outside the range", () => {
    const candle = { ts: 0, open: "10", high: "12", low: "9", close: "11", volume: 0 };
    expect(CandleSchema.safeParse(candle).success).toBe(true);
    expect(CandleSchema.safeParse({ ...candle, close: "12.5" }).success).toBe(false);
  });

  it("describes auth starts and ticks", () => {
    expect(AuthStartSchema.safeParse({ mode: "oauth", url: "https://api.upstox.com/v2/login?state=x" }).success).toBe(
      true,
    );
    expect(AuthStartSchema.safeParse({ mode: "oauth", url: "http://insecure.example" }).success).toBe(false);
    expect(
      AuthStartSchema.safeParse({
        mode: "token",
        fields: [{ name: "accessToken", label: "Access token", secret: true }],
      }).success,
    ).toBe(true);
    expect(TickSchema.safeParse({ instrumentKey: NIFTY_CE, ltp: "100.05", ts: 1 }).success).toBe(true);
    expect(TickSchema.safeParse({ instrumentKey: NIFTY_CE, ltp: 100.05, ts: 1 }).success).toBe(false);
  });
});
