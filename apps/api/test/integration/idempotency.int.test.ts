/**
 * Idempotency end to end (plan D8; docs/04 §7) through the test-only probe `POST /v1/__test__/idempotent`
 * (test/support/idempotency-probe.controller.ts), on Redis 7.4. The probe counts its executions per user and value,
 * so a replay (same count) is told apart from a re-run.
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@finlytics/database";
import { ProblemDetailsSchema } from "@finlytics/shared";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { redisKeys } from "../../src/infra/redis/keys";
import { RedisService } from "../../src/infra/redis/redis.service";

import { GUARD_DELAY_HEADER } from "../support/delay.guard";

import { closedPort, createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, sessionCookie } from "./fixtures";
import type { CreatedUser } from "./fixtures";

const DAY_MS = 86_400_000;

describe("idempotency", () => {
  let testApp: TestApp;
  let fixtures: PrismaClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    fixtures = fixturesClient();
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
  });

  const signedIn = async (): Promise<{ user: CreatedUser; cookie: string }> => {
    const user = await createUser(fixtures);
    return { user, cookie: sessionCookie((await createSession(fixtures, user.id)).token) };
  };

  const post = (
    cookie: string | undefined,
    key: string | undefined,
    body: Record<string, unknown>,
    options: { app?: TestApp; url?: string; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> =>
    (options.app ?? testApp).request({
      method: "POST",
      url: options.url ?? "/v1/__test__/idempotent",
      headers: {
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { cookie }),
        ...(key === undefined ? {} : { "idempotency-key": key }),
        ...options.headers,
      },
      payload: JSON.stringify(body),
    });

  const redis = () => testApp.app.get(RedisService).client;

  it("replays the first response for a retried key", async () => {
    const { cookie } = await signedIn();
    const key = randomUUID();

    const first = await post(cookie, key, { value: "buy" });
    const retry = await post(cookie, key, { value: "buy" });
    const otherKey = await post(cookie, randomUUID(), { value: "buy" });

    expect(first.statusCode, first.body).toBe(201);
    expect(json(first)).toEqual({ value: "buy", executions: 1 });
    expect(first.headers).not.toHaveProperty("idempotent-replayed");
    expect(retry.statusCode).toBe(201);
    expect(retry.body).toBe(first.body);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.headers["content-type"]).toMatch(/^application\/json/);
    expect(retry.headers["x-request-id"]).not.toBe(first.headers["x-request-id"]);
    // The handler ran once for the first key: a new key runs it again.
    expect(json(otherKey)).toEqual({ value: "buy", executions: 2 });
  });

  it("answers IDEMPOTENT_REPLAY to a concurrent duplicate", async () => {
    const { cookie } = await signedIn();
    const key = randomUUID();
    const body = { value: "slow", delayMs: 500 };

    const original = post(cookie, key, body);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const duplicate = await post(cookie, key, body);

    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(ProblemDetailsSchema.parse(json(duplicate)).code).toBe("IDEMPOTENT_REPLAY");
    expect(duplicate.headers).not.toHaveProperty("retry-after");
    const first = await original;
    expect(first.statusCode).toBe(201);
    // Once the original completes, the same key replays it.
    const later = await post(cookie, key, body);
    expect(later.headers["idempotent-replayed"]).toBe("true");
    expect(later.body).toBe(first.body);
  });

  it("rejects a reused key with a different body or target", async () => {
    const { cookie } = await signedIn();
    const key = randomUUID();
    expect((await post(cookie, key, { value: "first", delayMs: 0 })).statusCode).toBe(201);

    const reused = [
      await post(cookie, key, { value: "second", delayMs: 0 }),
      await post(cookie, key, { value: "first", delayMs: 0 }, { url: "/v1/__test__/idempotent?again=1" }),
    ];

    for (const response of reused) {
      expect(response.statusCode, response.body).toBe(400);
      const problem = ProblemDetailsSchema.parse(json(response));
      expect(problem.code).toBe("VALIDATION");
      expect(problem.errors).toEqual([
        { path: "", message: expect.any(String) as string, code: "idempotency_key_reused" },
      ]);
    }
    // The same body with its keys in another order is the same request.
    const reordered = await post(cookie, key, { delayMs: 0, value: "first" });
    expect(reordered.headers["idempotent-replayed"]).toBe("true");
  });

  it("scopes keys per user", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    const key = randomUUID();

    const fromAlice = await post(alice.cookie, key, { value: "shared" });
    const fromBob = await post(bob.cookie, key, { value: "shared" });

    expect(json(fromAlice)).toEqual({ value: "shared", executions: 1 });
    expect(fromBob.statusCode).toBe(201);
    expect(fromBob.headers).not.toHaveProperty("idempotent-replayed");
    expect(json(fromBob)).toEqual({ value: "shared", executions: 1 });
    expect(await redis().exists(redisKeys.idempotency(alice.user.id, key))).toBe(1);
    expect(await redis().exists(redisKeys.idempotency(bob.user.id, key))).toBe(1);
  });

  it("stores records for at most 24 hours, and claims for at most 30 seconds", async () => {
    const { user, cookie } = await signedIn();
    const key = randomUUID();
    const redisKey = redisKeys.idempotency(user.id, key);

    const pending = post(cookie, key, { value: "ttl", delayMs: 400 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const claimTtl = await redis().pttl(redisKey);
    expect((await pending).statusCode).toBe(201);
    const recordTtl = await redis().pttl(redisKey);

    expect(claimTtl).toBeGreaterThan(0);
    expect(claimTtl).toBeLessThanOrEqual(30_000);
    expect(recordTtl).toBeGreaterThan(DAY_MS - 60_000);
    expect(recordTtl).toBeLessThanOrEqual(DAY_MS);
  });

  it("releases the key when the handler fails, so a retry runs again", async () => {
    const { user, cookie } = await signedIn();
    const key = randomUUID();
    const body = { value: "boom", fail: true };

    const failed = await post(cookie, key, body);
    const retried = await post(cookie, key, body);

    for (const response of [failed, retried]) {
      expect(response.statusCode).toBe(409);
      expect(ProblemDetailsSchema.parse(json(response)).code).toBe("CONFLICT");
    }
    expect(await redis().exists(redisKeys.idempotency(user.id, key))).toBe(0);
  });

  it("doesn't store responses over 64 KiB", async () => {
    const { user, cookie } = await signedIn();
    const key = randomUUID();
    const body = { value: "large", padBytes: 70_000 };

    const first = await post(cookie, key, body);
    const retry = await post(cookie, key, body);

    expect(first.statusCode).toBe(201);
    expect((json(retry) as { executions: number }).executions).toBe(2);
    expect(retry.headers).not.toHaveProperty("idempotent-replayed");
    expect(await redis().exists(redisKeys.idempotency(user.id, key))).toBe(0);
  });

  it("rejects a missing or malformed key, and anonymous requests before any claim", async () => {
    const { cookie } = await signedIn();

    for (const key of [undefined, "too-short", `${randomUUID()}:x`]) {
      const response = await post(cookie, key, { value: "nokey" });
      expect(response.statusCode, String(key)).toBe(400);
      expect(ProblemDetailsSchema.parse(json(response)).detail).toBe(
        "Send an Idempotency-Key header (16–128 letters, digits, '-' or '_').",
      );
    }
    const anonymous = await post(undefined, randomUUID(), { value: "nokey" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("runs no handler and leaves no record in flight when the deadline passes before the handler starts", async () => {
    const { user, cookie } = await signedIn();
    // A 200 ms deadline, and a route guard that holds the request for 500 ms: the client gets its 503 at 200 ms.
    const short = await createTestApp({}, { handlerTimeoutMs: 200 });
    try {
      const key = randomUUID();
      const value = `ended-${randomUUID()}`;

      const ended = await post(cookie, key, { value }, { app: short, headers: { [GUARD_DELAY_HEADER]: "500" } });
      expect(ended.statusCode, ended.body).toBe(503);
      expect(ProblemDetailsSchema.parse(json(ended)).code).toBe("SERVICE_UNAVAILABLE");
      // Let the guard finish: the request then reaches the interceptor, which must not claim the key or run anything.
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(await redis().exists(redisKeys.idempotency(user.id, key))).toBe(0);
      // The same key now runs the handler for the first time: the ended request never ran it.
      const retry = await post(cookie, key, { value }, { app: short });
      expect(retry.statusCode, retry.body).toBe(201);
      expect(json(retry)).toEqual({ value, executions: 1 });
      expect(retry.headers).not.toHaveProperty("idempotent-replayed");
    } finally {
      await short.close();
    }
  });

  it("fails closed with SERVICE_UNAVAILABLE when Redis is down", async () => {
    const { cookie } = await signedIn();
    const port = await closedPort();
    const down = await createTestApp({ REDIS_URL: `redis://127.0.0.1:${String(port)}` });
    try {
      const response = await post(cookie, randomUUID(), { value: "down" }, { app: down });

      expect(response.statusCode, response.body).toBe(503);
      const problem = ProblemDetailsSchema.parse(json(response));
      expect(problem.code).toBe("SERVICE_UNAVAILABLE");
      expect(problem.retryAfterSec).toBe(5);
      expect(response.headers["retry-after"]).toBe("5");
      expect(response.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|redis|idem:/i);
    } finally {
      await down.close();
    }
  });
});
