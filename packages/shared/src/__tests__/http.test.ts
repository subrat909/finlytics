import { describe, expect, it } from "vitest";

import { REQUEST_ID_PATTERN } from "../schemas/errors";
import { HEADERS, IdempotencyKeySchema, RequestIdSchema } from "../schemas/http";

function isIdempotencyKey(value: unknown): boolean {
  return IdempotencyKeySchema.safeParse(value).success;
}

describe("HEADERS", () => {
  it("names every header in lowercase, as Node exposes request headers", () => {
    expect(HEADERS).toEqual({
      requestId: "x-request-id",
      idempotencyKey: "idempotency-key",
      idempotentReplayed: "idempotent-replayed",
      retryAfter: "retry-after",
      rateLimit: "ratelimit",
      rateLimitPolicy: "ratelimit-policy",
    });
    for (const name of Object.values(HEADERS)) expect(name).toBe(name.toLowerCase());
    expect(Object.isFrozen(HEADERS)).toBe(true);
  });
});

describe("IdempotencyKeySchema", () => {
  it("accepts UUIDs as idempotency keys and rejects colons, spaces and 129 characters", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const key = crypto.randomUUID();
      expect(isIdempotencyKey(key), key).toBe(true);
    }
    expect(isIdempotencyKey("a".repeat(16))).toBe(true);
    expect(isIdempotencyKey("A-z_0".repeat(25) + "abc")).toBe(true); // 128 characters

    for (const key of [
      "order:2026-10-06:0001", // ':' separates the segments of the Redis key idem:<userId>:<key>
      "order 2026 10 06 0001",
      "a".repeat(129),
      "a".repeat(15),
      "",
      "order\n2026-10-06-0001",
      "order/2026/10/06/0001",
      "órden-2026-10-06-0001",
    ]) {
      expect(isIdempotencyKey(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("rejects values that are not strings", () => {
    for (const value of [undefined, null, 1234567890123456, ["a".repeat(16)]]) {
      expect(isIdempotencyKey(value)).toBe(false);
    }
  });
});

describe("RequestIdSchema", () => {
  it("applies REQUEST_ID_PATTERN", () => {
    for (const value of ["req_01J9Z6Y3K8", crypto.randomUUID(), "abcdefgh", "-abcdefgh", "abc", "x".repeat(129)]) {
      expect(RequestIdSchema.safeParse(value).success, value).toBe(REQUEST_ID_PATTERN.test(value));
    }
    expect(RequestIdSchema.safeParse(42).success).toBe(false);
  });
});
