/**
 * GCRA against the textbook token bucket (plan B6): a bucket of `burst` tokens refilled continuously at one token per
 * interval, a request of `cost` admitted iff the bucket holds `cost` tokens. Tokens are counted in microseconds of
 * "credit" (one token = one interval), so the model is exact integer arithmetic too.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { assertCost, gcra, gcraParams } from "../gcra";
import type { GcraParams } from "../gcra";

class TokenBucket {
  #creditUs: number;
  #lastUs: number;

  constructor(
    private readonly params: Omit<GcraParams, "cost">,
    startUs: number,
  ) {
    this.#creditUs = params.intervalUs * params.burst;
    this.#lastUs = startUs;
  }

  take(nowUs: number, cost: number): boolean {
    const capacity = this.params.intervalUs * this.params.burst;
    this.#creditUs = Math.min(capacity, this.#creditUs + (nowUs - this.#lastUs));
    this.#lastUs = nowUs;
    if (this.#creditUs < cost * this.params.intervalUs) return false;
    this.#creditUs -= cost * this.params.intervalUs;
    return true;
  }
}

const scenario = fc.record({
  intervalUs: fc.integer({ min: 1, max: 2_000_000 }),
  burst: fc.integer({ min: 1, max: 50 }),
  steps: fc.array(fc.record({ gapUs: fc.integer({ min: 0, max: 3_000_000 }), cost: fc.integer({ min: 1, max: 50 }) }), {
    minLength: 1,
    maxLength: 200,
  }),
});

describe("GCRA", () => {
  it("admits exactly what a token bucket of the same rate and burst admits", () => {
    fc.assert(
      fc.property(scenario, ({ intervalUs, burst, steps }) => {
        const start = 1_700_000_000_000_000;
        const bucket = new TokenBucket({ intervalUs, burst }, start);
        let tat: number | undefined;
        let now = start;
        for (const step of steps) {
          now += step.gapUs;
          const cost = Math.min(step.cost, burst);
          const result = gcra(tat, now, { intervalUs, burst, cost });
          expect(result.decision.allowed).toBe(bucket.take(now, cost));
          tat = result.tat;
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never admits more than burst + elapsed / interval requests", () => {
    fc.assert(
      fc.property(scenario, ({ intervalUs, burst, steps }) => {
        let tat: number | undefined;
        let now = 0;
        let admitted = 0;
        for (const step of steps) {
          now += step.gapUs;
          const result = gcra(tat, now, { intervalUs, burst, cost: 1 });
          if (result.decision.allowed) admitted += 1;
          tat = result.tat;
        }
        expect(admitted).toBeLessThanOrEqual(burst + Math.floor(now / intervalUs));
      }),
    );
  });

  it("is admitted exactly at its retry-after time and refused just before it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000, max: 1_000_000 }), fc.integer({ min: 1, max: 20 }), (intervalUs, burst) => {
        let tat: number | undefined;
        for (let index = 0; index < burst; index += 1) tat = gcra(tat, 0, { intervalUs, burst, cost: 1 }).tat;
        const refused = gcra(tat, 0, { intervalUs, burst, cost: 1 });
        expect(refused.decision).toMatchObject({ allowed: false, remaining: 0 });
        expect(refused.tat).toBe(tat);
        const retryUs = refused.decision.retryAfterMs * 1_000;
        expect(gcra(tat, retryUs, { intervalUs, burst, cost: 1 }).decision.allowed).toBe(true);
        expect(gcra(tat, intervalUs - 1, { intervalUs, burst, cost: 1 }).decision.allowed).toBe(false);
      }),
    );
  });

  it("reports what is left and when the bucket is full again", () => {
    const first = gcra(undefined, 0, { intervalUs: 100_000, burst: 3, cost: 1 });
    expect(first.decision).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0, resetAfterMs: 100 });
  });

  it("derives the interval from the rate and checks the cost", () => {
    expect(gcraParams({ ratePerSec: 25, burst: 10 })).toEqual({ intervalUs: 40_000, burst: 10, cost: 1 });
    expect(gcraParams({ ratePerSec: 1 / 3, burst: 1 }).intervalUs).toBe(3_000_000);
    expect(gcraParams({ ratePerSec: 1_000_000, burst: 1 }).intervalUs).toBe(1);
    expect(() => {
      assertCost(0, 5);
    }).toThrow(TypeError);
    expect(() => {
      assertCost(1.5, 5);
    }).toThrow(TypeError);
    expect(() => {
      assertCost(6, 5);
    }).toThrow(/never be admitted/);
  });
});
