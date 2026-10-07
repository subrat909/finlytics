import { describe, expect, it } from "vitest";

import {
  RT_MAX_KEYS_PER_MESSAGE,
  RtDepthAckSchema,
  RtDepthSchema,
  RtDepthSubscribeSchema,
  RtQuoteBatchSchema,
  RtStatusSchema,
  RtSubscribeAckSchema,
  RtSubscribeSchema,
} from "../schemas/realtime";

describe("realtime schemas", () => {
  it("accepts a subscribe message with raw keys, checked one by one later", () => {
    expect(RtSubscribeSchema.safeParse({ keys: ["NSE_EQ|RELIANCE", "not a key"] }).success).toBe(true);
  });

  it("rejects empty, oversized and extra-field subscribe messages", () => {
    expect(RtSubscribeSchema.safeParse({ keys: [] }).success).toBe(false);
    const tooMany = Array.from({ length: RT_MAX_KEYS_PER_MESSAGE + 1 }, () => "NSE_EQ|RELIANCE");
    expect(RtSubscribeSchema.safeParse({ keys: tooMany }).success).toBe(false);
    expect(RtSubscribeSchema.safeParse({ keys: ["NSE_EQ|RELIANCE"], extra: 1 }).success).toBe(false);
  });

  it("describes acks, quote batches and status", () => {
    expect(
      RtSubscribeAckSchema.safeParse({ ok: ["NSE_EQ|RELIANCE"], rejected: [{ key: "x", reason: "invalid_key" }] })
        .success,
    ).toBe(true);
    const row = [
      "NSE_EQ|RELIANCE",
      "2500.05",
      "-1.5",
      "-0.06",
      10,
      1,
      "2490",
      "2510",
      "2480.5",
      "2501.55",
      null,
      "2498",
    ];
    expect(RtQuoteBatchSchema.safeParse({ t: 1, d: [row] }).success).toBe(true);
    expect(RtQuoteBatchSchema.safeParse({ t: 1, d: [row.slice(0, 6)] }).success).toBe(false);
    expect(
      RtQuoteBatchSchema.safeParse({
        t: 1,
        d: [["NSE_INDEX|NIFTY 50", "25000", "0", "0", 0, 1, null, null, null, null, null, null]],
      }).success,
    ).toBe(true);
    expect(RtStatusSchema.safeParse({ feed: "stale", source: "UPSTOX", live: true }).success).toBe(true);
    expect(RtStatusSchema.safeParse({ feed: "stale" }).success).toBe(false);
    expect(RtStatusSchema.safeParse({ feed: "gone", source: "PAPER", live: false }).success).toBe(false);
  });

  it("describes depth subscriptions and snapshots", () => {
    expect(RtDepthSubscribeSchema.safeParse({ key: "NSE_EQ|RELIANCE" }).success).toBe(true);
    expect(RtDepthSubscribeSchema.safeParse({ key: "NSE_EQ|RELIANCE", extra: 1 }).success).toBe(false);
    expect(RtDepthAckSchema.safeParse({ ok: false, reason: "limit" }).success).toBe(true);
    const depth = {
      k: "NSE_EQ|RELIANCE",
      t: 1,
      bids: [["2500", 10, 2]],
      asks: [["2500.5", 5, 0]],
      tbq: null,
      tsq: 1200,
    };
    expect(RtDepthSchema.safeParse(depth).success).toBe(true);
    expect(RtDepthSchema.safeParse({ ...depth, bids: [["-1", 1, 1]] }).success).toBe(false);
  });
});
