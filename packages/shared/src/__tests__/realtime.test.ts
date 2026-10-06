import { describe, expect, it } from "vitest";

import {
  RT_MAX_KEYS_PER_MESSAGE,
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
    expect(
      RtQuoteBatchSchema.safeParse({ t: 1, d: [["NSE_EQ|RELIANCE", "2500.05", "-1.5", "-0.06", 10, 1]] }).success,
    ).toBe(true);
    expect(RtStatusSchema.safeParse({ feed: "stale" }).success).toBe(true);
    expect(RtStatusSchema.safeParse({ feed: "gone" }).success).toBe(false);
  });
});
