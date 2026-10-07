import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../../config/env.schema";
import type { PrismaService } from "../../prisma/prisma.service";
import type { RedisService } from "../../redis/redis.service";
import { LifecycleService } from "../lifecycle.service";
import { ReadinessState } from "../readiness.state";

const logger = () => ({ setContext: vi.fn(), info: vi.fn(), warn: vi.fn() }) as unknown as PinoLogger;
const config = (values: Partial<Record<keyof Env, unknown>>) =>
  ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

describe("ReadinessState", () => {
  it("waits for the role check in production only", () => {
    expect(new ReadinessState(config({ NODE_ENV: "production" })).isRoleCheckPending).toBe(true);
    expect(new ReadinessState(config({ NODE_ENV: "development" })).isRoleCheckPending).toBe(false);
    const state = new ReadinessState(config({ NODE_ENV: "production" }));
    state.markRoleCheckPassed();
    state.startDraining();
    expect(state).toMatchObject({ isRoleCheckPending: false, isDraining: true });
  });
});

describe("LifecycleService", () => {
  it("drains, waits, then closes Prisma before Redis", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const readiness = new ReadinessState(config({ NODE_ENV: "test" }));
      const prisma = { close: vi.fn(() => (order.push("prisma"), Promise.resolve())) };
      const redis = { close: vi.fn(() => (order.push("redis"), Promise.resolve())) };
      const service = new LifecycleService(
        config({ API_SHUTDOWN_DRAIN_MS: 5_000 }),
        readiness,
        prisma as unknown as PrismaService,
        redis as unknown as RedisService,
        logger(),
      );

      service.onModuleDestroy();
      expect(readiness.isDraining).toBe(true);
      let drained = false;
      const draining = service.beforeApplicationShutdown().then(() => (drained = true));
      await vi.advanceTimersByTimeAsync(4_999);
      expect(drained).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await draining;
      await service.onApplicationShutdown();
      expect(order).toEqual(["prisma", "redis"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LifecycleService when closing the database fails", () => {
  it("still closes Redis", async () => {
    const redis = { close: vi.fn(() => Promise.resolve()) };
    const service = new LifecycleService(
      config({ API_SHUTDOWN_DRAIN_MS: 0 }),
      new ReadinessState(config({ NODE_ENV: "test" })),
      { close: vi.fn(() => Promise.reject(new Error("disconnect failed"))) } as unknown as PrismaService,
      redis as unknown as RedisService,
      logger(),
    );

    await expect(service.onApplicationShutdown()).rejects.toThrow("disconnect failed");
    expect(redis.close).toHaveBeenCalledOnce();
  });
});
