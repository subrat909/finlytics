/**
 * `@Public()` (plan D9): the route needs no session. CsrfGuard and SessionGuard skip it entirely, so a public route
 * never touches the database (`/health/live`); AuthGuard lets it through. In 0.5 only `/health/*` is public (A3).
 *
 * It also marks the OpenAPI operations (`x-finlytics-public`), so bootstrap/openapi.ts documents them without the
 * session cookie requirement.
 */
import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { ApiExtension } from "@nestjs/swagger";

export const IS_PUBLIC_KEY = "finlytics:public";

/** The OpenAPI extension `@Public()` sets on its operations; openapi.ts turns it into `security: []`. */
export const PUBLIC_OPERATION_EXTENSION = "x-finlytics-public";

export const Public = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension(PUBLIC_OPERATION_EXTENSION, true));

/** Whether the handler or its controller is `@Public()`. */
export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) === true
  );
}
