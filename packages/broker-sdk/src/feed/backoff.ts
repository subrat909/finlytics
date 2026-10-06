/**
 * Reconnect delays for broker feeds (plan B12): exponential, capped, with "equal jitter" (half fixed, half random), so
 * a fleet of standbys doesn't reconnect in lockstep after a broker outage and a single process still backs off.
 */

export interface BackoffOptions {
  /** The first delay before jitter (default 500 ms). */
  readonly baseMs?: number;
  /** The cap before jitter (default 30 s). */
  readonly maxMs?: number;
  /** A random source in [0, 1) (tests pass a fixed one). */
  readonly random?: () => number;
}

/**
 * The delay before reconnect attempt `attempt` (1-based): `min(maxMs, baseMs × 2^(attempt−1))`, of which the upper half
 * is random. Always within [cap/2, cap].
 *
 * @throws {RangeError} for an attempt that isn't a positive integer, or non-positive bounds.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs = 500, maxMs = 30_000, random = Math.random } = options;
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError("attempt must be a positive integer");
  if (!(baseMs > 0) || !(maxMs >= baseMs)) throw new RangeError("Expected 0 < baseMs ≤ maxMs");
  // 2^40 already exceeds any sane cap; bounding the exponent keeps the arithmetic finite.
  const cap = Math.min(maxMs, baseMs * 2 ** Math.min(attempt - 1, 40));
  return Math.round(cap / 2 + random() * (cap / 2));
}
