"use client";

import type { RtUserEvent } from "@finlytics/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useRealtimeClient } from "../components/realtime-provider";

/** The queries a `user` event refreshes, by kind. */
export const USER_EVENT_QUERY_KEYS: Readonly<Record<RtUserEvent["kind"], readonly (readonly string[])[]>> = {
  notification: [["notifications"]],
  broker: [["notifications"], ["brokers"], ["portfolio"], ["market", "overview"]],
};

/**
 * Keeps the bell and the broker status realtime: mounted once in the shell, it holds the tab's one socket open and
 * refetches what a `user` event names (no polling).
 */
export function useUserEvents(): void {
  const client = useRealtimeClient();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (client === null) return undefined;
    return client.onUserEvent((event) => {
      for (const queryKey of USER_EVENT_QUERY_KEYS[event.kind]) void queryClient.invalidateQueries({ queryKey });
    });
  }, [client, queryClient]);
}
