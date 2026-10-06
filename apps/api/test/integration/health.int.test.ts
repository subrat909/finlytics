/**
 * Liveness, readiness, draining and the production database-role check (plan D2, D13, D14) against the run's
 * TimescaleDB and Redis containers.
 */
import { once } from "node:events";
import { connect } from "node:net";

import { HealthReadySchema, ProblemDetailsSchema } from "@finlytics/shared";
import type { PrismaClient } from "@finlytics/database";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { DatabaseRoleCheck, UnsafeDatabaseRoleError } from "../../src/infra/prisma/database-role.check";
import { PrismaService } from "../../src/infra/prisma/prisma.service";
import { RedisService } from "../../src/infra/redis/redis.service";

import { closedPort, createTestApp, json, PRODUCTION_ENV } from "./app";
import { createAppRole, fixturesClient } from "./fixtures";
import { TcpProxy } from "./tcp-proxy";

describe("liveness and readiness", () => {
  it("answers /health/live without touching the database or Redis", async () => {
    // Both dependencies down: liveness must not care.
    const port = await closedPort();
    const { request, close } = await createTestApp({
      DATABASE_URL: `postgresql://nobody:nothing@127.0.0.1:${String(port)}/none`,
      REDIS_URL: `redis://127.0.0.1:${String(port)}`,
    });
    try {
      const response = await request({ method: "GET", url: "/health/live" });

      expect(response.statusCode).toBe(200);
      expect(json(response)).toEqual({ status: "ok" });
      expect(response.headers["x-request-id"]).toEqual(expect.any(String));
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await close();
    }
  });

  it("reports ready with the database and Redis up", async () => {
    const { request, close } = await createTestApp();
    try {
      const response = await request({ method: "GET", url: "/health/ready" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expect(HealthReadySchema.parse(json(response))).toEqual({
        status: "ok",
        checks: { database: "up", redis: "up" },
      });
    } finally {
      await close();
    }
  });

  it("reports unavailable without hostnames or error text when Redis is down", async () => {
    const port = await closedPort();
    const { request, close } = await createTestApp({ REDIS_URL: `redis://127.0.0.1:${String(port)}` });
    try {
      const response = await request({ method: "GET", url: "/health/ready" });

      expect(response.statusCode).toBe(503);
      expect(json(response)).toEqual({ status: "unavailable", checks: { database: "up", redis: "down" } });
      expect(response.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|error|redis:\/\//i);
    } finally {
      await close();
    }
  });

  it("reports Redis down while it is unreachable and ready again once it is back", async () => {
    const redisUrl = new URL(inject("redisUrl"));
    const proxy = await TcpProxy.start({ host: redisUrl.hostname, port: Number(redisUrl.port) });
    const proxied = new URL(redisUrl.href);
    proxied.hostname = "127.0.0.1";
    proxied.port = String(proxy.port);
    const { request, close } = await createTestApp({ REDIS_URL: proxied.href });
    const readiness = async () => (await request({ method: "GET", url: "/health/ready" })).statusCode;
    /** Polls readiness until it answers `status`, for at most `timeoutMs`. */
    const eventually = async (status: number, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while ((await readiness()) !== status) {
        if (Date.now() > deadline) throw new Error(`readiness never answered ${String(status)}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    try {
      expect(await readiness()).toBe(200);

      proxy.down(); // `docker compose stop redis`
      await eventually(503, 3_000);

      proxy.up(); // `docker compose start redis`: ioredis reconnects with backoff (at most 5 s)
      await eventually(200, 10_000);
    } finally {
      await close();
      await proxy.close();
    }
  });

  it("reports unavailable when the database is down", async () => {
    const port = await closedPort();
    const { request, close } = await createTestApp({
      DATABASE_URL: `postgresql://nobody:nothing@127.0.0.1:${String(port)}/none`,
    });
    try {
      const response = await request({ method: "GET", url: "/health/ready" });

      expect(response.statusCode).toBe(503);
      expect(json(response)).toEqual({ status: "unavailable", checks: { database: "down", redis: "up" } });
    } finally {
      await close();
    }
  });
});

describe("graceful shutdown", () => {
  it("reports draining after SIGTERM and closes Prisma and Redis only after in-flight requests finish", async () => {
    const { app, close } = await createTestApp({ API_SHUTDOWN_DRAIN_MS: "400" }, { listen: true });
    const events: string[] = [];
    // Recorded by the server, when a response has been sent in full.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook("onResponse", (request, reply, done) => {
        events.push(`${request.url.split("?")[0] ?? ""} answered ${String(reply.statusCode)}`);
        done();
      });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = await app.getUrl();
    const prisma = app.get(PrismaService);
    const redis = app.get(RedisService);
    const prismaClose = prisma.close.bind(prisma);
    const redisClose = redis.close.bind(redis);
    vi.spyOn(prisma, "close").mockImplementation(async () => {
      events.push("prisma closed");
      await prismaClose();
    });
    vi.spyOn(redis, "close").mockImplementation(async () => {
      events.push("redis closed");
      await redisClose();
    });

    // A request still running a query when shutdown starts: closing Prisma early would fail it.
    const inFlight = fetch(`${base}/v1/__test__/db/sleep?ms=900`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // SIGTERM runs the same hooks as close(): draining, the drain delay, closing Fastify, then the clients.
    const closing = close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ready = await fetch(`${base}/health/ready`);

    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ status: "draining" });
    expect(ready.headers.get("connection")).toBe("close");
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slept: 900 });
    await closing;
    expect(events).toEqual([
      "/health/ready answered 503",
      "/v1/__test__/db/sleep answered 200",
      "prisma closed",
      "redis closed",
    ]);
  });
});

describe("closing", () => {
  it("answers a request that arrives while the server closes with a SERVICE_UNAVAILABLE problem and Connection: close", async () => {
    const { app, close } = await createTestApp({}, { listen: true });
    let received = "";
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const fastify = app.getHttpAdapter().getInstance();
      const socket = connect(Number(new URL(await app.getUrl()).port), "127.0.0.1");
      await once(socket, "connect");
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        received += chunk;
      });
      const ended = once(socket, "close");

      // A request in flight keeps this keep-alive connection open while the server closes (idle ones are reaped).
      socket.write("GET /v1/__test__/slow?ms=600 HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Fastify alone, without Nest's drain: the in-flight response then keeps the connection alive, so the response
      // to the next request on it is delivered and can be inspected (after a drain, both would close the connection).
      const fastifyClosed = fastify.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      // A second request on the same connection, after closing started.
      socket.write("GET /health/live HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await fastifyClosed;
      await ended;
    } finally {
      await close(); // Nest's own shutdown (Prisma, Redis); Fastify may already be closed
    }

    const [first = "", second = ""] = received.split(/(?=HTTP\/1\.1 )/);
    expect(first).toMatch(/^HTTP\/1\.1 200 /);
    expect(first).toContain('{"slept":600}');
    expect(second).toMatch(/^HTTP\/1\.1 503 /);
    expect(second.toLowerCase()).toContain("connection: close");
    expect(second.toLowerCase()).toContain("content-type: application/problem+json");
    expect(second.toLowerCase()).toContain("retry-after: 1");
    const problem = ProblemDetailsSchema.parse(JSON.parse(second.slice(second.indexOf("\r\n\r\n") + 4)));
    expect(problem).toMatchObject({ code: "SERVICE_UNAVAILABLE", retryAfterSec: 1 });
  });
});

describe("production database role check", () => {
  let fixtures: PrismaClient;
  let appRoleUrl: string;

  beforeAll(async () => {
    fixtures = fixturesClient();
    appRoleUrl = await createAppRole(fixtures, inject("databaseUrl"));
  });

  afterAll(async () => {
    await fixtures.$disconnect();
  });

  it("stays not ready in production until the role check passes", async () => {
    const { app, request, close } = await createTestApp({ ...PRODUCTION_ENV, DATABASE_URL: appRoleUrl });
    try {
      const before = await request({ method: "GET", url: "/health/ready" });
      expect(before.statusCode).toBe(503);
      expect(json(before)).toEqual({ status: "unavailable", checks: { database: "up", redis: "up" } });

      await app.get(DatabaseRoleCheck).enforce({ retryForMs: 0 });

      const after = await request({ method: "GET", url: "/health/ready" });
      expect(after.statusCode).toBe(200);
      expect(after.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    } finally {
      await close();
    }
  });

  it("refuses to start in production as a member of a superuser role or of pg_write_server_files", async () => {
    for (const grant of ["superuser-member", "server-files"] as const) {
      const url = await createAppRole(fixtures, inject("databaseUrl"), [grant]);
      const { app, close } = await createTestApp({ ...PRODUCTION_ENV, DATABASE_URL: url });
      try {
        const failure: unknown = await app
          .get(DatabaseRoleCheck)
          .enforce({ retryForMs: 0 })
          .catch((error: unknown) => error);

        expect(failure, grant).toBeInstanceOf(UnsafeDatabaseRoleError);
        expect((failure as UnsafeDatabaseRoleError).facts, grant).toMatchObject({
          superuser: false,
          memberOfSuperuser: grant === "superuser-member",
          serverFileAccess: grant === "server-files",
        });
      } finally {
        await close();
      }
    }
  });

  it("refuses to start in production as a superuser", async () => {
    // The container's user is a superuser.
    const { app, request, close } = await createTestApp({ ...PRODUCTION_ENV });
    try {
      await expect(app.get(DatabaseRoleCheck).enforce({ retryForMs: 0 })).rejects.toBeInstanceOf(
        UnsafeDatabaseRoleError,
      );
      expect((await request({ method: "GET", url: "/health/ready" })).statusCode).toBe(503);
    } finally {
      await close();
    }
  });
});
