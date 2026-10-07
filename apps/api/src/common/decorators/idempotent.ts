/**
 * `@Idempotent()` (plan D8; docs/04 §7 "Idempotency"): the route requires an `Idempotency-Key` header, and the global
 * IdempotencyInterceptor dedupes and replays it per user. For trading mutations: `POST /v1/orders` (2.1),
 * `POST /v1/strategies/:id/deploy` (4.3), `PUT /v1/agents/auto-trade` (5.4). The route must need a session (not
 * `@Public()`): keys are scoped per user.
 *
 * Also documents the header in OpenAPI, with the key's pattern from `IdempotencyKeySchema`.
 */
import { HEADERS, IdempotencyKeySchema } from "@finlytics/shared";
import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { ApiHeader } from "@nestjs/swagger";
import { z } from "zod";

export const IDEMPOTENT_KEY = "finlytics:idempotent";

/** The OpenAPI schema of the header: `{ type: "string", pattern }`, from the shared Zod schema. */
export function idempotencyKeyHeaderSchema(): { type: "string"; pattern: string } {
  const schema = z.toJSONSchema(IdempotencyKeySchema);
  if (typeof schema.pattern !== "string") throw new TypeError("IdempotencyKeySchema has no pattern");
  return { type: "string", pattern: schema.pattern };
}

export const Idempotent = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: HEADERS.idempotencyKey,
      required: true,
      description:
        "One key per intended action (crypto.randomUUID() fits), reused on every retry of it. A retry replays the " +
        "first 2xx response with Idempotent-Replayed: true; keys are scoped per user and kept for 24 hours.",
      schema: idempotencyKeyHeaderSchema(),
    }),
  );

/** Whether the handler is `@Idempotent()`. */
export function isIdempotentRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return reflector.get<boolean | undefined>(IDEMPOTENT_KEY, context.getHandler()) === true;
}
