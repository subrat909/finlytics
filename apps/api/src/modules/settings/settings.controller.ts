import type { UserSettings } from "@finlytics/shared";
import { Body, Controller, Get, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import { RequestMeta } from "../../common/decorators/request-meta";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import type { AuthIdentity } from "../auth/auth-identity";

import { UserSettingsDto, UserSettingsPatchDto } from "./dto";
import { SettingsService } from "./settings.service";

/**
 * `/v1/me/settings` (docs/04 §2): the signed-in user's preferences. PATCH is idempotent by nature (applying the same
 * patch twice gives the same result), so it takes no Idempotency-Key; CSRF and the session apply as everywhere.
 */
@ApiTags("settings")
@Controller("v1/me/settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ZodResponse({
    status: 200,
    description: "The complete settings, with defaults for anything unset",
    type: UserSettingsDto,
  })
  get(@CurrentUser() identity: AuthIdentity): Promise<UserSettings> {
    return this.settings.get(identity.userId);
  }

  @Patch()
  @ZodResponse({ status: 200, description: "The complete settings after the patch", type: UserSettingsDto })
  update(
    @CurrentUser() identity: AuthIdentity,
    @Body() patch: UserSettingsPatchDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<UserSettings> {
    return this.settings.update(identity.userId, patch, request);
  }
}
