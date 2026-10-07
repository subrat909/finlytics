import { BROKER_CODES } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import { BROKER_METHODS } from "../../adapter";
import type { BrokerMethod } from "../../adapter";
import { isBrokerError } from "../../errors";
import { GCRA_LUA, GCRA_SHA1 } from "../gcra.lua";
import { DEFAULT_BROKER_RATE_LIMITS, RATE_CLASSES, rateClassOf, resolveRateLimit } from "../limits";
import { MemoryRateLimiter } from "../memory-rate-limiter";
import { BrokerRateLimiter, rateLimitKey } from "../rate-limiter";
import type { RateLimitScope, RedisScriptClient } from "../rate-limiter";

const UPSTOX_ORDERS: RateLimitScope = { broker: "UPSTOX", accountId: "acc1", rateClass: "orders" };

/** Max requests one bucket admits in any one-second window: burst + rate − 1. */
function perSecondCeiling(ratePerSec: number, burst: number): number {
  return burst + Math.ceil(ratePerSec) - 1;
}

describe("rate limits", () => {
  it("keeps every default inside the broker's per-second limit", () => {
    const brokerPerSecond = {
      UPSTOX: { orders: 10, data: 50, standard: 50 },
      DHAN: { orders: 10, data: 5, standard: 20 },
    };
    for (const [broker, classes] of Object.entries(brokerPerSecond)) {
      for (const [rateClass, limit] of Object.entries(classes)) {
        const bucket = DEFAULT_BROKER_RATE_LIMITS[broker as "UPSTOX"][rateClass as "orders"];
        expect(perSecondCeiling(bucket.ratePerSec, bucket.burst), `${broker} ${rateClass}`).toBeLessThanOrEqual(limit);
      }
    }
    expect(DEFAULT_BROKER_RATE_LIMITS.UPSTOX.standard.ratePerSec).toBe(25);
  });

  it("has a valid bucket for every broker and class", () => {
    for (const broker of BROKER_CODES) {
      for (const rateClass of RATE_CLASSES) expect(() => resolveRateLimit(broker, rateClass)).not.toThrow();
    }
  });

  it("charges order calls to orders, candles to data and the rest to standard", () => {
    const classes = Object.fromEntries(
      (Object.keys(BROKER_METHODS) as BrokerMethod[]).map((method) => [method, rateClassOf(method)]),
    );
    expect(classes).toMatchObject({
      placeOrder: "orders",
      modifyOrder: "orders",
      cancelOrder: "orders",
      getHistoricalCandles: "data",
    });
    expect(Object.values(classes).filter((rateClass) => rateClass === "standard")).toHaveLength(11);
  });

  it("applies overrides and rejects invalid limits", () => {
    const overrides = { UPSTOX: { orders: { ratePerSec: 40, burst: 10 } } };
    expect(resolveRateLimit("UPSTOX", "orders", overrides)).toEqual({ ratePerSec: 40, burst: 10 });
    expect(resolveRateLimit("UPSTOX", "data", overrides)).toBe(DEFAULT_BROKER_RATE_LIMITS.UPSTOX.data);
    for (const bad of [
      { ratePerSec: 0, burst: 1 },
      { ratePerSec: Number.NaN, burst: 1 },
      { ratePerSec: 2e6, burst: 1 },
      { ratePerSec: 1, burst: 0.5 },
    ]) {
      expect(() => resolveRateLimit("DHAN", "orders", { DHAN: { orders: bad } })).toThrow(RangeError);
    }
  });

  it("builds bucket keys per broker, account and class, and refuses unsafe account ids", () => {
    expect(rateLimitKey(UPSTOX_ORDERS)).toBe("brl:UPSTOX:acc1:orders");
    for (const accountId of ["", "a:b", "a b", "x".repeat(65)]) {
      expect(() => rateLimitKey({ ...UPSTOX_ORDERS, accountId })).toThrow(TypeError);
    }
  });
});

describe("MemoryRateLimiter", () => {
  it("admits the burst, then refuses with a retry-after, per account", async () => {
    let nowUs = 0;
    const limiter = new MemoryRateLimiter({
      nowUs: () => nowUs,
      limits: { UPSTOX: { orders: { ratePerSec: 10, burst: 2 } } },
    });
    expect((await limiter.tryAcquire(UPSTOX_ORDERS)).allowed).toBe(true);
    expect((await limiter.tryAcquire(UPSTOX_ORDERS)).allowed).toBe(true);
    expect(await limiter.tryAcquire(UPSTOX_ORDERS)).toMatchObject({ allowed: false, retryAfterMs: 100 });
    expect((await limiter.tryAcquire({ ...UPSTOX_ORDERS, accountId: "acc2" })).allowed).toBe(true);
    nowUs = 100_000;
    expect((await limiter.tryAcquire(UPSTOX_ORDERS)).allowed).toBe(true);
  });

  it("waits for a token within maxWaitMs, then fails with RateLimitedError", async () => {
    let nowMs = 0;
    const sleep = vi.fn((ms: number) => {
      nowMs += ms;
      return Promise.resolve();
    });
    const limiter = new MemoryRateLimiter({
      nowUs: () => nowMs * 1_000,
      now: () => nowMs,
      sleep,
      limits: { DHAN: { data: { ratePerSec: 4, burst: 1 } } },
    });
    const scope: RateLimitScope = { broker: "DHAN", accountId: "acc1", rateClass: "data" };
    await limiter.acquire(scope);
    await limiter.acquire(scope, { maxWaitMs: 250 });
    expect(sleep).toHaveBeenCalledWith(250, undefined);

    const error: unknown = await limiter.acquire(scope, { maxWaitMs: 100 }).catch((reason: unknown) => reason);
    expect(isBrokerError(error) && error.code).toBe("RATE_LIMITED");
    expect(isBrokerError(error) && error.retryAfterMs).toBe(250);
    expect(isBrokerError(error) && error.retryable).toBe(true);
  });

  it("stops waiting when the signal aborts", async () => {
    const limiter = new MemoryRateLimiter({ limits: { PAPER: { orders: { ratePerSec: 0.001, burst: 1 } } } });
    const scope: RateLimitScope = { broker: "PAPER", accountId: "acc1", rateClass: "orders" };
    await limiter.acquire(scope);
    const controller = new AbortController();
    const waiting = limiter.acquire(scope, { maxWaitMs: 60_000_000, signal: controller.signal });
    controller.abort(new Error("shutdown"));
    await expect(waiting).rejects.toThrow("shutdown");
    await expect(limiter.acquire(scope, { signal: controller.signal })).rejects.toThrow("shutdown");
  });

  it("drops expired buckets once it holds many", async () => {
    let nowUs = 0;
    const limiter = new MemoryRateLimiter({ nowUs: () => nowUs });
    for (let index = 0; index <= 10_001; index += 1) {
      await limiter.tryAcquire({ broker: "PAPER", accountId: `a${String(index)}`, rateClass: "standard" });
    }
    nowUs = 60_000_000;
    expect((await limiter.tryAcquire({ broker: "PAPER", accountId: "a0", rateClass: "standard" })).remaining).toBe(99);
  });
});

describe("BrokerRateLimiter", () => {
  function client(evalsha: RedisScriptClient["evalsha"], evalScript?: RedisScriptClient["eval"]): RedisScriptClient {
    return { evalsha, eval: evalScript ?? vi.fn() };
  }

  it("runs the cached script with the bucket key and GCRA arguments", async () => {
    const evalsha = vi.fn().mockResolvedValue([1, 2, 0, 120]);
    const limiter = new BrokerRateLimiter(client(evalsha));
    expect(await limiter.tryAcquire(UPSTOX_ORDERS)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 120,
    });
    expect(evalsha).toHaveBeenCalledWith(GCRA_SHA1, 1, "brl:UPSTOX:acc1:orders", 125_000, 3, 1);
  });

  it("sends the script itself once Redis answers NOSCRIPT", async () => {
    const evalsha = vi.fn().mockRejectedValue(new Error("NOSCRIPT No matching script"));
    const evalScript = vi.fn().mockResolvedValue([0, 0, 80, 200]);
    const limiter = new BrokerRateLimiter(client(evalsha, evalScript));
    expect(await limiter.tryAcquire(UPSTOX_ORDERS)).toMatchObject({ allowed: false, retryAfterMs: 80 });
    expect(evalScript).toHaveBeenCalledWith(GCRA_LUA, 1, "brl:UPSTOX:acc1:orders", 125_000, 3, 1);
  });

  it("fails closed when Redis errors or answers garbage", async () => {
    for (const evalsha of [
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      vi.fn().mockRejectedValue("weird"),
      vi.fn().mockResolvedValue(["1"]),
    ]) {
      const limiter = new BrokerRateLimiter(client(evalsha));
      const error: unknown = await limiter.tryAcquire(UPSTOX_ORDERS).catch((reason: unknown) => reason);
      expect(isBrokerError(error) && error.code).toBe("SERVICE_UNAVAILABLE");
    }
  });
});
