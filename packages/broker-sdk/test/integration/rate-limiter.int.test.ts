/**
 * BrokerRateLimiter on a real Redis 7.4 (the compose image): the GCRA Lua script, atomicity across connections, the
 * Redis clock, key expiry, the EVALSHA fallback, waiting, and failing closed. Each test uses its own account ids, so
 * buckets never collide.
 */
import { randomUUID } from "node:crypto";

import fc from "fast-check";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { isBrokerError } from "../../src/errors";
import { GCRA_SHA1 } from "../../src/rate-limit/gcra.lua";
import { BrokerRateLimiter, rateLimitKey } from "../../src/rate-limit/rate-limiter";
import type { RateLimitScope } from "../../src/rate-limit/rate-limiter";

const clients: Redis[] = [];

function client(): Redis {
  const redis = new Redis(inject("redisUrl"), { maxRetriesPerRequest: 1, connectionName: "broker-sdk-int" });
  clients.push(redis);
  return redis;
}

function scope(overrides: Partial<RateLimitScope> = {}): RateLimitScope {
  return { broker: "UPSTOX", accountId: `acc-${randomUUID()}`, rateClass: "orders", ...overrides };
}

let redis: Redis;

beforeAll(() => {
  redis = client();
});

afterAll(async () => {
  await Promise.all(clients.map((connection) => connection.quit().catch(() => undefined)));
});

describe("BrokerRateLimiter on Redis", () => {
  it("admits the burst, refuses the next request with a retry-after, and sets a TTL", async () => {
    const limiter = new BrokerRateLimiter(redis, { limits: { UPSTOX: { orders: { ratePerSec: 10, burst: 3 } } } });
    const bucket = scope();
    const decisions = [];
    for (let index = 0; index < 4; index += 1) decisions.push(await limiter.tryAcquire(bucket));
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions[0]?.remaining).toBe(2);
    expect(decisions[3]?.retryAfterMs).toBeGreaterThan(0);
    expect(decisions[3]?.retryAfterMs).toBeLessThanOrEqual(100);
    const ttl = await redis.pttl(rateLimitKey(bucket));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("keeps brokers, accounts and classes in separate buckets", async () => {
    const limiter = new BrokerRateLimiter(redis, { limits: { DHAN: { data: { ratePerSec: 1, burst: 1 } } } });
    const bucket = scope({ broker: "DHAN", rateClass: "data" });
    expect((await limiter.tryAcquire(bucket)).allowed).toBe(true);
    expect((await limiter.tryAcquire(bucket)).allowed).toBe(false);
    expect((await limiter.tryAcquire({ ...bucket, accountId: `acc-${randomUUID()}` })).allowed).toBe(true);
    expect((await limiter.tryAcquire({ ...bucket, rateClass: "standard" })).allowed).toBe(true);
  });

  it("is atomic across connections: concurrent callers never exceed the burst", async () => {
    const burst = 25;
    const limiters = Array.from(
      { length: 5 },
      () => new BrokerRateLimiter(client(), { limits: { UPSTOX: { orders: { ratePerSec: 0.01, burst } } } }),
    );
    const bucket = scope();
    const decisions = await Promise.all(
      Array.from({ length: 200 }, (_unused, index) =>
        (limiters[index % limiters.length] as BrokerRateLimiter).tryAcquire(bucket),
      ),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(burst);
  });

  it("never admits more than burst + elapsed × rate, for any request pattern", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 20, max: 200 }),
        fc.array(fc.record({ cost: fc.integer({ min: 1, max: 10 }), pauseMs: fc.integer({ min: 0, max: 15 }) }), {
          minLength: 5,
          maxLength: 40,
        }),
        async (burst, ratePerSec, requests) => {
          const limiter = new BrokerRateLimiter(redis, { limits: { PAPER: { standard: { ratePerSec, burst } } } });
          const bucket = scope({ broker: "PAPER", rateClass: "standard" });
          const started = performance.now();
          let admittedCost = 0;
          for (const request of requests) {
            const cost = Math.min(request.cost, burst);
            if ((await limiter.tryAcquire(bucket, cost)).allowed) admittedCost += cost;
            if (request.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, request.pauseMs));
          }
          // Wall time measured here is at least the time Redis saw pass (plus 5 ms for clock granularity).
          const elapsedSec = (performance.now() - started + 5) / 1_000;
          expect(admittedCost).toBeLessThanOrEqual(burst + Math.ceil(elapsedSec * ratePerSec));
        },
      ),
      { numRuns: 15 },
    );
  });

  it("waits for a token when allowed to, and refuses when the wait is too long", async () => {
    const limiter = new BrokerRateLimiter(redis, { limits: { UPSTOX: { orders: { ratePerSec: 20, burst: 1 } } } });
    const bucket = scope();
    await limiter.acquire(bucket);
    const started = performance.now();
    await limiter.acquire(bucket, { maxWaitMs: 500 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);

    const error: unknown = await limiter.acquire(bucket, { maxWaitMs: 5 }).catch((reason: unknown) => reason);
    expect(isBrokerError(error) && error.code).toBe("RATE_LIMITED");
  });

  it("re-sends the script after Redis forgets it", async () => {
    const limiter = new BrokerRateLimiter(redis);
    expect((await limiter.tryAcquire(scope())).allowed).toBe(true);
    expect(await redis.script("EXISTS", GCRA_SHA1)).toEqual([1]);
    await redis.script("FLUSH");
    expect((await limiter.tryAcquire(scope())).allowed).toBe(true);
    expect(await redis.script("EXISTS", GCRA_SHA1)).toEqual([1]);
  });

  it("fails closed when Redis is unreachable", async () => {
    const dead = new Redis({
      port: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    clients.push(dead);
    const limiter = new BrokerRateLimiter(dead);
    const error: unknown = await limiter.tryAcquire(scope()).catch((reason: unknown) => reason);
    expect(isBrokerError(error) && error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
