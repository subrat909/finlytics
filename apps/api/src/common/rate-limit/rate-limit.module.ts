import { Module } from "@nestjs/common";

import { RateLimitService } from "./rate-limit.service";

/**
 * Redis-backed rate limiting (plan D7). AppModule registers RateLimitGuard globally (APP_GUARD, between SessionGuard
 * and AuthGuard); SessionGuard uses RateLimitService to charge failed session lookups.
 */
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
