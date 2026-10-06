/**
 * Per-broker request budgets (plan B6, B7). Each broker account has one bucket per request class; a bucket is
 * `{ ratePerSec, burst }`: `burst` requests may go at once, then `ratePerSec` steadily. In any one-second window a
 * bucket admits at most `burst + ratePerSec − 1` requests, which is what the defaults below are sized against.
 *
 * Sources (re-read 2026-10-06):
 * - Upstox (per API, per user): orders 10/s for algos not registered with SEBI (50/s registered), 500/min, 2000/30 min;
 *   other APIs 50/s, 500/min, 2000/30 min. broker.md: enforce 25/s. https://upstox.com/developer/api-documentation/rate-limiting/
 * - Dhan: orders 10/s, 250/min, 1000/h, 7000/day (and 25 modifications per order); data APIs 5/s, 100000/day; quote
 *   APIs 1/s; non-trading APIs 20/s. https://dhanhq.co/docs/v2/
 *
 * Only the per-second limits are enforced here; longer windows surface as the broker's 429 → RateLimitedError
 * (plan carry-forward 2).
 */
import type { BrokerCode } from "@finlytics/shared";

import type { BrokerMethod } from "../adapter";

/** Request classes with separate budgets. */
export const RATE_CLASSES = Object.freeze(["orders", "data", "standard"] as const);
export type RateClass = (typeof RATE_CLASSES)[number];

/** A token bucket: `burst` at once, then `ratePerSec` per second. */
export interface RateLimit {
  /** Sustained requests per second: positive, at most 1,000,000 (fractions allowed: 0.5 = one every 2 s). */
  readonly ratePerSec: number;
  /** Requests admitted at once from a full bucket: a positive integer. */
  readonly burst: number;
}

export type BrokerRateLimits = Readonly<Record<RateClass, RateLimit>>;

/** The class each adapter method is charged to. */
export function rateClassOf(method: BrokerMethod): RateClass {
  switch (method) {
    case "placeOrder":
    case "modifyOrder":
    case "cancelOrder":
      return "orders";
    case "getHistoricalCandles":
      return "data";
    default:
      return "standard";
  }
}

const UNTUNED: BrokerRateLimits = Object.freeze({
  orders: Object.freeze({ ratePerSec: 5, burst: 5 }),
  data: Object.freeze({ ratePerSec: 5, burst: 5 }),
  standard: Object.freeze({ ratePerSec: 5, burst: 5 }),
});

/**
 * Defaults per broker. Brokers without an adapter yet get a conservative 5/s until their adapter is built from the
 * official docs.
 */
export const DEFAULT_BROKER_RATE_LIMITS: Readonly<Record<BrokerCode, BrokerRateLimits>> = Object.freeze({
  UPSTOX: Object.freeze({
    // ≤ 10/s: the limit for algos not registered with SEBI.
    orders: Object.freeze({ ratePerSec: 8, burst: 3 }),
    // Historical candles are a standard API at Upstox.
    data: Object.freeze({ ratePerSec: 25, burst: 10 }),
    // broker.md: 25/s; ≤ 34 in any second against Upstox's 50/s.
    standard: Object.freeze({ ratePerSec: 25, burst: 10 }),
  }),
  DHAN: Object.freeze({
    orders: Object.freeze({ ratePerSec: 8, burst: 3 }),
    data: Object.freeze({ ratePerSec: 4, burst: 2 }),
    standard: Object.freeze({ ratePerSec: 15, burst: 5 }),
  }),
  ZERODHA: UNTUNED,
  ANGELONE: UNTUNED,
  FYERS: UNTUNED,
  SHOONYA: UNTUNED,
  // No broker behind it; the bucket only keeps a runaway strategy from spinning.
  PAPER: Object.freeze({
    orders: Object.freeze({ ratePerSec: 100, burst: 100 }),
    data: Object.freeze({ ratePerSec: 100, burst: 100 }),
    standard: Object.freeze({ ratePerSec: 100, burst: 100 }),
  }),
});

/** Partial overrides, e.g. from configuration: `{ UPSTOX: { orders: { ratePerSec: 40, burst: 10 } } }`. */
export type RateLimitOverrides = Partial<Record<BrokerCode, Partial<Record<RateClass, RateLimit>>>>;

/**
 * The limit for one broker and class, with overrides applied.
 *
 * @throws {RangeError} for an invalid limit ({@link assertRateLimit}).
 */
export function resolveRateLimit(
  broker: BrokerCode,
  rateClass: RateClass,
  overrides: RateLimitOverrides = {},
): RateLimit {
  const limit = overrides[broker]?.[rateClass] ?? DEFAULT_BROKER_RATE_LIMITS[broker][rateClass];
  assertRateLimit(limit);
  return limit;
}

/** @throws {RangeError} unless 0 < ratePerSec ≤ 1e6 and burst is a positive integer. */
export function assertRateLimit(limit: RateLimit): void {
  if (!Number.isFinite(limit.ratePerSec) || limit.ratePerSec <= 0 || limit.ratePerSec > 1_000_000) {
    throw new RangeError("ratePerSec must be a number in (0, 1000000]");
  }
  if (!Number.isSafeInteger(limit.burst) || limit.burst < 1) throw new RangeError("burst must be a positive integer");
}
