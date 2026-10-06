/**
 * Properties of the GCRA model (plan §7). The Lua script runs the same arithmetic; its behaviour against a real Redis is
 * checked in test/integration/rate-limit.int.test.ts.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { gcra } from "../gcra";
import type { GcraParams } from "../gcra";
import { gcraParams, rateLimitPolicies } from "../policies";

const US_PER_MS = 1_000;

/** Any bucket shape: one request every 1 µs to 100 s, bursts of 1 to 500. */
const paramsArb = fc.record({
  intervalUs: fc.integer({ min: 1, max: 100_000_000 }),
  burst: fc.integer({ min: 1, max: 500 }),
});

/** A clock around today, in µs. */
const nowArb = fc.integer({ min: 1_700_000_000_000_000, max: 1_800_000_000_000_000 });

/** Runs requests at the given instants (µs, non-decreasing) from an empty key; returns each decision. */
function run(params: GcraParams, instants: readonly number[], startTat?: number) {
  let tat = startTat;
  return instants.map((now) => {
    const step = gcra(tat, now, params);
    tat = step.tat;
    return step.decision;
  });
}

describe("GCRA model", () => {
  it("never admits more than the burst at one instant", () => {
    fc.assert(
      fc.property(
        paramsArb,
        nowArb,
        fc.integer({ min: 1, max: 1_200 }),
        fc.option(fc.integer({ min: -10_000_000_000, max: 10_000_000_000 })),
        (params, now, requests, tatOffset) => {
          const decisions = run(
            params,
            Array.from({ length: requests }, () => now),
            tatOffset === null ? undefined : now + tatOffset,
          );
          const admitted = decisions.filter((decision) => decision.allowed).length;

          expect(admitted).toBeLessThanOrEqual(params.burst);
          if (tatOffset === null) expect(admitted).toBe(Math.min(requests, params.burst));
        },
      ),
    );
  });

  it("admits the limit per period in steady state", () => {
    fc.assert(
      fc.property(paramsArb, nowArb, fc.integer({ min: 1, max: 2_000 }), (params, start, requests) => {
        // One request every interval, forever: every one is admitted, and the bucket stays full but one.
        const decisions = run(
          params,
          Array.from({ length: requests }, (_, index) => start + index * params.intervalUs),
        );

        expect(decisions.every((decision) => decision.allowed)).toBe(true);
        expect(decisions.every((decision) => decision.remaining === params.burst - 1)).toBe(true);
      }),
    );
  });

  it("admits at most the burst plus one request per interval over any period", () => {
    fc.assert(
      fc.property(
        paramsArb,
        nowArb,
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 300 }),
        (params, start, gaps) => {
          let now = start;
          const instants = gaps.map((gap) => (now += gap));
          const admitted = run(params, instants).filter((decision) => decision.allowed).length;
          const period = (instants.at(-1) ?? start) - (instants[0] ?? start);

          expect(admitted).toBeLessThanOrEqual(params.burst + Math.floor(period / params.intervalUs));
        },
      ),
    );
  });

  it("reports retry-after as the exact wait until the next admission", () => {
    fc.assert(
      fc.property(paramsArb, nowArb, fc.integer({ min: 0, max: 50 }), (params, now, extra) => {
        // Empty the bucket, then ask again: refused, and admitted exactly retryAfterMs later, not a millisecond sooner.
        let tat: number | undefined;
        for (let index = 0; index < params.burst + extra; index += 1) tat = gcra(tat, now, params).tat;
        const refused = gcra(tat, now, params);

        expect(refused.decision.allowed).toBe(false);
        expect(refused.decision.remaining).toBe(0);
        expect(refused.tat).toBe(tat);
        const wait = refused.decision.retryAfterMs;
        expect(wait).toBeGreaterThanOrEqual(1);
        expect(gcra(tat, now + wait * US_PER_MS, params).decision.allowed).toBe(true);
        expect(gcra(tat, now + (wait - 1) * US_PER_MS, params).decision.allowed).toBe(false);
      }),
    );
  });

  it("counts remaining down to zero within a burst", () => {
    fc.assert(
      fc.property(paramsArb, nowArb, (params, now) => {
        const decisions = run(
          params,
          Array.from({ length: params.burst + 1 }, () => now),
        );

        expect(decisions.map((decision) => decision.remaining)).toEqual([
          ...Array.from({ length: params.burst }, (_, index) => params.burst - 1 - index),
          0,
        ]);
        expect(decisions.at(-1)?.allowed).toBe(false);
      }),
    );
  });

  it("reports the time until the bucket is full again", () => {
    fc.assert(
      fc.property(paramsArb, nowArb, fc.integer({ min: 1, max: 50 }), (params, now, requests) => {
        const decisions = run(
          params,
          Array.from({ length: Math.min(requests, params.burst) }, () => now),
        );

        decisions.forEach((decision, index) => {
          expect(decision.resetAfterMs).toBe(Math.ceil(((index + 1) * params.intervalUs) / US_PER_MS));
        });
      }),
    );
  });

  it("charges a request's cost in one step", () => {
    const params = { intervalUs: 1_000_000, burst: 10 };

    expect(gcra(undefined, 0, { ...params, cost: 4 }).decision).toMatchObject({ allowed: true, remaining: 6 });
    expect(gcra(undefined, 0, { ...params, cost: 10 }).decision).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("rejects a cost above the burst, which no bucket could ever admit", () => {
    fc.assert(
      fc.property(paramsArb, nowArb, fc.integer({ min: 1, max: 1_000 }), (params, now, excess) => {
        expect(() => gcra(undefined, now, { ...params, cost: params.burst + excess })).toThrow(TypeError);
      }),
    );
    for (const cost of [0, -1, 1.5, Number.NaN]) {
      expect(() => gcra(undefined, 0, { intervalUs: 1, burst: 10, cost }), String(cost)).toThrow(TypeError);
    }
  });

  it("keeps the configured limits on whole-microsecond intervals", () => {
    const policies = rateLimitPolicies({ publicPerMinute: 100, userPerMinute: 7 });

    expect(gcraParams(policies.public)).toEqual({ intervalUs: 600_000, burst: 100 });
    expect(gcraParams(policies.publicNet)).toEqual({ intervalUs: 30_000, burst: 2_000 });
    expect(gcraParams(policies.user)).toEqual({ intervalUs: 8_571_429, burst: 7 });
    expect(gcraParams(policies.orders)).toEqual({ intervalUs: 100_000, burst: 10 });
  });
});
