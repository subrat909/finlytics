/**
 * Test-only routes under `/v1/__test__` that the integration harness adds (AppModuleOptions.extraImports). They live
 * in test/, so they are never part of AppModule or dist (tsconfig.build.json compiles src/ only).
 *
 * - Public probes for the error paths: a slow handler (timeouts, shutdown), an unhandled error, a failing query, a
 *   held pool connection, a bigint payload.
 * - `POST echo`: an authenticated JSON route, for CSRF, validation, body-limit and media-type tests.
 * - `POST guarded` / `GET guarded/:value`: a public route behind DelayGuard (./delay.guard.ts) that records which values
 *   its handler ran for, so a test can prove an ended request ran none.
 * - `GET orders`: an authenticated route with the `orders` rate-limit policy.
 * - `POST idempotent` (./idempotency-probe.controller.ts): an `@Idempotent()` route.
 */
import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import { CurrentUser } from "../../src/common/decorators/current-user";
import { Public } from "../../src/common/decorators/public";
import { RateLimit } from "../../src/common/decorators/rate-limit";
import { PrismaService } from "../../src/infra/prisma/prisma.service";
import type { AuthIdentity } from "../../src/modules/auth/auth-identity";

import { DelayGuard } from "./delay.guard";
import { IdempotencyProbeController } from "./idempotency-probe.controller";

class DelayQuery extends createZodDto(z.strictObject({ ms: z.coerce.number().int().min(0).max(10_000) })) {}

class EchoBody extends createZodDto(
  z.strictObject({ value: z.string().min(1).max(100), nested: z.strictObject({ flag: z.boolean() }).optional() }),
) {}

class GuardedParams extends createZodDto(z.strictObject({ value: z.string().min(1).max(100) })) {}

/** A secret-looking marker the "never leaks" tests search every response body and log line for. */
export const LEAK_MARKER = "pw_SECRET_7f3a";

@Controller("v1/__test__")
export class ProbeController {
  /** The values `POST guarded` ran its handler for. */
  private readonly guardedRuns = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post("guarded")
  @HttpCode(200)
  @UseGuards(DelayGuard)
  guarded(@Body() body: EchoBody): { ran: string } {
    this.guardedRuns.add(body.value);
    return { ran: body.value };
  }

  @Public()
  @Get("guarded/:value")
  guardedRan(@Param() params: GuardedParams): { ran: boolean } {
    return { ran: this.guardedRuns.has(params.value) };
  }

  @Public()
  @Get("slow")
  async slow(@Query() query: DelayQuery): Promise<{ slept: number }> {
    await new Promise((resolve) => setTimeout(resolve, query.ms));
    return { slept: query.ms };
  }

  /** The same delay for a request with a body: Fastify's own handlerTimeout never fired for these (request-deadline.ts). */
  @Public()
  @Post("slow")
  @HttpCode(200)
  async slowWithBody(@Query() query: DelayQuery): Promise<{ slept: number }> {
    await new Promise((resolve) => setTimeout(resolve, query.ms));
    return { slept: query.ms };
  }

  @Public()
  @Get("boom")
  boom(): never {
    throw new Error(`SELECT * FROM "User" WHERE password = '${LEAK_MARKER}'`);
  }

  @Public()
  @Get("db/bad-sql")
  async badSql(): Promise<unknown> {
    return this.prisma.db.$queryRaw`SELECT * FROM "NoSuchTable" WHERE secret = ${LEAK_MARKER}`;
  }

  @Public()
  @Get("db/sleep")
  async dbSleep(@Query() query: DelayQuery): Promise<{ slept: number }> {
    // $executeRaw: pg_sleep returns `void`, which $queryRaw can't deserialize.
    await this.prisma.db.$executeRaw`SELECT pg_sleep(${query.ms / 1000}::double precision)`;
    return { slept: query.ms };
  }

  @Public()
  @Get("db/ping")
  async dbPing(): Promise<{ ok: true }> {
    await this.prisma.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }

  @Public()
  @Get("bigint")
  bigint(): { id: bigint; price: { toJSON(): string } } {
    return { id: 9_007_199_254_740_993n, price: { toJSON: () => "24000.0500" } };
  }

  @Post("echo")
  @HttpCode(200)
  echo(@CurrentUser() identity: AuthIdentity, @Body() body: EchoBody): { userId: string; value: string } {
    return { userId: identity.userId, value: body.value };
  }

  /** Stands in for `POST /v1/orders` (2.1): the per-user `orders` policy, which fails closed. */
  @Get("orders")
  @RateLimit("orders")
  orders(@CurrentUser() identity: AuthIdentity): { userId: string } {
    return { userId: identity.userId };
  }
}

@Module({ controllers: [ProbeController, IdempotencyProbeController] })
export class ProbeModule {}
