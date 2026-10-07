import type { NotificationList, NotificationReadResult } from "@finlytics/shared";
import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import type { AuthIdentity } from "../auth/auth-identity";

import { MarkNotificationsReadDto, NotificationListDto, NotificationReadResultDto } from "./dto";
import { NotificationsService } from "./notifications.service";

/**
 * `/v1/notifications` (docs/04 §2): the signed-in user's in-app notifications. Marking read is idempotent by nature
 * (no Idempotency-Key); CSRF and the session apply as everywhere.
 */
@ApiTags("notifications")
@Controller("v1/notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ZodResponse({ status: 200, description: "The newest notifications and the unread count", type: NotificationListDto })
  list(@CurrentUser() identity: AuthIdentity): Promise<NotificationList> {
    return this.notifications.list(identity.userId);
  }

  @Post("read")
  @HttpCode(200)
  @ZodResponse({ status: 200, description: "The unread count left", type: NotificationReadResultDto })
  markRead(
    @CurrentUser() identity: AuthIdentity,
    @Body() body: MarkNotificationsReadDto,
  ): Promise<NotificationReadResult> {
    return this.notifications.markRead(identity.userId, body);
  }
}
