/**
 * The rate limiter (plan D7, D9). Global, third in line: CsrfGuard → SessionGuard → RateLimitGuard → AuthGuard. It
 * runs after SessionGuard so it knows who the request is, and before AuthGuard so an anonymous flood gets 429, not 401.
 *
 * - `@SkipRateLimit()`: nothing is charged and no headers are sent (the health probes).
 * - A signed-in request is charged to its user's `user` bucket, whatever its IP, then to each policy the route adds
 *   with `@RateLimit()` (stopping at the first refusal, so a refused request doesn't spend the next bucket).
 * - Any other request is charged to its client's anonymous buckets (`public`, plus `publicNet` for IPv6), once: a
 *   failed session lookup was already charged by SessionGuard, and that charge counts. An address this pod already
 *   knows is refused is answered without a Redis call (RateLimitService.chargePublic).
 * - Every decided check is reported in `RateLimit-Policy` and `RateLimit`; a refusal is 429 RATE_LIMITED with
 *   Retry-After.
 */
import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";

import { extraRateLimitPolicies } from "../decorators/rate-limit";
import { skipsRateLimit } from "../decorators/skip-rate-limit";

import type { RateLimitDecision } from "./headers";
import { enforceRateLimits, RateLimitService } from "./rate-limit.service";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (skipsRateLimit(this.reflector, context)) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const identity = request.identity;
    if (identity === null) {
      enforceRateLimits(reply, await this.limits.chargePublic(request));
      return true;
    }

    const checks: (RateLimitDecision | undefined)[] = [await this.limits.consume("user", identity.userId)];
    for (const policy of extraRateLimitPolicies(this.reflector, context)) {
      if (checks.some((check) => check?.allowed === false)) break;
      checks.push(await this.limits.consume(policy, identity.userId));
    }
    enforceRateLimits(reply, checks);
    return true;
  }
}
