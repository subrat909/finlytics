/**
 * GCRA, the generic cell rate algorithm (plan D7): a token bucket with one number of state per key, the theoretical
 * arrival time (TAT) of the next request. This is the pure TypeScript model; ./gcra.lua.ts runs the same arithmetic
 * atomically in Redis, on the Redis clock. Property tests run against the model, integration tests against the script.
 *
 * Times are integer microseconds. A request of `cost` is admitted when, after it, the TAT is at most `burst` intervals
 * ahead of now:
 *
 *   tat    = max(stored TAT, now)
 *   newTat = tat + interval × cost
 *   allowAt = newTat − interval × burst
 *   admitted ⇔ now ≥ allowAt   (then the stored TAT becomes newTat; a refused request changes nothing)
 */

export interface GcraParams {
  /** Microseconds between two requests in steady state (window / limit). A positive integer. */
  readonly intervalUs: number;
  /** How many requests may arrive at once. A positive integer. */
  readonly burst: number;
  /** What this request costs, in requests: a positive integer, at most `burst` (an order basket costs its legs, 2.1). */
  readonly cost?: number;
}

export interface GcraDecision {
  readonly allowed: boolean;
  /** Requests that would still be admitted right now, after this one. 0 when refused. */
  readonly remaining: number;
  /** Milliseconds until this request would be admitted; 0 when admitted. */
  readonly retryAfterMs: number;
  /** Milliseconds until the bucket is full again (RateLimit `t`). */
  readonly resetAfterMs: number;
}

export interface GcraStep {
  readonly decision: GcraDecision;
  /** The TAT to store: `newTat` when admitted, the stored value (unchanged) when refused. */
  readonly tat: number | undefined;
}

const US_PER_MS = 1_000;

/**
 * Checks a request's cost against its bucket. A cost above the burst could never be admitted, even by a full bucket:
 * the bucket would answer "retry later" forever, so it is a caller's bug (an order basket with more legs than the
 * policy's burst, 2.1) and throws instead.
 *
 * @throws {TypeError} when `cost` isn't a positive integer or exceeds `burst`.
 */
export function assertGcraCost(cost: number, burst: number): void {
  if (!Number.isSafeInteger(cost) || cost < 1) throw new TypeError("A rate-limit cost is a positive integer");
  if (cost > burst) {
    throw new TypeError(
      `A rate-limit cost of ${String(cost)} exceeds the burst of ${String(burst)}: such a request is never admitted`,
    );
  }
}

/**
 * One GCRA step at `nowUs`, given the stored TAT (`undefined`: no key, a full bucket).
 *
 * @throws {TypeError} for a cost that isn't a positive integer or exceeds the burst ({@link assertGcraCost}).
 */
export function gcra(storedTatUs: number | undefined, nowUs: number, params: GcraParams): GcraStep {
  const cost = params.cost ?? 1;
  assertGcraCost(cost, params.burst);
  const tat = storedTatUs !== undefined && storedTatUs > nowUs ? storedTatUs : nowUs;
  const newTat = tat + params.intervalUs * cost;
  const allowAt = newTat - params.intervalUs * params.burst;
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
      remaining: Math.floor((nowUs - allowAt) / params.intervalUs),
      retryAfterMs: 0,
      resetAfterMs: Math.ceil((newTat - nowUs) / US_PER_MS),
    },
    tat: newTat,
  };
}
