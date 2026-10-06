/**
 * The per-pod refusal cache (security review M1). Its one safety property: it never refuses a request the bucket
 * would admit. Checked against the GCRA model (./gcra.ts), which the Lua script mirrors.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { gcra } from "../gcra";
import type { RateLimitDecision } from "../headers";
import { gcraParams, rateLimitPolicies } from "../policies";
import type { RateLimitPolicy } from "../policies";
import { RefusalCache, refusalWindow } from "../refusal-cache";

const US_PER_MS = 1_000;

/** A `public` policy of `limit` per minute, or per `windowSec`. */
function policyOf(limit: number, windowSec = 60): RateLimitPolicy {
  return { ...rateLimitPolicies({ publicPerMinute: limit, userPerMinute: 1 }).public, limit, windowSec };
}

const decision = (policy: RateLimitPolicy, overrides: Partial<RateLimitDecision>): RateLimitDecision => ({
  policy,
  allowed: true,
  remaining: 0,
  retryAfterMs: 0,
  resetAfterMs: 0,
  ...overrides,
});

/** A cache on a clock the test moves. */
function cacheAt(start = 1_000, maxEntries?: number) {
  let now = start;
  const cache = new RefusalCache(maxEntries, () => now);
  return {
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("RefusalCache", () => {
  it("blocks a refused bucket until just before its Retry-After, with the bucket's own headers", () => {
    const policy = policyOf(100);
    const { cache, advance } = cacheAt();

    cache.record(
      "rl:public:ip:203.0.113.7",
      decision(policy, { allowed: false, retryAfterMs: 600, resetAfterMs: 60_000 }),
    );

    expect(cache.get("rl:public:ip:203.0.113.7")).toEqual({
      policy,
      allowed: false,
      remaining: 0,
      retryAfterMs: 600,
      resetAfterMs: 60_000,
    });
    advance(250);
    expect(cache.get("rl:public:ip:203.0.113.7")).toMatchObject({ retryAfterMs: 350, resetAfterMs: 59_750 });
    advance(349);
    expect(cache.get("rl:public:ip:203.0.113.7")).toBeUndefined();
    expect(cache.get("rl:public:ip:203.0.113.8")).toBeUndefined();
  });

  it("blocks a bucket that an admitted request emptied, until the next request would be admitted", () => {
    // 3 per minute: one request every 20 s. The third of a burst empties the bucket for 20 s.
    const policy = policyOf(3);
    const { cache, advance } = cacheAt();

    cache.record("k", decision(policy, { allowed: true, remaining: 1, resetAfterMs: 40_000 }));
    expect(cache.get("k")).toBeUndefined();
    cache.record("k", decision(policy, { allowed: true, remaining: 0, resetAfterMs: 60_000 }));

    expect(cache.get("k")).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 20_000, resetAfterMs: 60_000 });
    advance(19_998);
    expect(cache.get("k")).toMatchObject({ retryAfterMs: 2 });
    advance(1);
    expect(cache.get("k")).toBeUndefined();
  });

  it("forgets a bucket as soon as the bucket says it has room", () => {
    const policy = policyOf(100);
    const { cache } = cacheAt();
    cache.record("k", decision(policy, { allowed: false, retryAfterMs: 600, resetAfterMs: 60_000 }));

    cache.record("k", decision(policy, { allowed: true, remaining: 4, resetAfterMs: 57_000 }));

    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("holds at most maxEntries buckets, dropping expired ones first, then the oldest", () => {
    const policy = policyOf(100);
    const refused = decision(policy, { allowed: false, retryAfterMs: 10_000, resetAfterMs: 60_000 });
    const { cache, advance } = cacheAt(0, 10);

    cache.record("short", decision(policy, { allowed: false, retryAfterMs: 5, resetAfterMs: 60_000 }));
    for (let index = 0; index < 9; index += 1) cache.record(`k${String(index)}`, refused);
    expect(cache.size).toBe(10);
    advance(10);
    cache.record("k9", refused); // over the cap: "short" has expired, then the oldest go, down to 90%

    expect(cache.size).toBe(9);
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("k0")).toBeUndefined();
    for (let index = 1; index <= 9; index += 1) expect(cache.get(`k${String(index)}`), String(index)).toBeDefined();
    expect(() => new RefusalCache(0)).toThrow(RangeError);
  });

  it("keeps nothing for a wait shorter than a millisecond or a bucket with room", () => {
    const policy = policyOf(100);

    expect(refusalWindow(decision(policy, { allowed: false, retryAfterMs: 1 }))).toBeUndefined();
    expect(refusalWindow(decision(policy, { allowed: true, remaining: 3, resetAfterMs: 2_000 }))).toBeUndefined();
    // 1 000 000 per minute: a 60 µs interval empties and refills within a millisecond.
    expect(
      refusalWindow(decision(policyOf(1_000_000), { allowed: true, remaining: 0, resetAfterMs: 60_000 })),
    ).toBeUndefined();
  });

  it("never refuses a request the bucket would admit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 600 }),
        fc.constantFrom(1, 60),
        fc.integer({ min: 1_700_000_000_000_000, max: 1_800_000_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 2_000_000 }), { minLength: 1, maxLength: 120 }),
        fc.array(fc.integer({ min: 0, max: 120_000_000 }), { minLength: 1, maxLength: 20 }),
        (limit, windowSec, start, gaps, probes) => {
          const policy = policyOf(limit, windowSec);
          const params = gcraParams(policy);
          let nowUs = start;
          let tat: number | undefined;
          const cache = new RefusalCache(10, () => nowUs / US_PER_MS);
          for (const gap of gaps) {
            nowUs += gap;
            // A request the cache refuses never reaches the bucket, as in RateLimitService.
            if (cache.get("k") !== undefined) continue;
            const step = gcra(tat, nowUs, params);
            tat = step.tat;
            cache.record("k", { policy, ...step.decision });
          }
          const last = nowUs;
          for (const probe of probes) {
            nowUs = last + probe;
            if (cache.get("k") !== undefined) {
              expect(gcra(tat, nowUs, params).decision.allowed).toBe(false);
            }
          }
        },
      ),
    );
  });

  it("refuses once the bucket is empty, without asking it again", () => {
    // 3 per minute, all at once: the third empties the bucket, so the fourth is refused here.
    const policy = policyOf(3);
    const params = gcraParams(policy);
    const { cache } = cacheAt(0);
    let tat: number | undefined;
    const asked: boolean[] = [];
    for (let request = 0; request < 6; request += 1) {
      if (cache.get("k") !== undefined) {
        asked.push(false);
        continue;
      }
      asked.push(true);
      const step = gcra(tat, 0, params);
      tat = step.tat;
      cache.record("k", { policy, ...step.decision });
    }

    expect(asked).toEqual([true, true, true, false, false, false]);
  });
});
