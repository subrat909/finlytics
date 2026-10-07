/**
 * `@RateLimit(...policies)` (plan D7): adds policies to a route or controller, on top of the default one (`user` for a
 * signed-in request, `public` otherwise). `@RateLimit("orders")` puts the per-user order cap on `POST /v1/orders`
 * (2.1). Added policies apply only to signed-in requests (they are per user); an anonymous request is refused by
 * AuthGuard anyway.
 */
import { SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

import type { ExtraRateLimitPolicyName } from "../rate-limit/policies";

export const RATE_LIMIT_POLICIES_KEY = "finlytics:rate-limit-policies";

export const RateLimit = (
  ...policies: [ExtraRateLimitPolicyName, ...ExtraRateLimitPolicyName[]]
): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_POLICIES_KEY, policies);

/** The policies a route adds, from its handler and controller, each once. */
export function extraRateLimitPolicies(
  reflector: Reflector,
  context: ExecutionContext,
): readonly ExtraRateLimitPolicyName[] {
  const policies = reflector.getAllAndMerge<ExtraRateLimitPolicyName[]>(RATE_LIMIT_POLICIES_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  return [...new Set(policies)];
}
