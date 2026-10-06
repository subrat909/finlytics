/**
 * The Oxc canary (plan D1): Nest's dependency injection reads `design:paramtypes`. tsc emits it for the build; under
 * Vitest, Vite 8's Oxc transform must emit the same, or DI breaks only in tests. Checked on a local class and on real
 * providers whose dependencies are imported from other modules (the case Oxc can't infer per file).
 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { describe, expect, it } from "vitest";

import { ReadinessState } from "../../src/infra/lifecycle/readiness.state";
import { PrismaService } from "../../src/infra/prisma/prisma.service";
import { IdempotencyStore } from "../../src/common/idempotency/idempotency.store";
import { RateLimitService } from "../../src/common/rate-limit/rate-limit.service";
import { RedisService } from "../../src/infra/redis/redis.service";
import { HealthService } from "../../src/modules/health/health.service";
import { SessionGuard } from "../../src/modules/auth/session.guard";
import { SessionService } from "../../src/modules/auth/session.service";
import { Reflector } from "@nestjs/core";

@Injectable()
class Dependency {}

@Injectable()
class Consumer {
  constructor(readonly dependency: Dependency) {}
}

describe("Oxc decorator metadata", () => {
  it("emits design:paramtypes for constructor-injected providers under Vitest", () => {
    expect(Reflect.getMetadata("design:paramtypes", Consumer)).toEqual([Dependency]);
    expect(Reflect.getMetadata("design:paramtypes", HealthService)).toEqual([
      PrismaService,
      RedisService,
      ReadinessState,
    ]);
    expect(Reflect.getMetadata("design:paramtypes", RedisService)).toEqual([ConfigService, PinoLogger]);
    expect(Reflect.getMetadata("design:paramtypes", SessionGuard)).toEqual([
      Reflector,
      SessionService,
      RateLimitService,
      ConfigService,
    ]);
    expect(Reflect.getMetadata("design:paramtypes", IdempotencyStore)).toEqual([RedisService]);
  });
});
