import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../../config/env.schema";
import { redisKeys } from "../keys";
import { REDIS_CLIENT_OPTIONS, reconnectDelayMs, reconnectOnError, RedisService } from "../redis.service";

describe("redisKeys", () => {
  it("builds every namespace from validated segments", () => {
    expect(redisKeys.rateLimitByIp("public", "203.0.113.7")).toBe("rl:public:ip:203.0.113.7");
    expect(redisKeys.rateLimitByIp("public", "2001:db8:1:2::/64")).toBe("rl:public:ip:2001:db8:1:2::/64");
    expect(redisKeys.rateLimitByIp("publicNet", "2001:db8:1::/48")).toBe("rl:publicNet:ip:2001:db8:1::/48");
    expect(redisKeys.rateLimitByUser("orders", "cm0abc123")).toBe("rl:orders:u:cm0abc123");
    expect(redisKeys.idempotency("cm0abc123", "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f")).toBe(
      "idem:cm0abc123:3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f",
    );
    expect(redisKeys.quote("NSE_FO|NIFTY|2026-10-27|24000|CE")).toBe("quote:NSE_FO|NIFTY|2026-10-27|24000|CE");
    expect(redisKeys.quoteChannel("NSE_EQ|RELIANCE")).toBe("q:NSE_EQ|RELIANCE");
    expect(redisKeys.ticks("UPSTOX")).toBe("ticks:UPSTOX");
    expect(redisKeys.subscriptions("NSE_EQ|RELIANCE")).toBe("subs:NSE_EQ|RELIANCE");
    expect(redisKeys.subscriptions("NSE_INDEX|NIFTY 50")).toBe("subs:NSE_INDEX|NIFTY 50");
    expect(redisKeys.subscriptionsWanted()).toBe("subs:wanted");
    expect(redisKeys.feedLock("market")).toBe("lock:feed:market");
    expect(redisKeys.feedSource()).toBe("feed:source");
    expect(redisKeys.feedStatus("UPSTOX")).toBe("feed:status:UPSTOX");
    expect(redisKeys.depth("NSE_EQ|RELIANCE")).toBe("depth:NSE_EQ|RELIANCE");
    expect(redisKeys.depthChannel("NSE_EQ|RELIANCE")).toBe("d:NSE_EQ|RELIANCE");
    expect(redisKeys.candleCoverage("M1", "NSE_EQ|RELIANCE")).toBe("candles:cov:M1:NSE_EQ|RELIANCE");
    expect(redisKeys.candleOrigin()).toBe("candles:origin");
    expect(redisKeys.instrumentsSynced("DHAN")).toBe("instruments:synced:DHAN");
  });

  it("refuses segments that could forge another key", () => {
    expect(() => redisKeys.idempotency("u1", "key:with:colons")).toThrow(/idempotencyKey/);
    expect(() => redisKeys.idempotency("u1:other", "abcdefghijklmnop")).toThrow(/userId/);
    expect(() => redisKeys.rateLimitByUser("", "u1")).toThrow(/policy/);
    expect(() => redisKeys.quote("NSE EQ")).toThrow(/instrumentKey/);
    expect(() => redisKeys.subscriptions("NSE_EQ|A:B")).toThrow(/instrumentKey/);
    expect(() => redisKeys.rateLimitByIp("public", "1.2.3.4 x")).toThrow(/ip/);
    expect(() => redisKeys.rateLimitByIp("public", "u:evil")).toThrow(/ip/);
    expect(() => redisKeys.rateLimitByIp("public", "2001:db8::/32")).toThrow(/ip/);
  });
});

describe("Redis client policy", () => {
  it("fails fast: no offline queue, one retry, short timeouts", () => {
    expect(REDIS_CLIENT_OPTIONS).toEqual({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
      connectionName: "finlytics-api",
    });
  });

  it("reconnects with jittered backoff from 100 ms, capped at 5 s, forever", () => {
    expect(reconnectDelayMs(1, () => 1)).toBe(100);
    expect(reconnectDelayMs(1, () => 0)).toBe(50);
    expect(reconnectDelayMs(2, () => 1)).toBe(200);
    expect(reconnectDelayMs(6, () => 1)).toBe(3_200);
    expect(reconnectDelayMs(7, () => 1)).toBe(5_000);
    expect(reconnectDelayMs(10_000, () => 1)).toBe(5_000);
    expect(reconnectDelayMs(10_000, () => 0)).toBe(2_500);
    expect(reconnectDelayMs(0, () => 1)).toBe(100);
    expect(reconnectDelayMs(3)).toBeGreaterThanOrEqual(200);
  });

  it("reconnects on READONLY after a failover, not on other errors", () => {
    expect(reconnectOnError(new Error("READONLY You can't write against a read only replica."))).toBe(true);
    expect(reconnectOnError(new Error("ERR unknown command"))).toBe(false);
  });
});

describe("RedisService.defineScript", () => {
  const service = () => {
    const config = { get: () => "redis://127.0.0.1:1" } as unknown as ConfigService<Env, true>;
    const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    // lazyConnect: nothing connects until a command is sent, and these tests send none.
    return new RedisService(config, logger);
  };

  it("defines the script on the client and checks the key count before sending", async () => {
    const redis = service();
    try {
      const run = redis.defineScript({ name: "finlyticsTestEcho", numberOfKeys: 1, lua: "return ARGV[1]" });

      expect(typeof Reflect.get(redis.client, "finlyticsTestEcho")).toBe("function");
      await expect(run([], ["x"])).rejects.toThrow("takes 1 keys");
      await expect(run(["a", "b"], ["x"])).rejects.toThrow("takes 1 keys");
    } finally {
      redis.client.disconnect();
    }
  });

  it("refuses a name that would shadow a client method or an earlier script", () => {
    const redis = service();
    try {
      const get: unknown = Reflect.get(redis.client, "get");
      const quit: unknown = Reflect.get(redis.client, "quit");
      for (const name of ["get", "quit"]) {
        expect(() => redis.defineScript({ name, numberOfKeys: 1, lua: "return 1" }), name).toThrow(
          `Redis script name ${name} is already taken on the client`,
        );
      }
      // The client's own methods are untouched.
      expect(Reflect.get(redis.client, "get")).toBe(get);
      expect(Reflect.get(redis.client, "quit")).toBe(quit);

      redis.defineScript({ name: "finlyticsTestOnce", numberOfKeys: 1, lua: "return 1" });
      expect(() => redis.defineScript({ name: "finlyticsTestOnce", numberOfKeys: 1, lua: "return 2" })).toThrow(
        /already taken/,
      );
      // ioredis also defines `<name>Buffer`: a clash there counts too.
      Reflect.set(redis.client, "finlyticsTestClashBuffer", () => undefined);
      expect(() => redis.defineScript({ name: "finlyticsTestClash", numberOfKeys: 1, lua: "return 1" })).toThrow(
        /already taken/,
      );
    } finally {
      redis.client.disconnect();
    }
  });

  it("refuses a name that isn't camelCase", () => {
    const redis = service();
    try {
      for (const name of ["get-or-set", "", "Upper", "with space"]) {
        expect(() => redis.defineScript({ name, numberOfKeys: 1, lua: "return 1" }), name).toThrow(
          "Invalid Redis script name",
        );
      }
    } finally {
      redis.client.disconnect();
    }
  });
});
