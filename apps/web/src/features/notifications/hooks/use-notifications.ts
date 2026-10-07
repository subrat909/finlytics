"use client";

import { NotificationListSchema, NotificationReadResultSchema } from "@finlytics/shared";
import type { NotificationList } from "@finlytics/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

/** `GET /v1/notifications`: fetched once, then refetched only on realtime `user` events (no polling). */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/notifications", NotificationListSchema, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** `POST /v1/notifications/read`: these ids, or all; the list updates at once. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: readonly string[]) =>
      apiRequest("/v1/notifications/read", NotificationReadResultSchema, {
        method: "POST",
        json: ids === undefined ? {} : { ids },
      }),
    onMutate: (ids) => {
      const now = new Date().toISOString();
      queryClient.setQueryData<NotificationList>(NOTIFICATIONS_QUERY_KEY, (list) => {
        if (list === undefined) return list;
        const items = list.items.map((item) =>
          item.readAt === null && (ids === undefined || ids.includes(item.id)) ? { ...item, readAt: now } : item,
        );
        return { items, unread: items.filter((item) => item.readAt === null).length };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });
}
