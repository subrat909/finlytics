/**
 * The last global guard (plan D9): 401 UNAUTHENTICATED for a request without an identity, unless the route is
 * `@Public()`. Runs after SessionGuard and RateLimitGuard, so an anonymous flood gets 429, not 401.
 */
import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { isPublicRoute } from "../../common/decorators/public";
import { UnauthenticatedError } from "../../common/problem-json/domain-errors";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) return true;
    if (context.switchToHttp().getRequest<FastifyRequest>().identity === null) {
      throw new UnauthenticatedError("Sign in to continue.");
    }
    return true;
  }
}
