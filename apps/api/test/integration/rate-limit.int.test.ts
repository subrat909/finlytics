/**
 * Rate limiting end to end (plan D7, D9; docs/04 §7): the GCRA script on Redis 7.4, which bucket each request is
 * charged to, the headers, trusted proxies and Redis outages. Each test uses its own client addresses (inject's
 * `remoteAddress`) and its own users, so buckets never collide with other tests or test files.
 */
import { randomInt } from "node:crypto";

import type { PrismaClient } from "@finlytics/database";
import { ProblemDetailsSchema } from "@finlytics/shared";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RateLimitService } from "../../src/common/rate-limit/rate-limit.service";
import { redisKeys } from "../../src/infra/redis/keys";
import { RedisService } from "../../src/infra/redis/redis.service";
import { SessionRepository } from "../../src/modules/auth/session.repository";

import { closedPort, createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, newSessionToken, sessionCookie } from "./fixtures";
import { logCapture } from "./log-capture";

const usedAddresses = new Set<string>();

/** A client address in 198.18.0.0/15 (benchmarking) that no other test of this run uses. */
function clientAddress(): string {
  for (;;) {
    const address = `198.${String(18 + randomInt(2))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`;
    if (!usedAddresses.has(address)) {
      usedAddresses.add(address);
      return address;
    }
  }
}

const statuses = (responses: readonly LightMyRequestResponse[]) => responses.map((response) => response.statusCode);

describe("rate limiting", () => {
  let fixtures: PrismaClient;

  beforeAll(() => {
    fixtures = fixturesClient();
  });

  afterAll(async () => {
    await fixtures.$disconnect();
  });

  /** A signed-in user's cookie. */
  const signedIn = async () => {
    const user = await createUser(fixtures);
    return { user, cookie: sessionCookie((await createSession(fixtures, user.id)).token) };
  };

  /** Runs `body` against an app with `overrides`, closing it afterwards. */
  const withApp = async (overrides: Record<string, string | undefined>, body: (app: TestApp) => Promise<void>) => {
    const app = await createTestApp(overrides);
    try {
      await body(app);
    } finally {
      await app.close();
    }
  };

  it("admits the burst, then answers RATE_LIMITED with Retry-After and retryAfterSec", async () => {
    await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "3" }, async ({ request }) => {
      const remoteAddress = clientAddress();
      const responses: LightMyRequestResponse[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        responses.push(await request({ method: "GET", url: "/v1/me", remoteAddress }));
      }

      expect(statuses(responses)).toEqual([401, 401, 401, 429]);
      expect(responses.map((response) => response.headers["ratelimit"])).toEqual([
        expect.stringMatching(/^"public";r=2;t=(19|20)$/),
        expect.stringMatching(/^"public";r=1;t=(39|40)$/),
        expect.stringMatching(/^"public";r=0;t=(59|60)$/),
        expect.stringMatching(/^"public";r=0;t=(59|60)$/),
      ]);
      const limited = responses[3] as LightMyRequestResponse;
      const problem = ProblemDetailsSchema.parse(json(limited));
      expect(problem.code).toBe("RATE_LIMITED");
      // The next token arrives 20 s after the first request (3 per minute).
      expect(problem.retryAfterSec).toBeGreaterThanOrEqual(19);
      expect(problem.retryAfterSec).toBeLessThanOrEqual(20);
      expect(limited.headers["retry-after"]).toBe(String(problem.retryAfterSec));
      expect(limited.headers["ratelimit-policy"]).toBe('"public";q=3;w=60');
    });
  });

  it("answers 100 anonymous requests a minute from one address, then RATE_LIMITED (security.md default)", async () => {
    await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: undefined }, async ({ request }) => {
      const remoteAddress = clientAddress();
      const started = Date.now();
      const responses: LightMyRequestResponse[] = [];
      for (let attempt = 0; attempt < 105; attempt += 1) {
        responses.push(await request({ method: "GET", url: "/v1/me", remoteAddress }));
      }
      const elapsedMs = Date.now() - started;

      // GCRA refills one request every 600 ms, so a slow run may admit one or two more.
      expect(statuses(responses).slice(0, 100)).toEqual(Array.from({ length: 100 }, () => 401));
      const limited = statuses(responses).filter((status) => status === 429).length;
      expect(limited).toBeGreaterThanOrEqual(5 - Math.ceil(elapsedMs / 600));
      expect(statuses(responses).every((status) => status === 401 || status === 429)).toBe(true);
      expect(responses[0]?.headers["ratelimit-policy"]).toBe('"public";q=100;w=60');
    });
  });

  it("sends RateLimit headers on every rate-limited response", async () => {
    const { cookie } = await signedIn();
    await withApp({ API_RATE_LIMIT_USER_PER_MIN: "5" }, async ({ request }) => {
      const remoteAddress = clientAddress();

      const ok = await request({ method: "GET", url: "/v1/me", headers: { cookie }, remoteAddress });
      const invalid = await request({
        method: "POST",
        url: "/v1/__test__/echo",
        headers: { cookie, "content-type": "application/json" },
        payload: JSON.stringify({ value: "" }),
        remoteAddress,
      });
      const anonymous = await request({ method: "GET", url: "/v1/me", remoteAddress });
      const health = await request({ method: "GET", url: "/health/live", remoteAddress });

      expect(statuses([ok, invalid, anonymous, health])).toEqual([200, 400, 401, 200]);
      expect(ok.headers["ratelimit-policy"]).toBe('"user";q=5;w=60');
      expect(ok.headers["ratelimit"]).toMatch(/^"user";r=4;t=1[12]$/);
      expect(invalid.headers["ratelimit"]).toMatch(/^"user";r=3;t=2[34]$/);
      expect(anonymous.headers["ratelimit-policy"]).toBe('"public";q=100000;w=60');
      // Health probes are never rate-limited.
      expect(health.headers).not.toHaveProperty("ratelimit");
      expect(health.headers).not.toHaveProperty("ratelimit-policy");
    });
  });

  it("limits signed-in users per user, regardless of IP", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    await withApp({ API_RATE_LIMIT_USER_PER_MIN: "2" }, async ({ request }) => {
      const shared = clientAddress();
      const addresses = [shared, clientAddress(), clientAddress()];
      const fromAlice = [];
      for (const remoteAddress of addresses) {
        fromAlice.push(
          await request({ method: "GET", url: "/v1/me", headers: { cookie: alice.cookie }, remoteAddress }),
        );
      }
      const fromBob = await request({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: bob.cookie },
        remoteAddress: shared,
      });

      expect(statuses(fromAlice)).toEqual([200, 200, 429]);
      expect(fromBob.statusCode).toBe(200);
    });
  });

  it("ignores X-Forwarded-For from an untrusted peer", async () => {
    // No trusted proxy, then a trusted range the peer isn't in: either way the client is the TCP peer.
    for (const trustProxy of ["false", "10.0.0.0/8"]) {
      await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "2", API_TRUST_PROXY: trustProxy }, async ({ request }) => {
        const remoteAddress = clientAddress();
        const responses = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          responses.push(
            await request({
              method: "GET",
              url: "/v1/me",
              headers: { "x-forwarded-for": clientAddress() },
              remoteAddress,
            }),
          );
        }

        expect(statuses(responses), trustProxy).toEqual([401, 401, 429]);
      });
    }
  });

  it("uses the forwarded client IP behind the configured trusted proxy", async () => {
    await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "2", API_TRUST_PROXY: "10.0.0.0/8" }, async ({ request }) => {
      const proxy = "10.9.8.7";
      const [first, second] = [clientAddress(), clientAddress()];
      const via = (forwardedFor: string) =>
        request({ method: "GET", url: "/v1/me", headers: { "x-forwarded-for": forwardedFor }, remoteAddress: proxy });

      const responses = [
        await via(first),
        await via(first),
        // A spoofed address in front of the one the proxy appended changes nothing: the rightmost untrusted counts.
        await via(`203.0.113.99, ${first}`),
        await via(second),
      ];

      expect(statuses(responses)).toEqual([401, 401, 429, 401]);
    });
  });

  it("charges failed session lookups to the IP bucket, once per request", async () => {
    const { cookie } = await signedIn();
    await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "2" }, async ({ request }) => {
      const remoteAddress = clientAddress();
      const randomCookie = () => ({ cookie: sessionCookie(newSessionToken()) });

      const failed = [
        await request({ method: "GET", url: "/v1/me", headers: randomCookie(), remoteAddress }),
        await request({ method: "GET", url: "/v1/me", headers: randomCookie(), remoteAddress }),
        await request({ method: "GET", url: "/v1/me", headers: randomCookie(), remoteAddress }),
      ];
      // A real session from another address is charged to its user. From the exhausted address it is refused before
      // its lookup, like any cookie: nothing tells a valid token from a random one without looking it up.
      const elsewhere = await request({
        method: "GET",
        url: "/v1/me",
        headers: { cookie },
        remoteAddress: clientAddress(),
      });
      const sameAddress = await request({ method: "GET", url: "/v1/me", headers: { cookie }, remoteAddress });

      expect(statuses(failed)).toEqual([401, 401, 429]);
      expect(failed[2]?.headers["ratelimit"]).toMatch(/^"public";r=0;t=\d+$/);
      expect(elsewhere.statusCode).toBe(200);
      expect(sameAddress.statusCode).toBe(429);
      expect(Number(sameAddress.headers["retry-after"])).toBeGreaterThan(0);
    });
  });

  it("looks up no session once the address's bucket is empty", async () => {
    await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "3" }, async ({ app, request }) => {
      const lookups = vi.spyOn(app.get(SessionRepository), "findByTokenHash");
      const remoteAddress = clientAddress();
      const randomCookie = () => ({ cookie: sessionCookie(newSessionToken()) });

      const responses = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        responses.push(await request({ method: "GET", url: "/v1/me", headers: randomCookie(), remoteAddress }));
      }

      // Three lookups empty the bucket; the other seven are refused without touching the Session table.
      expect(statuses(responses)).toEqual([401, 401, 401, ...Array.from({ length: 7 }, () => 429)]);
      expect(lookups).toHaveBeenCalledTimes(3);
      for (const refused of responses.slice(3)) {
        expect(refused.headers["ratelimit-policy"]).toBe('"public";q=3;w=60');
        expect(refused.headers["ratelimit"]).toMatch(/^"public";r=0;t=\d+$/);
        expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(19);
      }
    });
  });

  it("limits an IPv6 client by its /64, and its /48 at 20 times that", async () => {
    await withApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "1" }, async ({ request }) => {
      // A /48 of its own for this test (fd00::/8 is unique-local): 2001:db8 is shared with other tests.
      const site = `fd${randomInt(16, 256).toString(16)}:${randomInt(65_536).toString(16)}:${randomInt(65_536).toString(16)}`;
      const responses = [];
      for (let subnet = 0; subnet < 21; subnet += 1) {
        responses.push(
          await request({ method: "GET", url: "/v1/me", remoteAddress: `${site}:${subnet.toString(16)}::1` }),
        );
      }
      const sameSubnet = await request({ method: "GET", url: "/v1/me", remoteAddress: `${site}:0::2` });

      // 20 /64s each get their one request; the 21st /64 meets the exhausted /48.
      expect(statuses(responses)).toEqual([...Array.from({ length: 20 }, () => 401), 429]);
      expect(responses[0]?.headers["ratelimit-policy"]).toBe('"public";q=1;w=60, "publicNet";q=20;w=60');
      expect(responses[20]?.headers["ratelimit"]).toMatch(/^"public";r=0;t=\d+, "publicNet";r=0;t=\d+$/);
      expect(sameSubnet.statusCode).toBe(429);
    });
  });

  it("fails open when Redis is down, except for trading policies", async () => {
    const { cookie } = await signedIn();
    const port = await closedPort();
    await withApp({ REDIS_URL: `redis://127.0.0.1:${String(port)}` }, async ({ request }) => {
      logCapture.clear();

      const anonymous = await request({ method: "GET", url: "/v1/me", remoteAddress: clientAddress() });
      const me = await request({ method: "GET", url: "/v1/me", headers: { cookie } });
      const orders = await request({ method: "GET", url: "/v1/__test__/orders", headers: { cookie } });

      expect(statuses([anonymous, me, orders])).toEqual([401, 200, 503]);
      expect(anonymous.headers).not.toHaveProperty("ratelimit");
      expect(me.headers).not.toHaveProperty("ratelimit");
      const problem = ProblemDetailsSchema.parse(json(orders));
      expect(problem.code).toBe("SERVICE_UNAVAILABLE");
      expect(orders.headers["retry-after"]).toBe("5");
      expect(orders.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|redis/i);
      expect(logCapture.lines().some((line) => line["msg"] === "rate limit store unavailable; failing open")).toBe(
        true,
      );
    });
  });

  it("limits order routes to 10 requests a second per user", async () => {
    const { cookie } = await signedIn();
    await withApp({}, async ({ request }) => {
      const started = Date.now();
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => request({ method: "GET", url: "/v1/__test__/orders", headers: { cookie } })),
      );
      const elapsedMs = Date.now() - started;

      const admitted = statuses(responses).filter((status) => status === 200).length;
      expect(admitted).toBeGreaterThanOrEqual(10);
      expect(admitted).toBeLessThanOrEqual(10 + Math.ceil(elapsedMs / 100));
      const limited = responses.find((response) => response.statusCode === 429);
      expect(limited?.headers["ratelimit-policy"]).toBe('"user";q=100000;w=60, "orders";q=10;w=1');
      expect(limited?.headers["ratelimit"]).toMatch(/^"user";r=\d+;t=\d+, "orders";r=0;t=1$/);
    });
  });

  it("runs the GCRA script on the Redis clock and expires each bucket within its window", async () => {
    await withApp({ API_RATE_LIMIT_USER_PER_MIN: "3" }, async ({ app }) => {
      const limits = app.get(RateLimitService);
      const redis = app.get(RedisService).client;
      const userId = `cmratelimit${String(randomInt(1_000_000))}`;

      const decisions = [];
      for (let attempt = 0; attempt < 4; attempt += 1) decisions.push(await limits.consume("user", userId));

      expect(decisions.map((decision) => [decision?.allowed, decision?.remaining])).toEqual([
        [true, 2],
        [true, 1],
        [true, 0],
        [false, 0],
      ]);
      expect(decisions[3]?.retryAfterMs).toBeGreaterThan(19_000);
      expect(decisions[3]?.retryAfterMs).toBeLessThanOrEqual(20_000);
      const key = redisKeys.rateLimitByUser("user", userId);
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(59_000);
      expect(ttl).toBeLessThanOrEqual(60_000);
      // The stored TAT: integer microseconds on the Redis clock, a full window ahead (allowing for clock drift).
      const tat = await redis.get(key);
      expect(tat).toMatch(/^\d{16}$/);
      expect(Math.abs(Number(tat) / 1_000 - (Date.now() + 60_000))).toBeLessThan(5_000);
    });
  });
});
