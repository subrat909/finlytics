import { describe, expect, it } from "vitest";

import { formatRateLimit, formatRateLimitPolicy, retryAfterSeconds } from "../headers";
import type { RateLimitDecision } from "../headers";
import { rateLimitPolicies } from "../policies";

const POLICIES = rateLimitPolicies({ publicPerMinute: 100, userPerMinute: 600 });

const decision = (overrides: Partial<RateLimitDecision> = {}): RateLimitDecision => ({
  policy: POLICIES.user,
  allowed: true,
  remaining: 599,
  retryAfterMs: 0,
  resetAfterMs: 100,
  ...overrides,
});

describe("rate-limit headers", () => {
  it("formats RateLimit and RateLimit-Policy per draft-11 without a partition key", () => {
    expect(formatRateLimitPolicy([POLICIES.user])).toBe('"user";q=600;w=60');
    expect(formatRateLimit([decision()])).toBe('"user";r=599;t=1');

    const orders = decision({ policy: POLICIES.orders, remaining: 0, allowed: false, resetAfterMs: 1_000 });
    expect(formatRateLimitPolicy([POLICIES.user, POLICIES.orders])).toBe('"user";q=600;w=60, "orders";q=10;w=1');
    expect(formatRateLimit([decision(), orders])).toBe('"user";r=599;t=1, "orders";r=0;t=1');
    expect(formatRateLimitPolicy([POLICIES.public])).toBe('"public";q=100;w=60');

    for (const header of [formatRateLimitPolicy(Object.values(POLICIES)), formatRateLimit([decision(), orders])]) {
      expect(header).not.toMatch(/pk=|\bip\b|u1/);
    }
  });

  it("rounds the reset time up to whole seconds and never reports negatives", () => {
    expect(formatRateLimit([decision({ resetAfterMs: 0 })])).toBe('"user";r=599;t=0');
    expect(formatRateLimit([decision({ resetAfterMs: 1_001 })])).toBe('"user";r=599;t=2');
    expect(formatRateLimit([decision({ remaining: -1, resetAfterMs: -5 })])).toBe('"user";r=0;t=0');
  });

  it("waits the longest refusal, in whole seconds, at least one", () => {
    expect(retryAfterSeconds([decision({ allowed: false, retryAfterMs: 600 })])).toBe(1);
    expect(
      retryAfterSeconds([
        decision({ allowed: false, retryAfterMs: 1_200 }),
        decision({ allowed: false, retryAfterMs: 59_001 }),
      ]),
    ).toBe(60);
    expect(retryAfterSeconds([decision({ allowed: false, retryAfterMs: 0 })])).toBe(1);
  });

  it("refuses a policy name that isn't a plain token", () => {
    const odd = { ...POLICIES.user, name: 'user";pk=1' } as unknown as typeof POLICIES.user;

    expect(() => formatRateLimitPolicy([odd])).toThrow(TypeError);
  });
});
