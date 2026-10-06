import type { Me } from "@finlytics/shared";
import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import type { AuthIdentity } from "../auth/auth-identity";

import { MeDto } from "./dto";
import { UsersService } from "./users.service";

/** `/v1/me`: the signed-in user (0.6's end-to-end test proves the session cookie reaches the api with it). */
@ApiTags("me")
@Controller("v1/me")
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ZodResponse({ status: 200, description: "The signed-in user", type: MeDto })
  me(@CurrentUser() identity: AuthIdentity): Promise<Me> {
    return this.users.getMe(identity.userId);
  }
}
