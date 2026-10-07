/**
 * Circuit breaker per broker and account (plan B8; docs/01 "Resilience": when open, orders are blocked, fail closed).
 *
 *   closed ──(N consecutive failures, or failure rate ≥ threshold over the window with enough calls)──▶ open
 *   open ──(cool-down elapsed)──▶ half_open: up to `halfOpenMaxCalls` trial calls
 *   half_open ──(trial succeeds)──▶ closed      half_open ──(trial fails)──▶ open (cool-down restarts)
 *
 * Only broker-health failures count (`isBrokerFailure`: BROKER_UNAVAILABLE, INTERNAL, untyped errors). A rejection,
 * a 429 or an expired session means the broker answered, which is a success for health. The breaker never retries
 * anything itself; the gateway decides retries, and never for a non-idempotent `placeOrder`.
 *
 * State is per process: each api pod and worker judges the broker on its own calls.
 */
import type { BrokerCode } from "@finlytics/shared";

import { CircuitOpenError, isBrokerFailure } from "./errors";
import type { Unsubscribe } from "./feed/emitter";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit (default 5). */
  readonly failureThreshold?: number | undefined;
  /** Failure share in the window that opens the circuit, in (0, 1] (default 0.5). */
  readonly failureRateThreshold?: number | undefined;
  /** Calls the window needs before the failure rate counts (default 10). */
  readonly minimumCalls?: number | undefined;
  /** The rolling window for the failure rate (default 30 s). */
  readonly windowMs?: number | undefined;
  /** How long the circuit stays open before a trial (default 15 s). */
  readonly openMs?: number | undefined;
  /** Concurrent trial calls in half-open (default 1). */
  readonly halfOpenMaxCalls?: number | undefined;
  /** Milliseconds clock (default Date.now). */
  readonly now?: (() => number) | undefined;
}

export interface CircuitStateChange {
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly at: number;
}

/** Permission for one call. Report exactly one outcome; later reports are ignored. */
export interface CircuitPermit {
  /** The broker answered (including rejections). */
  success(): void;
  /** The broker failed (unavailable, timeout, garbage). */
  failure(): void;
  /** The call was never sent (our own rate limiter refused, the caller aborted first): no outcome. */
  release(): void;
}

interface Outcome {
  readonly at: number;
  readonly failed: boolean;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

export class CircuitBreaker {
  readonly #failureThreshold: number;
  readonly #failureRateThreshold: number;
  readonly #minimumCalls: number;
  readonly #windowMs: number;
  readonly #openMs: number;
  readonly #halfOpenMaxCalls: number;
  readonly #now: () => number;
  readonly #listeners = new Set<(change: CircuitStateChange) => void>();

  #state: CircuitState = "closed";
  #openedAt = 0;
  #consecutiveFailures = 0;
  #outcomes: Outcome[] = [];
  #trialsInFlight = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = positiveInteger(options.failureThreshold ?? 5, "failureThreshold");
    this.#minimumCalls = positiveInteger(options.minimumCalls ?? 10, "minimumCalls");
    this.#windowMs = positiveInteger(options.windowMs ?? 30_000, "windowMs");
    this.#openMs = positiveInteger(options.openMs ?? 15_000, "openMs");
    this.#halfOpenMaxCalls = positiveInteger(options.halfOpenMaxCalls ?? 1, "halfOpenMaxCalls");
    const rate = options.failureRateThreshold ?? 0.5;
    if (!(rate > 0 && rate <= 1)) throw new RangeError("failureRateThreshold must be in (0, 1]");
    this.#failureRateThreshold = rate;
    this.#now = options.now ?? Date.now;
  }

  /** The current state; an open circuit whose cool-down has elapsed reads as `half_open`. */
  get state(): CircuitState {
    if (this.#state === "open" && this.#now() - this.#openedAt >= this.#openMs) this.#transition("half_open");
    return this.#state;
  }

  /** Listens for state changes (the api raises `broker.degraded` / the "Broker degraded" banner). */
  onStateChange(listener: (change: CircuitStateChange) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Asks to make one call.
   *
   * @throws {CircuitOpenError} when the circuit is open (with `retryAfterMs` until the trial) or half-open with every
   *   trial slot taken.
   */
  acquire(): CircuitPermit {
    const state = this.state;
    if (state === "open") {
      throw new CircuitOpenError("Circuit open: the broker is failing, calls are paused", {
        retryAfterMs: Math.max(1, this.#openedAt + this.#openMs - this.#now()),
      });
    }
    const trial = state === "half_open";
    if (trial) {
      if (this.#trialsInFlight >= this.#halfOpenMaxCalls) {
        throw new CircuitOpenError("Circuit half-open: a trial call is already in flight", { retryAfterMs: 1_000 });
      }
      this.#trialsInFlight += 1;
    }
    let done = false;
    const settle = (outcome: "success" | "failure" | "release"): void => {
      if (done) return;
      done = true;
      if (trial) this.#trialsInFlight -= 1;
      if (outcome === "success") this.#onSuccess(trial);
      else if (outcome === "failure") this.#onFailure(trial);
    };
    return {
      success: () => {
        settle("success");
      },
      failure: () => {
        settle("failure");
      },
      release: () => {
        settle("release");
      },
    };
  }

  /**
   * Runs `fn` under the breaker: a thrown error counts as a failure when `isFailure` says so (default
   * {@link isBrokerFailure}), otherwise as a success. The error is rethrown either way.
   */
  async execute<T>(fn: () => Promise<T>, isFailure: (error: unknown) => boolean = isBrokerFailure): Promise<T> {
    const permit = this.acquire();
    try {
      const value = await fn();
      permit.success();
      return value;
    } catch (error: unknown) {
      if (isFailure(error)) permit.failure();
      else permit.success();
      throw error;
    }
  }

  #onSuccess(trial: boolean): void {
    if (trial || this.#state === "half_open") {
      if (this.#state === "half_open") this.#transition("closed");
      return;
    }
    if (this.#state !== "closed") return;
    this.#consecutiveFailures = 0;
    this.#record(false);
  }

  #onFailure(trial: boolean): void {
    if (trial || this.#state === "half_open") {
      if (this.#state === "half_open") this.#open();
      return;
    }
    if (this.#state !== "closed") return;
    this.#consecutiveFailures += 1;
    this.#record(true);
    const failures = this.#outcomes.filter((outcome) => outcome.failed).length;
    const tooManyInARow = this.#consecutiveFailures >= this.#failureThreshold;
    const rateTooHigh =
      this.#outcomes.length >= this.#minimumCalls && failures / this.#outcomes.length >= this.#failureRateThreshold;
    if (tooManyInARow || rateTooHigh) this.#open();
  }

  #record(failed: boolean): void {
    const now = this.#now();
    this.#outcomes.push({ at: now, failed });
    const cutoff = now - this.#windowMs;
    const firstInWindow = this.#outcomes.findIndex((outcome) => outcome.at > cutoff);
    if (firstInWindow > 0) this.#outcomes = this.#outcomes.slice(firstInWindow);
  }

  #open(): void {
    this.#openedAt = this.#now();
    this.#transition("open");
  }

  #transition(to: CircuitState): void {
    const from = this.#state;
    if (from === to) return;
    this.#state = to;
    if (to === "closed" || to === "open") {
      this.#consecutiveFailures = 0;
      this.#outcomes = [];
    }
    const change: CircuitStateChange = { from, to, at: this.#now() };
    for (const listener of [...this.#listeners]) {
      try {
        listener(change);
      } catch {
        // A listener's bug must not change the breaker's decision.
      }
    }
  }
}

/** One breaker per broker and account, created on first use with shared options. */
export class CircuitBreakerRegistry {
  readonly #breakers = new Map<string, CircuitBreaker>();
  readonly #listeners = new Set<(scope: CircuitScope, change: CircuitStateChange) => void>();

  constructor(private readonly options: CircuitBreakerOptions = {}) {}

  /** The breaker for `broker` and `accountId`. */
  get(broker: BrokerCode, accountId: string): CircuitBreaker {
    const key = `${broker}:${accountId}`;
    let breaker = this.#breakers.get(key);
    if (breaker === undefined) {
      breaker = new CircuitBreaker(this.options);
      const scope: CircuitScope = { broker, accountId };
      breaker.onStateChange((change) => {
        for (const listener of [...this.#listeners]) {
          try {
            listener(scope, change);
          } catch {
            // As above: listeners can't affect breakers.
          }
        }
      });
      this.#breakers.set(key, breaker);
    }
    return breaker;
  }

  /** Listens for state changes of every breaker in the registry. */
  onStateChange(listener: (scope: CircuitScope, change: CircuitStateChange) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

export interface CircuitScope {
  readonly broker: BrokerCode;
  readonly accountId: string;
}
