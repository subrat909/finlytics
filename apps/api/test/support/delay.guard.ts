/**
 * Test-only: a route guard that holds a request for `x-test-guard-delay-ms` milliseconds (at most 5 s) before letting
 * it through, so the integration tests can end a request (its deadline, or the client going away) after the global
 * guards and before the handler. Without the header it passes at once.
 */
import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export const GUARD_DELAY_HEADER = "x-test-guard-delay-ms";

@Injectable()
export class DelayGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const header = context.switchToHttp().getRequest<FastifyRequest>().headers[GUARD_DELAY_HEADER];
    const ms = typeof header === "string" && /^\d{1,4}$/.test(header) ? Math.min(Number(header), 5_000) : 0;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    return true;
  }
}
