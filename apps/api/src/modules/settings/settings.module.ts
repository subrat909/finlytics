import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";

import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

/** `GET` and `PATCH /v1/me/settings`. Each change is audited (AuditModule) in the same transaction. */
@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
