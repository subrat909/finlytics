/** The navbar bell: the newest notifications, the unread count, and marking them read. */
import { NOTIFICATION_SEVERITIES } from "@finlytics/shared";
import type {
  MarkNotificationsRead,
  NotificationList,
  NotificationReadResult,
  NotificationSeverity,
} from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { NotificationsRepository } from "./notifications.repository";
import type { NotificationRow } from "./notifications.repository";

function severityOf(value: string): NotificationSeverity {
  return (NOTIFICATION_SEVERITIES as readonly string[]).includes(value) ? (value as NotificationSeverity) : "info";
}

export function toNotificationView(row: NotificationRow): NotificationList["items"][number] {
  return {
    id: row.id,
    title: row.title.slice(0, 200),
    body: row.body.slice(0, 2000),
    severity: severityOf(row.severity),
    category: row.category.slice(0, 32),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  async list(userId: string): Promise<NotificationList> {
    const [rows, unread] = await Promise.all([this.notifications.latest(userId), this.notifications.unread(userId)]);
    return { items: rows.map(toNotificationView), unread };
  }

  async markRead(userId: string, body: MarkNotificationsRead, now = new Date()): Promise<NotificationReadResult> {
    await this.notifications.markRead(userId, body.ids, now);
    return { unread: await this.notifications.unread(userId) };
  }
}
