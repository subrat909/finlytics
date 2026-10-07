/** DTOs for the settings module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { UserSettingsPatchSchema, UserSettingsSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

/** `GET` and `PATCH /v1/me/settings`: the complete settings. */
export class UserSettingsDto extends createZodDto(UserSettingsSchema) {}

/** The `PATCH /v1/me/settings` body: any subset of fields at any depth; unknown keys are rejected. */
export class UserSettingsPatchDto extends createZodDto(UserSettingsPatchSchema) {}
