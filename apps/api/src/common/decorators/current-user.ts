/**
 * `@CurrentUser()`: the request's AuthIdentity, set by SessionGuard. On a route that isn't `@Public()`, AuthGuard has
 * already answered 401 without one; the check here only guards against using it on a public route.
 */
import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { AuthIdentity } from "../../modules/auth/auth-identity";
import { UnauthenticatedError } from "../problem-json/domain-errors";

/** The identity of the request in `context`. @throws {UnauthenticatedError} when there is none. */
export function currentIdentity(context: ExecutionContext): AuthIdentity {
  const identity = context.switchToHttp().getRequest<FastifyRequest>().identity;
  if (identity === null) throw new UnauthenticatedError("Sign in to continue.");
  return identity;
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  currentIdentity(context),
);
