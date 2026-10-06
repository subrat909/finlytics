import { Module } from "@nestjs/common";

import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";

/** The append-only audit log. Modules that audit their mutations import this one and call AuditService.record(tx, …). */
@Module({
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
