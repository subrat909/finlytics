import { Module } from "@nestjs/common";

import { IdempotencyStore } from "./idempotency.store";

/**
 * Redis-backed idempotency (plan D8). AppModule registers IdempotencyInterceptor globally (APP_INTERCEPTOR, before
 * ZodSerializerInterceptor, so it is the outermost); it acts on `@Idempotent()` routes only.
 */
@Module({
  providers: [IdempotencyStore],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
