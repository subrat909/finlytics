import { describe, expect, it, vi } from "vitest";

import type { ReadinessState } from "../../../infra/lifecycle/readiness.state";
import type { PrismaService } from "../../../infra/prisma/prisma.service";
import type { RedisService } from "../../../infra/redis/redis.service";
import { HealthService } from "../health.service";

interface SetupOptions {
  readonly database?: Promise<unknown>;
  readonly redisUp?: boolean;
  readonly draining?: boolean;
  readonly roleCheckPending?: boolean;
}

function setup({
  database = Promise.resolve([{ "?column?": 1 }]),
  redisUp = true,
  draining = false,
  roleCheckPending = false,
}: SetupOptions = {}) {
  const prisma = { unscoped: { $queryRaw: vi.fn(() => database) } };
  const redis = { ping: vi.fn().mockResolvedValue(redisUp) };
  const readiness = { isDraining: draining, isRoleCheckPending: roleCheckPending };
  return {
    service: new HealthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      readiness as unknown as ReadinessState,
    ),
    prisma,
    redis,
    readiness,
  };
}

describe("HealthService.ready", () => {
  it("is ready when the database and Redis answer", async () => {
    const { service, redis } = setup();

    await expect(service.ready()).resolves.toEqual({
      httpStatus: 200,
      body: { status: "ok", checks: { database: "up", redis: "up" } },
    });
    expect(redis.ping).toHaveBeenCalledWith(500);
  });

  it("reports which check failed, never why", async () => {
    await expect(
      setup({ database: Promise.reject(new Error("ECONNREFUSED 10.0.0.5:5432")) }).service.ready(),
    ).resolves.toEqual({
      httpStatus: 503,
      body: { status: "unavailable", checks: { database: "down", redis: "up" } },
    });
    await expect(setup({ redisUp: false }).service.ready()).resolves.toEqual({
      httpStatus: 503,
      body: { status: "unavailable", checks: { database: "up", redis: "down" } },
    });
  });

  it("counts a database check slower than 1 s as down", async () => {
    vi.useFakeTimers();
    try {
      const pending = setup({ database: new Promise(() => undefined) }).service.ready();
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({ httpStatus: 503, body: { checks: { database: "down" } } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports draining during shutdown and stays unavailable until the role check passed", async () => {
    await expect(setup({ draining: true }).service.ready()).resolves.toMatchObject({
      httpStatus: 503,
      body: { status: "draining" },
    });
    await expect(setup({ roleCheckPending: true }).service.ready()).resolves.toEqual({
      httpStatus: 503,
      body: { status: "unavailable", checks: { database: "up", redis: "up" } },
    });
  });

  it("shares one pair of checks between concurrent probes", async () => {
    let finish: (rows: unknown) => void = () => undefined;
    const { service, prisma, redis } = setup({ database: new Promise((resolve) => (finish = resolve)) });

    const probes = Array.from({ length: 5 }, () => service.ready());
    finish([{ "?column?": 1 }]);
    const results = await Promise.all(probes);

    expect(prisma.unscoped.$queryRaw).toHaveBeenCalledOnce();
    expect(redis.ping).toHaveBeenCalledOnce();
    expect(results.every((result) => result.httpStatus === 200)).toBe(true);
  });

  it("reuses the checks for a second, then checks again", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const { service, prisma } = setup();

    await service.ready();
    clock.mockReturnValue(10_999);
    await service.ready();
    expect(prisma.unscoped.$queryRaw).toHaveBeenCalledOnce();

    clock.mockReturnValue(11_000);
    await service.ready();
    expect(prisma.unscoped.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("reads draining fresh, even when the checks come from the cache", async () => {
    const { service, readiness } = setup();

    await expect(service.ready()).resolves.toMatchObject({ httpStatus: 200 });
    readiness.isDraining = true;

    await expect(service.ready()).resolves.toMatchObject({ httpStatus: 503, body: { status: "draining" } });
  });
});
