/**
 * `POST /v1/__test__/idempotent` (plan §6): the integration harness's stand-in for `POST /v1/orders` (2.1), so the
 * idempotency tests run through a real route. Test-only: ProbeModule adds it through `extraImports`; it is never part
 * of AppModule or dist.
 *
 * It counts its own executions per user and value, so a test can tell a replay (same count) from a re-run.
 * - `x-test-guard-delay-ms` header: hold the request in a route guard, before the idempotency claim (deadline tests).
 * - `delayMs`: hold the request in flight (concurrent duplicates).
 * - `fail`: answer 409 CONFLICT (a failure releases the key).
 * - `padBytes`: a response too large to store.
 */
import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import { CurrentUser } from "../../src/common/decorators/current-user";
import { Idempotent } from "../../src/common/decorators/idempotent";
import { ConflictError } from "../../src/common/problem-json/domain-errors";
import type { AuthIdentity } from "../../src/modules/auth/auth-identity";

import { DelayGuard } from "./delay.guard";

class IdempotentProbeBody extends createZodDto(
  z.strictObject({
    value: z.string().min(1).max(100),
    delayMs: z.int().min(0).max(5_000).optional(),
    fail: z.boolean().optional(),
    padBytes: z.int().min(0).max(200_000).optional(),
  }),
) {}

export interface IdempotentProbeResult {
  readonly value: string;
  readonly executions: number;
  readonly pad?: string;
}

@Controller("v1/__test__/idempotent")
export class IdempotencyProbeController {
  private readonly executions = new Map<string, number>();

  @Post()
  @HttpCode(201)
  @Idempotent()
  @UseGuards(DelayGuard)
  async run(@CurrentUser() identity: AuthIdentity, @Body() body: IdempotentProbeBody): Promise<IdempotentProbeResult> {
    const counter = `${identity.userId}:${body.value}`;
    const executions = (this.executions.get(counter) ?? 0) + 1;
    this.executions.set(counter, executions);
    if (body.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, body.delayMs));
    if (body.fail === true) throw new ConflictError("The probe failed on purpose.");
    return {
      value: body.value,
      executions,
      ...(body.padBytes === undefined ? {} : { pad: "x".repeat(body.padBytes) }),
    };
  }
}
