import { Global, Module } from "@nestjs/common";

import { RedisService } from "./redis.service";

/** One request-path Redis connection per process, for every module. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
