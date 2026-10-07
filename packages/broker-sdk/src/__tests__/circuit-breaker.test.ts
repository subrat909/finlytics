import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker, CircuitBreakerRegistry } from "../circuit-breaker";
import type { CircuitStateChange } from "../circuit-breaker";
import { BrokerRejectedError, BrokerUnavailableError, isBrokerError } from "../errors";

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

const unavailable = (): Promise<never> => Promise.reject(new BrokerUnavailableError("down"));

async function fail(breaker: CircuitBreaker, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) await breaker.execute(unavailable).catch(() => undefined);
}

describe("CircuitBreaker", () => {
  it("opens after N consecutive failures and refuses calls without running them", async () => {
    const time = clock();
    const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1_000, now: time.now });
    await fail(breaker, 2);
    expect(breaker.state).toBe("closed");
    await fail(breaker, 1);
    expect(breaker.state).toBe("open");

    const fn = vi.fn(() => Promise.resolve(1));
    time.advance(400);
    const error: unknown = await breaker.execute(fn).catch((reason: unknown) => reason);
    expect(fn).not.toHaveBeenCalled();
    expect(isBrokerError(error) && [error.name, error.code, error.retryAfterMs]).toEqual([
      "CircuitOpenError",
      "BROKER_UNAVAILABLE",
      600,
    ]);
  });

  it("opens on the failure rate over the window once enough calls were made", async () => {
    const time = clock();
    const breaker = new CircuitBreaker({
      failureThreshold: 100,
      failureRateThreshold: 0.5,
      minimumCalls: 4,
      windowMs: 10_000,
      now: time.now,
    });
    await breaker.execute(() => Promise.resolve("ok"));
    await fail(breaker, 1);
    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.state).toBe("closed");
    await fail(breaker, 1);
    expect(breaker.state).toBe("open");
  });

  it("forgets outcomes older than the window", async () => {
    const time = clock();
    const breaker = new CircuitBreaker({ failureThreshold: 100, minimumCalls: 2, windowMs: 1_000, now: time.now });
    await fail(breaker, 1);
    time.advance(1_500);
    for (let index = 0; index < 3; index += 1) await breaker.execute(() => Promise.resolve("ok"));
    await fail(breaker, 1);
    expect(breaker.state).toBe("closed");
  });

  it("closes again after a successful trial, and reopens after a failed one", async () => {
    const time = clock();
    const changes: CircuitStateChange[] = [];
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 1_000, now: time.now });
    const stop = breaker.onStateChange((change) => changes.push(change));
    await fail(breaker, 1);
    time.advance(1_000);
    expect(breaker.state).toBe("half_open");
    await fail(breaker, 1);
    expect(breaker.state).toBe("open");
    time.advance(1_000);
    expect(await breaker.execute(() => Promise.resolve("ok"))).toBe("ok");
    expect(breaker.state).toBe("closed");
    expect(changes.map((change) => change.to)).toEqual(["open", "half_open", "open", "half_open", "closed"]);
    stop();
    await fail(breaker, 1);
    expect(changes).toHaveLength(5);
  });

  it("allows only the configured number of trial calls in half-open", async () => {
    const time = clock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 10, now: time.now });
    await fail(breaker, 1);
    time.advance(10);
    const trial = breaker.acquire();
    expect(() => breaker.acquire()).toThrow(/trial call is already in flight/);
    trial.release();
    const next = breaker.acquire();
    next.success();
    next.failure();
    expect(breaker.state).toBe("closed");
  });

  it("counts rejections as the broker answering, not as failures", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    await breaker.execute(() => Promise.reject(new BrokerRejectedError("margin"))).catch(() => undefined);
    expect(breaker.state).toBe("closed");
    await breaker.execute(() => Promise.reject(new TypeError("bug"))).catch(() => undefined);
    expect(breaker.state).toBe("open");
  });

  it("ignores outcomes that arrive after the state moved on, and survives a throwing listener", async () => {
    const time = clock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 10, halfOpenMaxCalls: 2, now: time.now });
    breaker.onStateChange(() => {
      throw new Error("listener bug");
    });
    const late = breaker.acquire();
    await fail(breaker, 1);
    late.failure();
    late.success();
    expect(breaker.state).toBe("open");
    time.advance(10);
    const first = breaker.acquire();
    const second = breaker.acquire();
    first.success();
    second.failure();
    expect(breaker.state).toBe("closed");
  });

  it("validates its options", () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0 })).toThrow(RangeError);
    expect(() => new CircuitBreaker({ failureRateThreshold: 0 })).toThrow(RangeError);
    expect(() => new CircuitBreaker({ failureRateThreshold: 1.5 })).toThrow(RangeError);
    expect(() => new CircuitBreaker({ windowMs: 1.5 })).toThrow(RangeError);
  });
});

describe("CircuitBreakerRegistry", () => {
  it("keeps one breaker per broker and account and reports their changes", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const seen: string[] = [];
    registry.onStateChange(() => {
      throw new Error("listener bug");
    });
    const stop = registry.onStateChange((scope, change) =>
      seen.push(`${scope.broker}:${scope.accountId}:${change.to}`),
    );
    expect(registry.get("UPSTOX", "a")).toBe(registry.get("UPSTOX", "a"));
    expect(registry.get("UPSTOX", "a")).not.toBe(registry.get("UPSTOX", "b"));
    await fail(registry.get("UPSTOX", "a"), 1);
    expect(seen).toEqual(["UPSTOX:a:open"]);
    expect(registry.get("UPSTOX", "b").state).toBe("closed");
    stop();
    await fail(registry.get("DHAN", "a"), 1);
    expect(seen).toHaveLength(1);
  });
});
