/**
 * `@SkipRateLimit()` (plan D7): RateLimitGuard leaves the route alone, no bucket is charged and no RateLimit headers
 * are sent. Only for traffic that must never be throttled and touches nothing shared: the health probes, which the
 * ingress never routes (D13).
 */
import { SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

export const SKIP_RATE_LIMIT_KEY = "finlytics:skip-rate-limit";

export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

/** Whether the handler or its controller is `@SkipRateLimit()`. */
export function skipsRateLimit(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
