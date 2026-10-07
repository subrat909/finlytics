"use client";

import type { NotificationView } from "@finlytics/shared";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@finlytics/ui/components/popover";
import { cn } from "@finlytics/ui/lib/utils";

import { formatIstDate } from "@/features/realtime/format";

import { useMarkNotificationsRead, useNotifications } from "../hooks/use-notifications";

const SEVERITY_DOT: Readonly<Record<NotificationView["severity"], string>> = {
  info: "bg-info",
  success: "bg-profit",
  warning: "bg-warning",
  error: "bg-loss",
};

/** `just now`, `5m ago`, `3h ago`, `2d ago`, then the date. */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1_000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3_600))}h ago`;
  if (seconds < 7 * 86_400) return `${String(Math.floor(seconds / 86_400))}d ago`;
  return formatIstDate(iso);
}

const iconButton =
  "relative flex size-9 cursor-pointer items-center justify-center rounded-sm text-fg-muted transition-[color,background-color] hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=open]:bg-surface-2 data-[state=open]:text-fg";

/**
 * The navbar bell: the unread count on the icon, the newest notifications in a popover (severity dot, title, body,
 * time), a click marks one read, "Mark all read" the rest. Realtime through `user` events; nothing polls.
 */
export function NotificationsMenu() {
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = notifications.data?.unread ?? 0;
  const items = notifications.data?.items ?? [];
  // "5m ago" is measured from when the menu opened (render stays pure).
  const [now, setNow] = useState(0);
  const label = unread === 0 ? "Notifications" : `Notifications, ${String(unread)} unread`;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setNow(Date.now());
      }}
    >
      <PopoverTrigger aria-label={label} data-slot="notifications-trigger" className={iconButton}>
        <Bell aria-hidden="true" className="size-4.5" />
        {unread === 0 ? null : (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-loss px-1 text-[10px] leading-none font-semibold text-white tabular"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Notifications"
        data-slot="notifications"
        className="w-[min(92vw,22rem)] p-0"
      >
        <div className="flex h-10 items-center justify-between border-b border-border px-3">
          <h2 className="text-sm font-semibold text-fg">Notifications</h2>
          <button
            type="button"
            disabled={unread === 0 || markRead.isPending}
            onClick={() => {
              markRead.mutate(undefined);
            }}
            className="flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-1 text-xs font-medium text-highlight hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid disabled:cursor-default disabled:text-fg-muted disabled:hover:bg-transparent"
          >
            <CheckCheck aria-hidden="true" className="size-3.5" />
            Mark all read
          </button>
        </div>
        {notifications.isError ? (
          <p className="px-3 py-6 text-center text-sm text-fg-muted">Couldn&apos;t load notifications.</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <Bell aria-hidden="true" className="size-6 text-fg-muted" />
            <p className="text-sm font-medium text-fg">You&apos;re all caught up</p>
            <p className="text-xs text-fg-muted">Broker, order and alert updates appear here.</p>
          </div>
        ) : (
          <ul aria-label="Recent notifications" className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    if (item.readAt === null) markRead.mutate([item.id]);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
                    item.readAt === null && "bg-primary/5",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm text-fg", item.readAt === null && "font-semibold")}>
                        {item.title}
                      </span>
                      <span className="shrink-0 text-2xs text-fg-muted">{timeAgo(item.createdAt, now)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{item.body}</span>
                    {item.readAt === null ? <span className="sr-only">Unread</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
