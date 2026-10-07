import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import {
  changeOf,
  decodeDepth,
  decodeQuoteUpdate,
  encodeQuoteUpdate,
  quoteFromHash,
  quoteHashFields,
  toDepth,
  toQuoteRow,
  toQuoteUpdate,
} from "../quote-update";

const KEY = "NSE_EQ|RELIANCE" as InstrumentKey;

describe("quote updates", () => {
  it("computes change and change % exactly, and zero without a close", () => {
    expect(changeOf("2510.5", "2500")).toEqual({ chg: "10.5", chgPct: "0.42" });
    expect(changeOf("2490", "2500")).toEqual({ chg: "-10", chgPct: "-0.4" });
    expect(changeOf("10", undefined)).toEqual({ chg: "0", chgPct: "0" });
    expect(changeOf("10", "0")).toEqual({ chg: "0", chgPct: "0" });
  });

  it("maps a tick to an update, hash fields and a row", () => {
    const update = toQuoteUpdate({
      instrumentKey: KEY,
      ltp: "101",
      close: "100",
      ts: 5,
      volume: 9,
      oi: 3,
      bid: "100.95",
      ask: "101.05",
    });

    expect(update).toEqual({
      k: KEY,
      ltp: "101",
      chg: "1",
      chgPct: "1",
      vol: 9,
      ts: 5,
      close: "100",
      oi: 3,
      bid: "100.95",
      ask: "101.05",
    });
    expect(quoteHashFields(update)).toEqual({
      ltp: "101",
      chg: "1",
      chgPct: "1",
      vol: "9",
      ts: "5",
      close: "100",
      oi: "3",
      bid: "100.95",
      ask: "101.05",
    });
    expect(toQuoteRow(update)).toEqual([KEY, "101", "1", "1", 9, 5, null, null, null, "100", 3, null]);
    // No volume on the tick (ltp mode): none in the update or the hash, so the stored day volume stays.
    const bare = toQuoteUpdate({ instrumentKey: KEY, ltp: "1", ts: 1 });
    expect(bare).toEqual({ k: KEY, ltp: "1", chg: "0", chgPct: "0", ts: 1 });
    expect(quoteHashFields(bare, "UPSTOX")).toEqual({ ltp: "1", chg: "0", chgPct: "0", ts: "1", src: "UPSTOX" });
    expect(toQuoteRow(bare)).toEqual([KEY, "1", "0", "0", 0, 1, null, null, null, null, null, null]);
  });

  it("carries the day's prices, ATP and quantities into the hash and the 12-tuple row", () => {
    const update = toQuoteUpdate({
      instrumentKey: KEY,
      ltp: "101",
      close: "100",
      open: "99.5",
      high: "102",
      low: "99",
      atp: "100.75",
      ts: 5,
      volume: 9,
      bidQty: 4,
      askQty: 6,
      ltq: 2,
    });
    expect(quoteHashFields(update)).toMatchObject({
      open: "99.5",
      high: "102",
      low: "99",
      atp: "100.75",
      bidQty: "4",
      askQty: "6",
      ltq: "2",
    });
    expect(toQuoteRow(update)).toEqual([KEY, "101", "1", "1", 9, 5, "99.5", "102", "99", "100", null, "100.75"]);
    expect(quoteFromHash(KEY, quoteHashFields(update, "PAPER"))).toEqual(update);
  });

  it("turns a tick's book into an RtDepth, with the totals when the broker sends them", () => {
    const tick = {
      instrumentKey: KEY,
      ltp: "101",
      ts: 5,
      depth: { bids: [{ price: "100.95", qty: 3, orders: 2 }], asks: [{ price: "101.05", qty: 1 }] },
      tbq: 50,
    };
    const depth = toDepth(tick);
    expect(depth).toEqual({ k: KEY, t: 5, bids: [["100.95", 3, 2]], asks: [["101.05", 1, 0]], tbq: 50, tsq: null });
    expect(toDepth({ instrumentKey: KEY, ltp: "1", ts: 1 })).toBeUndefined();
    expect(toDepth({ ...tick, depth: { bids: [{ price: "-1", qty: 1 }], asks: [] } })).toBeUndefined();
    expect(decodeDepth(JSON.stringify(depth))).toEqual(depth);
    expect(decodeDepth(null)).toBeUndefined();
    expect(decodeDepth("{")).toBeUndefined();
    expect(decodeDepth("{}")).toBeUndefined();
  });

  it("round-trips through JSON and rejects anything else", () => {
    const update = toQuoteUpdate({ instrumentKey: KEY, ltp: "1", ts: 1 });
    expect(decodeQuoteUpdate(encodeQuoteUpdate(update))).toEqual(update);
    expect(decodeQuoteUpdate("not json")).toBeUndefined();
    expect(decodeQuoteUpdate(JSON.stringify({ k: "bad", ltp: "1" }))).toBeUndefined();
  });

  it("reads a stored quote hash back, or nothing when it is incomplete", () => {
    expect(quoteFromHash(KEY, { ltp: "1", ts: "5", vol: "2", close: "1" })).toMatchObject({ k: KEY, ltp: "1", ts: 5 });
    expect(quoteFromHash(KEY, { ltp: "1", ts: "5", high: "bad", oi: "-1" })).toEqual({
      k: KEY,
      ltp: "1",
      chg: "0",
      chgPct: "0",
      ts: 5,
    });
    expect(quoteFromHash(KEY, { ltp: "x", ts: "5" })).toBeUndefined();
    expect(quoteFromHash(KEY, { ltp: "1" })).toBeUndefined();
    expect(quoteFromHash(KEY, {})).toBeUndefined();
  });
});
