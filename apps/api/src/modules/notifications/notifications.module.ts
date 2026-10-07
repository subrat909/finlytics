import { Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";
import { UserEventsRelay } from "./user-events.relay";

/** `GET /v1/notifications` and `POST /v1/notifications/read` (the `http` role). */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
})
export class NotificationsModule {}

/** The user-event relay (every role: the worker's token jobs emit broker events too). */
@Module({ providers: [UserEventsRelay], exports: [UserEventsRelay] })
export class UserEventsModule {}
