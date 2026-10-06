/**
 * Buckets in process memory, running the GCRA model (./gcra.ts) directly: for paper trading, tests and the package
 * smoke test. Not shared across processes, so never use it for a real broker in production (use BrokerRateLimiter).
 */
import { gcra } from "./gcra";
import type { GcraParams, RateDecision } from "./gcra";
import { BaseRateLimiter } from "./rate-limiter";
import type { RateLimiterOptions } from "./rate-limiter";

/** Above this many buckets, expired ones are dropped on the next decision. */
const PRUNE_THRESHOLD = 10_000;

export interface MemoryRateLimiterOptions extends RateLimiterOptions {
  /** Microseconds clock for the buckets (default: from Date.now). */
  readonly nowUs?: (() => number) | undefined;
}

export class MemoryRateLimiter extends BaseRateLimiter {
  readonly #tats = new Map<string, number>();
  readonly #nowUs: () => number;

  constructor(options: MemoryRateLimiterOptions = {}) {
    super(options);
    this.#nowUs = options.nowUs ?? (() => Date.now() * 1_000);
  }

  protected decide(key: string, params: GcraParams): Promise<RateDecision> {
    const nowUs = this.#nowUs();
    if (this.#tats.size > PRUNE_THRESHOLD) {
      for (const [bucket, tat] of this.#tats) if (tat <= nowUs) this.#tats.delete(bucket);
    }
    const step = gcra(this.#tats.get(key), nowUs, params);
    if (step.tat !== undefined) this.#tats.set(key, step.tat);
    return Promise.resolve(step.decision);
  }
}
