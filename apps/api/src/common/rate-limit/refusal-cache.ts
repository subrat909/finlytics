/**
 * What this pod already knows about empty anonymous buckets (plan D9, security review M1): a small, bounded map from a
 * bucket to the moment it next admits a request. SessionGuard consults it BEFORE looking a session cookie up, so a
 * client whose address is refused can't buy a database lookup with a random, well-formed cookie; RateLimitGuard
 * consults it before calling Redis.
 *
 * Why a per-pod map and not a read-only "peek" script in Redis: the map costs nothing on the hot path (a Map lookup;
 * no extra Redis round trip for every signed-in request, which carries a cookie too), and it never refuses a request
 * the shared bucket would admit, because it only ever learns from the bucket's own answers:
 * - a refusal: blocked until the bucket's Retry-After;
 * - an admission that emptied the bucket (`remaining` 0): blocked until the next request would be admitted, derived
 *   from the GCRA parameters. So once a bucket is empty, the next request is refused here, without a lookup.
 * The block always ends no later than the bucket would admit again (rounding errs early by under a millisecond).
 * Each pod learns separately: across N pods, an empty bucket costs at most N extra lookups per refill interval.
 *
 * Bounded: at most `maxEntries` buckets. Over that, expired entries go first, then the oldest, down to 90% of the cap,
 * so a flood of distinct addresses costs O(1) amortised per insert and a fixed amount of memory.
 */
import type { RateLimitDecision } from "./headers";
import { gcraParams } from "./policies";

/** The default bound: ~10 000 buckets, about a megabyte. */
export const REFUSAL_CACHE_MAX_ENTRIES = 10_000;

const US_PER_MS = 1_000;

interface Refusal {
  readonly decision: RateLimitDecision;
  /** Until when (on the cache's clock, ms) the bucket refuses for certain. */
  readonly blockedUntil: number;
  /** When the next request would be admitted, at the latest: the 429's Retry-After. */
  readonly retryAt: number;
  /** When the bucket is full again: the RateLimit `t`. */
  readonly resetAt: number;
}

/** How long, from now, a bucket that gave `decision` refuses for certain, and when it admits again at the latest. */
export function refusalWindow(decision: RateLimitDecision): { blockMs: number; retryMs: number } | undefined {
  if (!decision.allowed) {
    // retryAfterMs is the wait rounded UP to a millisecond: the true wait is over retryAfterMs − 1.
    return decision.retryAfterMs > 1
      ? { blockMs: decision.retryAfterMs - 1, retryMs: decision.retryAfterMs }
      : undefined;
  }
  if (decision.remaining > 0) return undefined;
  // Admitted with nothing left: the next request is admitted once the TAT is within (burst − 1) intervals of now.
  // resetAfterMs is (TAT − now) rounded UP to a millisecond, so this overestimates the wait by under 1 ms.
  const { intervalUs, burst } = gcraParams(decision.policy);
  const upperUs = decision.resetAfterMs * US_PER_MS - (burst - 1) * intervalUs;
  const blockMs = Math.floor((upperUs - US_PER_MS) / US_PER_MS);
  return blockMs > 0 ? { blockMs, retryMs: Math.ceil(upperUs / US_PER_MS) } : undefined;
}

export class RefusalCache {
  private readonly entries = new Map<string, Refusal>();

  constructor(
    private readonly maxEntries: number = REFUSAL_CACHE_MAX_ENTRIES,
    /** A monotonic clock in milliseconds. */
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("RefusalCache: maxEntries must be a positive integer");
    }
  }

  /** How many buckets the cache holds (expired ones included until they are swept). */
  get size(): number {
    return this.entries.size;
  }

  /** The refusal `key`'s bucket would give right now, if this pod knows it is empty; otherwise undefined. */
  get(key: string): RateLimitDecision | undefined {
    const refusal = this.entries.get(key);
    if (refusal === undefined) return undefined;
    const now = this.now();
    if (now >= refusal.blockedUntil) {
      this.entries.delete(key);
      return undefined;
    }
    return {
      ...refusal.decision,
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1, Math.ceil(refusal.retryAt - now)),
      resetAfterMs: Math.max(0, Math.ceil(refusal.resetAt - now)),
    };
  }

  /** Learns from the bucket's answer for `key`: blocks it while it is empty, forgets it once it has room. */
  record(key: string, decision: RateLimitDecision): void {
    const window = refusalWindow(decision);
    // Delete first, so a refreshed entry moves to the end: Map iteration order is the eviction order.
    this.entries.delete(key);
    if (window === undefined) return;
    const now = this.now();
    this.entries.set(key, {
      decision,
      blockedUntil: now + window.blockMs,
      retryAt: now + window.retryMs,
      resetAt: now + decision.resetAfterMs,
    });
    if (this.entries.size > this.maxEntries) this.evict(now);
  }

  /** Drops expired entries, then the oldest, down to 90% of the cap. */
  private evict(now: number): void {
    for (const [key, refusal] of this.entries) {
      if (now >= refusal.blockedUntil) this.entries.delete(key);
    }
    const target = Math.max(1, Math.floor(this.maxEntries * 0.9));
    for (const key of this.entries.keys()) {
      if (this.entries.size <= target) break;
      this.entries.delete(key);
    }
  }
}
