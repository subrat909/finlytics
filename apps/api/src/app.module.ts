/**
 * The root module (plan D2). `AppModule.forRoot(env)` takes the validated environment, so tests build an app from a
 * plain object instead of mutating process.env.
 *
 * Global enhancers, in registration order (Nest runs APP_GUARDs in that order):
 * - guards: CsrfGuard → SessionGuard → RateLimitGuard → AuthGuard
 * - pipe: ZodValidationPipe (strict schema declaration)
 * - interceptors: IdempotencyInterceptor (outermost: it stores and replays exactly what was sent) →
 *   ZodSerializerInterceptor
 * The exception filter is applied in bootstrap/http-app.ts (`useGlobalFilters`), so it also sees Fastify's errors.
 */
import { Module } from "@nestjs/common";
import type { DynamicModule, ForwardReference, Type } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ZodSerializerInterceptor } from "nestjs-zod";
import type { DestinationStream } from "pino";

import { ProblemDetailsFilter } from "./common/filters/problem-details.filter";
import { CsrfGuard } from "./common/guards/csrf.guard";
import { IdempotencyInterceptor } from "./common/idempotency/idempotency.interceptor";
import { IdempotencyModule } from "./common/idempotency/idempotency.module";
import { loggerModule } from "./common/logger/logger.module";
import { ZodValidationPipe } from "./common/pipes/zod-validation.pipe";
import { RateLimitGuard } from "./common/rate-limit/rate-limit.guard";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { configModule } from "./config/config.module";
import type { Env } from "./config/env.schema";
import { LifecycleModule } from "./infra/lifecycle/lifecycle.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { RedisModule } from "./infra/redis/redis.module";
import { AuthGuard } from "./modules/auth/auth.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { SessionGuard } from "./modules/auth/session.guard";
import { HealthModule } from "./modules/health/health.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { UsersModule } from "./modules/users/users.module";

type ImportableModule = Type | DynamicModule | Promise<DynamicModule> | ForwardReference;

export interface AppModuleOptions {
  /** Where logs go instead of stdout (the integration tests capture them). */
  readonly logDestination?: DestinationStream;
  /**
   * More modules, for the integration harness only (test/support probes such as the idempotency probe). main.ts never
   * sets it, so no test route is ever part of the built app.
   */
  readonly extraImports?: readonly ImportableModule[];
}

@Module({})
export class AppModule {
  static forRoot(env: Env, options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        configModule(env),
        loggerModule(env, options.logDestination),
        PrismaModule,
        RedisModule,
        LifecycleModule,
        RateLimitModule,
        IdempotencyModule,
        AuthModule,
        HealthModule,
        UsersModule,
        SettingsModule,
        ...(options.extraImports ?? []),
      ],
      providers: [
        ProblemDetailsFilter,
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      ],
    };
  }
}
