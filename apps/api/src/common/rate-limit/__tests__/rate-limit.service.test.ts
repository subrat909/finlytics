import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../../config/env.schema";
import type { RedisScript, RedisScriptDefinition, RedisService } from "../../../infra/redis/redis.service";
import { RateLimitedError, ServiceUnavailableError } from "../../problem-json/domain-errors";
import { gcra } from "../gcra";
import { GCRA_SCRIPT } from "../gcra.lua";
import {
  anonymousBuckets,
  clientIpSubject,
  enforceRateLimits,
  parseGcraReply,
  RateLimitService,
  UNPARSEABLE_CLIENT_IP,
} from "../rate-limit.service";

const NOW_US = 1_790_000_000_000_000;

/** A Redis stand-in that runs the GCRA model on a fixed clock: what the Lua script does, without a server. */
function fakeRedis() {
  const tats = new Map<string, number | undefined>();
  const defined: RedisScriptDefinition[] = [];
  const script = vi.fn<RedisScript>((keys, args) => {
    const [key = ""] = keys;
    const [intervalUs, burst, cost] = args.map(Number) as [number, number, number];
    const { decision, tat } = gcra(tats.get(key), NOW_US, { intervalUs, burst, cost });
    tats.set(key, tat);
    return Promise.resolve([
      decision.allowed ? 1 : 0,
      decision.remaining,
      decision.retryAfterMs,
      decision.resetAfterMs,
    ]);
  });
  const redis = {
    defineScript: (definition: RedisScriptDefinition) => {
      defined.push(definition);
      return script;
    },
  };
  return { redis: redis as unknown as RedisService, script, tats, defined };
}

function setup(limits: { public?: number; user?: number } = {}) {
  const fake = fakeRedis();
  const values: Partial<Record<keyof Env, unknown>> = {
    API_RATE_LIMIT_PUBLIC_PER_MIN: limits.public ?? 3,
    API_RATE_LIMIT_USER_PER_MIN: limits.user ?? 600,
  };
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const service = new RateLimitService(fake.redis, config, logger as unknown as PinoLogger);
  return { service, logger, ...fake };
}

const outage = () => Object.assign(new Error("Stream isn't writeable and enableOfflineQueue options is false"), {});

describe("RateLimitService", () => {
  it("loads the GCRA script once and charges the bucket of the policy and subject", async () => {
    const { service, script, defined } = setup();

    const decision = await service.consume("user", "cm0user1");

    expect(defined).toEqual([GCRA_SCRIPT]);
    expect(script).toHaveBeenCalledWith(["rl:user:u:cm0user1"], [100_000, 600, 1]);
    expect(decision).toEqual({
      policy: service.policies.user,
      allowed: true,
      remaining: 599,
      retryAfterMs: 0,
      resetAfterMs: 100,
    });
  });

  it("refuses once the bucket is empty", async () => {
    const { service } = setup({ public: 2 });

    const decisions = [
      await service.consume("public", "203.0.113.7"),
      await service.consume("public", "203.0.113.7"),
      await service.consume("public", "203.0.113.7"),
      await service.consume("public", "203.0.113.8"),
    ];

    expect(decisions.map((decision) => decision?.allowed)).toEqual([true, true, false, true]);
    expect(decisions[2]).toMatchObject({ remaining: 0, retryAfterMs: 30_000 });
  });

  it("fails open for public and user and closed for orders when the store throws", async () => {
    const { service, script, logger } = setup();
    script.mockRejectedValue(outage());

    await expect(service.consume("public", "203.0.113.7")).resolves.toBeUndefined();
    await expect(service.consume("user", "cm0user1")).resolves.toBeUndefined();
    const closed = service.consume("orders", "cm0user1");
    await expect(closed).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(closed).rejects.toMatchObject({ retryAfterSec: 5, cause: expect.any(Error) as unknown });
    expect(logger.warn).toHaveBeenCalledWith(
      { policy: "public", err: expect.any(Error) as unknown },
      "rate limit store unavailable; failing open",
    );
  });

  it("warns at most every 10 seconds while failing open", async () => {
    const { service, script, logger } = setup();
    script.mockRejectedValue(outage());
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    await service.consume("public", "203.0.113.7");
    await service.consume("user", "cm0user1");
    clock.mockReturnValue(1_009_999);
    await service.consume("public", "203.0.113.7");
    clock.mockReturnValue(1_010_000);
    await service.consume("public", "203.0.113.7");

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("treats a malformed script reply like a store failure", async () => {
    const { service, script } = setup();
    script.mockResolvedValue(["1", 2]);

    await expect(service.consume("user", "cm0user1")).resolves.toBeUndefined();
    await expect(service.consume("orders", "cm0user1")).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("throws, never fails open, for an invalid subject or cost", async () => {
    const { service, script } = setup();

    await expect(service.consume("user", "u1:other")).rejects.toThrow(TypeError);
    await expect(service.consume("public", "not-an-ip")).rejects.toThrow(TypeError);
    await expect(service.consume("user", "cm0user1", 0)).rejects.toThrow(TypeError);
    expect(script).not.toHaveBeenCalled();
  });

  it("rejects a cost above the policy's burst instead of answering retry-after forever", async () => {
    const { service, script } = setup();
    script.mockRejectedValue(outage()); // even with the store down: a bug, not a reason to fail open

    await expect(service.consume("orders", "cm0user1", 11)).rejects.toThrow(/exceeds the burst of 10/);
    await expect(service.consume("public", "203.0.113.7", 4)).rejects.toThrow(TypeError);
    await expect(service.consume("orders", "cm0user1", 10)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(script).toHaveBeenCalledOnce();
  });

  it("charges a request's anonymous buckets once, however many guards ask", async () => {
    const { service, script } = setup();
    const request = { ip: "::ffff:203.0.113.7" };

    const first = await service.chargePublic(request);
    const second = await service.chargePublic(request);
    await service.chargePublic({ ip: "203.0.113.7" });

    expect(second).toBe(first);
    expect(first).toEqual([expect.objectContaining({ policy: service.policies.public, allowed: true })]);
    expect(script).toHaveBeenCalledTimes(2);
    expect(script).toHaveBeenNthCalledWith(1, ["rl:public:ip:203.0.113.7"], [20_000_000, 3, 1]);
  });

  it("also charges an IPv6 client's /48 to publicNet, at 20 times the public limit", async () => {
    const { service, script } = setup({ public: 3 });

    const decisions = await service.chargePublic({ ip: "2001:db8:aa:1::7" });

    expect(script.mock.calls).toEqual([
      [["rl:public:ip:2001:db8:aa:1::/64"], [20_000_000, 3, 1]],
      [["rl:publicNet:ip:2001:db8:aa::/48"], [1_000_000, 60, 1]],
    ]);
    expect(decisions.map((decision) => [decision?.policy.name, decision?.allowed, decision?.remaining])).toEqual([
      ["public", true, 2],
      ["publicNet", true, 59],
    ]);
  });

  it("refuses an IPv6 client whose /48 is exhausted, even from a fresh /64", async () => {
    const { service } = setup({ public: 1 });

    // 20 different /64s of one /48: each admitted once by its own bucket, together emptying the /48's 20.
    for (let subnet = 0; subnet < 20; subnet += 1) {
      const decisions = await service.chargePublic({ ip: `2001:db8:bb:${subnet.toString(16)}::1` });
      expect(
        decisions.every((decision) => decision?.allowed === true),
        String(subnet),
      ).toBe(true);
    }
    const fresh = await service.chargePublic({ ip: "2001:db8:bb:ff::1" });

    expect(fresh.map((decision) => [decision?.policy.name, decision?.allowed])).toEqual([
      ["public", true],
      ["publicNet", false],
    ]);
  });

  it("doesn't spend the /48 bucket on a request its /64 already refused", async () => {
    const { service, script } = setup({ public: 1 });

    await service.chargePublic({ ip: "2001:db8:cc:1::1" });
    const refused = await service.chargePublic({ ip: "2001:db8:cc:1::2" }); // the same /64

    expect(refused.map((decision) => [decision?.policy.name, decision?.allowed])).toEqual([["public", false]]);
    expect(script.mock.calls.map(([keys]) => keys[0])).toEqual([
      "rl:public:ip:2001:db8:cc:1::/64",
      "rl:publicNet:ip:2001:db8:cc::/48",
    ]);
  });

  it("answers a bucket it knows is empty without asking Redis again", async () => {
    const { service, script } = setup({ public: 2 });
    const charge = () => service.chargePublic({ ip: "198.51.100.9" });

    expect(service.knownPublicRefusal({ ip: "198.51.100.9" })).toBeUndefined();
    const admitted = [await charge(), await charge()];
    const refused = await charge();

    expect(admitted.map(([decision]) => decision?.allowed)).toEqual([true, true]);
    expect(script).toHaveBeenCalledTimes(2);
    expect(refused).toEqual([
      expect.objectContaining({ policy: service.policies.public, allowed: false, remaining: 0 }),
    ]);
    expect(refused[0]?.retryAfterMs).toBeGreaterThan(29_000);
    expect(service.knownPublicRefusal({ ip: "198.51.100.9" })).toMatchObject({ allowed: false });
    expect(service.knownPublicRefusal({ ip: "::ffff:198.51.100.9" })).toMatchObject({ allowed: false });
    expect(service.knownPublicRefusal({ ip: "198.51.100.10" })).toBeUndefined();
  });

  it("learns nothing from a store that failed open", async () => {
    const { service, script } = setup({ public: 1 });
    script.mockRejectedValue(outage());

    await expect(service.chargePublic({ ip: "198.51.100.11" })).resolves.toEqual([undefined]);
    expect(service.knownPublicRefusal({ ip: "198.51.100.11" })).toBeUndefined();
  });
});

describe("rate-limit helpers", () => {
  it("keys IPv6 clients by /64 and anything that isn't an IP into one bucket", () => {
    expect(clientIpSubject("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientIpSubject("::ffff:198.51.100.1")).toBe("198.51.100.1");
    expect(clientIpSubject("unknown")).toBe(UNPARSEABLE_CLIENT_IP);
    expect(clientIpSubject("")).toBe(UNPARSEABLE_CLIENT_IP);
  });

  it("charges IPv6 clients to their /64 and their /48, everyone else to their address", () => {
    expect(anonymousBuckets("2001:db8:1:2:aaaa::1")).toEqual([
      { policy: "public", subject: "2001:db8:1:2::/64" },
      { policy: "publicNet", subject: "2001:db8:1::/48" },
    ]);
    expect(anonymousBuckets("198.51.100.1")).toEqual([{ policy: "public", subject: "198.51.100.1" }]);
    expect(anonymousBuckets("::ffff:198.51.100.1")).toEqual([{ policy: "public", subject: "198.51.100.1" }]);
    expect(anonymousBuckets("unknown")).toEqual([{ policy: "public", subject: UNPARSEABLE_CLIENT_IP }]);
  });

  it("accepts only four non-negative integers from the script", () => {
    expect(parseGcraReply([0, 0, 600, 60_000])).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 600,
      resetAfterMs: 60_000,
    });
    for (const reply of [null, [1, 2, 3], [1, 2, 3, 4, 5], [1, -1, 0, 0], [1, 2.5, 0, 0], "1,2,3,4"]) {
      expect(() => parseGcraReply(reply), JSON.stringify(reply)).toThrow(TypeError);
    }
  });

  it("sends the headers for decided checks and refuses with the longest wait", () => {
    const { service } = setup();
    const reply = { header: vi.fn() };
    const user = { policy: service.policies.user, allowed: true, remaining: 5, retryAfterMs: 0, resetAfterMs: 2_000 };
    const orders = {
      policy: service.policies.orders,
      allowed: false,
      remaining: 0,
      retryAfterMs: 100,
      resetAfterMs: 1_000,
    };

    expect(() => {
      enforceRateLimits(reply, [user, undefined, orders]);
    }).toThrow(RateLimitedError);
    expect(reply.header).toHaveBeenCalledWith("ratelimit-policy", '"user";q=600;w=60, "orders";q=10;w=1');
    expect(reply.header).toHaveBeenCalledWith("ratelimit", '"user";r=5;t=2, "orders";r=0;t=1');

    const quiet = { header: vi.fn() };
    enforceRateLimits(quiet, [undefined]);
    expect(quiet.header).not.toHaveBeenCalled();
    try {
      enforceRateLimits(reply, [orders]);
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 1 });
    }
  });
});
