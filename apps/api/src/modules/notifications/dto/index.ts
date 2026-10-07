/** DTOs for the notifications module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { MarkNotificationsReadSchema, NotificationListSchema, NotificationReadResultSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

export class NotificationListDto extends createZodDto(NotificationListSchema) {}
export class MarkNotificationsReadDto extends createZodDto(MarkNotificationsReadSchema) {}
export class NotificationReadResultDto extends createZodDto(NotificationReadResultSchema) {}
