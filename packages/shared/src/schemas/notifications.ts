/**
 * In-app notifications (the navbar bell): `GET /v1/notifications` and `POST /v1/notifications/read`. New ones are
 * announced over the realtime socket (`user` event), never polled.
 */
import { z } from "zod";

export const NOTIFICATION_SEVERITIES = Object.freeze(["info", "success", "warning", "error"] as const);
export const NotificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/** The most notifications one list returns (newest first). */
export const MAX_NOTIFICATIONS = 30;

const NotificationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Expected a notification id");

export const NotificationViewSchema = z.strictObject({
  id: NotificationIdSchema,
  title: z.string().max(200),
  body: z.string().max(2000),
  severity: NotificationSeveritySchema,
  /** `order`, `alert`, `agent`, `broker` or `system`. */
  category: z.string().max(32),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;

/** `GET /v1/notifications`: the newest {@link MAX_NOTIFICATIONS} and the unread count. */
export const NotificationListSchema = z.strictObject({
  items: z.array(NotificationViewSchema).max(MAX_NOTIFICATIONS),
  unread: z.int().min(0),
});
export type NotificationList = z.infer<typeof NotificationListSchema>;

/** `POST /v1/notifications/read`: these ids, or every unread one when `ids` is absent. */
export const MarkNotificationsReadSchema = z.strictObject({
  ids: z.array(NotificationIdSchema).min(1).max(MAX_NOTIFICATIONS).optional(),
});
export type MarkNotificationsRead = z.infer<typeof MarkNotificationsReadSchema>;

/** The answer to a mark-read: the unread count left. */
export const NotificationReadResultSchema = z.strictObject({ unread: z.int().min(0) });
export type NotificationReadResult = z.infer<typeof NotificationReadResultSchema>;
