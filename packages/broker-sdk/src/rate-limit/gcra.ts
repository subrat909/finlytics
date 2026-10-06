/**
 * GCRA, the generic cell rate algorithm (plan B6): a token bucket that stores one number per key, the theoretical
 * arrival time (TAT) of the next request. The same arithmetic as the api's HTTP limiter
 * (apps/api/src/common/rate-limit/gcra.ts, which moves here in 2.1). This is the pure model; ./gcra.lua.ts runs it
 * atomically in Redis on the Redis clock. Property tests compare it with a classic token bucket.
 *
 * Times are integer microseconds. A request of `cost` is admitted when, after it, the TAT is at most `burst` intervals
 * ahead of now:
 *
 *   tat     = max(stored TAT, now)
 *   newTat  = tat + interval × cost
 *   allowAt = newTat − interval × burst
 *   admitted ⇔ now ≥ allowAt   (then the stored TAT becomes newTat; a refused request changes nothing)
 */
import type { RateLimit } from "./limits";

export interface GcraParams {
  /** Microseconds between two requests in steady state. A positive integer. */
  readonly intervalUs: number;
  /** Requests admitted at once from a full bucket. A positive integer. */
  readonly burst: number;
  /** What this request costs, in requests: a positive integer, at most `burst`. */
  readonly cost: number;
}

export interface RateDecision {
  readonly allowed: boolean;
  /** Requests a full-speed caller could still make right now, after this one. 0 when refused. */
  readonly remaining: number;
  /** Milliseconds until this request would be admitted; 0 when admitted. */
  readonly retryAfterMs: number;
  /** Milliseconds until the bucket is full again. */
  readonly resetAfterMs: number;
}

export interface GcraStep {
  readonly decision: RateDecision;
  /** The TAT to store: `newTat` when admitted, the stored value (unchanged) when refused. */
  readonly tat: number | undefined;
}

const US_PER_MS = 1_000;
const US_PER_SECOND = 1_000_000;

/** GCRA parameters for a {@link RateLimit}: the interval is 1 s / rate, rounded to whole microseconds (at least 1). */
export function gcraParams(limit: RateLimit, cost = 1): GcraParams {
  assertCost(cost, limit.burst);
  return { intervalUs: Math.max(1, Math.round(US_PER_SECOND / limit.ratePerSec)), burst: limit.burst, cost };
}

/**
 * @throws {TypeError} when `cost` isn't a positive integer or exceeds `burst`: such a request could never be admitted,
 *   so waiting for it would never end.
 */
export function assertCost(cost: number, burst: number): void {
  if (!Number.isSafeInteger(cost) || cost < 1) throw new TypeError("A rate-limit cost is a positive integer");
  if (cost > burst) {
    throw new TypeError(`A cost of ${String(cost)} exceeds the burst of ${String(burst)}: it would never be admitted`);
  }
}

/** One GCRA step at `nowUs`, given the stored TAT (`undefined`: no key, a full bucket). */
export function gcra(storedTatUs: number | undefined, nowUs: number, params: GcraParams): GcraStep {
  const { intervalUs, burst, cost } = params;
  const tat = storedTatUs !== undefined && storedTatUs > nowUs ? storedTatUs : nowUs;
  const newTat = tat + intervalUs * cost;
  const allowAt = newTat - intervalUs * burst;
  if (nowUs < allowAt) {
    return {
      decision: {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.ceil((allowAt - nowUs) / US_PER_MS),
        resetAfterMs: Math.ceil((tat - nowUs) / US_PER_MS),
      },
      tat: storedTatUs,
    };
  }
  return {
    decision: {
      allowed: true,
      remaining: Math.floor((nowUs - allowAt) / intervalUs),
      retryAfterMs: 0,
      resetAfterMs: Math.ceil((newTat - nowUs) / US_PER_MS),
    },
    tat: newTat,
  };
}
