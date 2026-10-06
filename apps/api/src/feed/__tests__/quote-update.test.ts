import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import {
  changeOf,
  decodeQuoteUpdate,
  encodeQuoteUpdate,
  quoteFromHash,
  quoteHashFields,
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
    expect(toQuoteRow(update)).toEqual([KEY, "101", "1", "1", 9, 5]);
    expect(toQuoteUpdate({ instrumentKey: KEY, ltp: "1", ts: 1 })).toEqual({
      k: KEY,
      ltp: "1",
      chg: "0",
      chgPct: "0",
      vol: 0,
      ts: 1,
    });
  });

  it("round-trips through JSON and rejects anything else", () => {
    const update = toQuoteUpdate({ instrumentKey: KEY, ltp: "1", ts: 1 });
    expect(decodeQuoteUpdate(encodeQuoteUpdate(update))).toEqual(update);
    expect(decodeQuoteUpdate("not json")).toBeUndefined();
    expect(decodeQuoteUpdate(JSON.stringify({ k: "bad", ltp: "1" }))).toBeUndefined();
  });

  it("reads a stored quote hash back, or nothing when it is incomplete", () => {
    expect(quoteFromHash(KEY, { ltp: "1", ts: "5", vol: "2", close: "1" })).toMatchObject({ k: KEY, ltp: "1", ts: 5 });
    expect(quoteFromHash(KEY, { ltp: "1" })).toBeUndefined();
    expect(quoteFromHash(KEY, {})).toBeUndefined();
  });
});
