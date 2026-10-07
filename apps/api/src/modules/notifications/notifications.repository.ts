/** Prisma queries for in-app notifications, always scoped by `userId`. */
import { MAX_NOTIFICATIONS } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

export interface NotificationRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly severity: string;
  readonly category: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  latest(userId: string): Promise<NotificationRow[]> {
    return this.prisma.db.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_NOTIFICATIONS,
      select: { id: true, title: true, body: true, severity: true, category: true, createdAt: true, readAt: true },
    });
  }

  unread(userId: string): Promise<number> {
    return this.prisma.db.notification.count({ where: { userId, readAt: null } });
  }

  /** Marks the user's unread notifications (these ids, or all) as read now. */
  async markRead(userId: string, ids: readonly string[] | undefined, now: Date): Promise<void> {
    await this.prisma.db.notification.updateMany({
      where: { userId, readAt: null, ...(ids === undefined ? {} : { id: { in: [...ids] } }) },
      data: { readAt: now },
    });
  }
}
