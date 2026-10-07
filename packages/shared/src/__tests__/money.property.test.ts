import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DecimalStringSchema, isOnTick, roundToTick, toDecimal, toDecimalString } from "../money";
import type { TickRounding } from "../money";

/** What toDecimalString emits: a wire decimal without trailing fractional zeros, never "-0". */
const CANONICAL_DECIMAL = /^-?(0|[1-9]\d{0,13})(\.\d{0,3}[1-9])?$/;

const canonicalDecimal = fc.stringMatching(CANONICAL_DECIMAL).filter((text) => text !== "-0");

/** Any wire decimal, canonical or not: "1.50", "-0.0", "-0". */
const wireDecimal = fc.stringMatching(/^-?(0|[1-9]\d{0,13})(\.\d{1,4})?$/);

/** Prices with at most 10 integer digits, so rounding up to a tick of at most 1,000 stays within 14. */
const price = fc.stringMatching(/^-?(0|[1-9]\d{0,9})(\.\d{1,4})?$/);

/** Exchange tick sizes, plus any positive 4-decimal tick up to 1,000. */
const tick = fc.oneof(
  fc.constantFrom("0.0025", "0.01", "0.05", "0.1", "0.25", "0.5", "1", "5", "10"),
  fc.integer({ min: 1, max: 10_000_000 }).map((units) => toDecimalString(toDecimal(String(units)).div("10000"))),
);

const mode = fc.constantFrom<TickRounding>("nearest", "down", "up");

const RUNS = { numRuns: 500 };

describe("money properties", () => {
  it("round-trips canonical decimal strings", () => {
    fc.assert(
      fc.property(canonicalDecimal, (text) => {
        expect(DecimalStringSchema.safeParse(text).success).toBe(true);
        expect(toDecimalString(text)).toBe(text);
      }),
      RUNS,
    );
  });

  it("canonicalises any wire decimal without changing its value", () => {
    fc.assert(
      fc.property(wireDecimal, (text) => {
        const canonical = toDecimalString(text);

        expect(canonical).toMatch(CANONICAL_DECIMAL);
        expect(canonical).not.toBe("-0");
        expect(toDecimal(canonical).eq(toDecimal(text))).toBe(true);
      }),
      RUNS,
    );
  });

  it("roundToTick returns a tick multiple", () => {
    fc.assert(
      fc.property(price, tick, mode, (p, t, m) => {
        const rounded = roundToTick(p, t, m);

        expect(isOnTick(rounded, t)).toBe(true);
        expect(rounded).toMatch(CANONICAL_DECIMAL);
      }),
      RUNS,
    );
  });

  it("down ≤ price ≤ up", () => {
    fc.assert(
      fc.property(price, tick, (p, t) => {
        const down = toDecimal(roundToTick(p, t, "down"));
        const up = toDecimal(roundToTick(p, t, "up"));

        expect(down.lte(toDecimal(p))).toBe(true);
        expect(up.gte(toDecimal(p))).toBe(true);
        // Adjacent ticks, or both equal to the price when it is already on a tick.
        expect(up.minus(down).eq(isOnTick(p, t) ? toDecimal("0") : toDecimal(t))).toBe(true);
      }),
      RUNS,
    );
  });

  it("nearest is within half a tick", () => {
    fc.assert(
      fc.property(price, tick, (p, t) => {
        const nearest = toDecimal(roundToTick(p, t, "nearest"));

        expect(nearest.minus(toDecimal(p)).abs().lte(toDecimal(t).div("2"))).toBe(true);
      }),
      RUNS,
    );
  });

  it("is idempotent: a rounded price stays put in every mode", () => {
    fc.assert(
      fc.property(price, tick, mode, mode, (p, t, first, second) => {
        const rounded = roundToTick(p, t, first);

        expect(roundToTick(rounded, t, second)).toBe(rounded);
      }),
      RUNS,
    );
  });
});
