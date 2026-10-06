import { Global, Module } from "@nestjs/common";

import { DatabaseRoleCheck } from "../prisma/database-role.check";

import { LifecycleService } from "./lifecycle.service";
import { ReadinessState } from "./readiness.state";

/**
 * Readiness state, the production database-role check and the ordered shutdown. Uses the global PrismaModule and
 * RedisModule.
 */
@Global()
@Module({
  providers: [ReadinessState, LifecycleService, DatabaseRoleCheck],
  exports: [ReadinessState, DatabaseRoleCheck],
})
export class LifecycleModule {}
