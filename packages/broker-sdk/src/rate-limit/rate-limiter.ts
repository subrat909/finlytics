/**
 * Broker rate limiting (plan B6). One bucket per broker, account and request class; `tryAcquire` answers at once,
 * `acquire` waits (up to `maxWaitMs`) for a token. {@link BrokerRateLimiter} keeps the buckets in Redis, shared by every
 * api pod and worker; ./memory-rate-limiter.ts keeps them in process for paper trading and tests.
 *
 * Fail closed: when Redis errors, no token is granted (DependencyUnavailableError), so a Redis outage can never
 * unleash unlimited broker traffic.
 */
import type { BrokerCode } from "@finlytics/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

import { DependencyUnavailableError, RateLimitedError } from "../errors";
import { sleep } from "../timeout";

import { gcraParams } from "./gcra";
import type { GcraParams, RateDecision } from "./gcra";
import { GCRA_LUA, GCRA_SHA1 } from "./gcra.lua";
import { resolveRateLimit } from "./limits";
import type { RateClass, RateLimitOverrides } from "./limits";

/** Which bucket a request is charged to. */
export interface RateLimitScope {
  readonly broker: BrokerCode;
  /** `BrokerAccount.id`, or `app` for calls made before an account exists (token exchange, instrument master). */
  readonly accountId: string;
  readonly rateClass: RateClass;
}

export interface AcquireOptions {
  /** Requests this call is worth (default 1). At most the bucket's burst. */
  readonly cost?: number | undefined;
  /** How long to wait for a token before RateLimitedError (default 0: don't wait). */
  readonly maxWaitMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** What the gateway needs from a limiter. */
export interface RateLimiter {
  tryAcquire(scope: RateLimitScope, cost?: number): Promise<RateDecision>;
  acquire(scope: RateLimitScope, options?: AcquireOptions): Promise<void>;
}

/** The account id used for calls that belong to no account. */
export const APP_ACCOUNT_ID = "app";

const KEY_SEGMENT = /^[^:\s]{1,64}$/;

/**
 * The Redis key of a bucket: `brl:<BROKER>:<accountId>:<class>` (docs/01 "Redis key namespaces").
 *
 * @throws {TypeError} for an account id that is empty, longer than 64, or contains `:` or whitespace.
 */
export function rateLimitKey(scope: RateLimitScope): string {
  if (!KEY_SEGMENT.test(scope.accountId)) throw new TypeError("Invalid account id for a rate-limit key");
  return `brl:${scope.broker}:${scope.accountId}:${scope.rateClass}`;
}

export interface RateLimiterOptions {
  /** Per-broker overrides of DEFAULT_BROKER_RATE_LIMITS. */
  readonly limits?: RateLimitOverrides | undefined;
  /** Milliseconds clock for wait deadlines (default Date.now). */
  readonly now?: (() => number) | undefined;
  /** Waits between attempts (default: a timer that honours the signal). */
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

/** The shared acquire-or-wait loop; subclasses decide one step. */
export abstract class BaseRateLimiter implements RateLimiter {
  readonly #limits: RateLimitOverrides;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: RateLimiterOptions = {}) {
    this.#limits = options.limits ?? {};
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? sleep;
  }

  /** One atomic step for the bucket `key`. */
  protected abstract decide(key: string, params: GcraParams): Promise<RateDecision>;

  /**
   * Takes `cost` tokens if the bucket has them. Never waits.
   *
   * @throws {TypeError} for a cost that isn't a positive integer or exceeds the burst, or an invalid account id.
   * @throws {DependencyUnavailableError} when the store fails (fail closed).
   */
  async tryAcquire(scope: RateLimitScope, cost = 1): Promise<RateDecision> {
    const params = gcraParams(resolveRateLimit(scope.broker, scope.rateClass, this.#limits), cost);
    return this.decide(rateLimitKey(scope), params);
  }

  /**
   * Takes `cost` tokens, waiting up to `maxWaitMs` for them.
   *
   * @throws {RateLimitedError} when the wait would exceed `maxWaitMs` (with `retryAfterMs`).
   * @throws the signal's reason when it aborts while waiting.
   */
  async acquire(scope: RateLimitScope, options: AcquireOptions = {}): Promise<void> {
    const { cost = 1, maxWaitMs = 0, signal } = options;
    const deadline = this.#now() + maxWaitMs;
    for (;;) {
      signal?.throwIfAborted();
      const decision = await this.tryAcquire(scope, cost);
      if (decision.allowed) return;
      if (this.#now() + decision.retryAfterMs > deadline) {
        throw new RateLimitedError(`Request budget for ${scope.broker} ${scope.rateClass} calls is used up`, {
          broker: scope.broker,
          retryAfterMs: decision.retryAfterMs,
        });
      }
      await this.#sleep(decision.retryAfterMs, signal);
    }
  }
}

/** The script reply: `{ allowed, remaining, retryAfterMs, resetAfterMs }`. */
const ReplySchema = z.tuple([z.union([z.literal(0), z.literal(1)]), z.int(), z.int(), z.int()]);

/** The part of an ioredis client the limiter uses. */
export type RedisScriptClient = Pick<Redis, "evalsha" | "eval">;

/**
 * Buckets in Redis: one GCRA Lua script per decision (EVALSHA, falling back to EVAL once when Redis doesn't have the
 * script cached). The client is the caller's (its own connection with a short command timeout is recommended); the
 * limiter never closes it.
 */
export class BrokerRateLimiter extends BaseRateLimiter {
  constructor(
    private readonly redis: RedisScriptClient,
    options: RateLimiterOptions = {},
  ) {
    super(options);
  }

  protected async decide(key: string, params: GcraParams): Promise<RateDecision> {
    const args = [key, params.intervalUs, params.burst, params.cost] as const;
    let reply: unknown;
    try {
      try {
        reply = await this.redis.evalsha(GCRA_SHA1, 1, ...args);
      } catch (error: unknown) {
        if (!(error instanceof Error) || !error.message.startsWith("NOSCRIPT")) throw error;
        reply = await this.redis.eval(GCRA_LUA, 1, ...args);
      }
    } catch (error: unknown) {
      throw new DependencyUnavailableError(
        `Rate limiter store failed (${error instanceof Error ? error.name : "unknown"})`,
      );
    }
    const parsed = ReplySchema.safeParse(reply);
    if (!parsed.success) throw new DependencyUnavailableError("Rate limiter store returned an unexpected reply");
    const [allowed, remaining, retryAfterMs, resetAfterMs] = parsed.data;
    return { allowed: allowed === 1, remaining, retryAfterMs, resetAfterMs };
  }
}
