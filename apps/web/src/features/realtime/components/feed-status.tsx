"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { useRealtimeClient } from "./realtime-provider";
import { useConnectionStatus, useFeedStatus } from "../hooks/use-realtime";
import type { ConnectionStatus, MarketState } from "../store";

interface StatusView {
  label: string;
  /** Dot colour (a token utility); the label carries the meaning. */
  dot: string;
  hint?: string | undefined;
}

function viewOf(connection: ConnectionStatus, feed: MarketState["feed"]): StatusView {
  switch (connection) {
    case "idle":
    case "connecting":
      return { label: "Connecting…", dot: "bg-info" };
    case "reconnecting":
      return { label: "Reconnecting…", dot: "bg-warning", hint: "Prices resume when the connection is back." };
    case "unavailable":
      return { label: "Live prices unavailable", dot: "bg-loss", hint: "The realtime service didn't answer." };
    case "connected":
      if (feed === "down") return { label: "Feed down", dot: "bg-loss", hint: "The market feed is reconnecting." };
      if (feed === "stale") {
        return { label: "Feed delayed", dot: "bg-warning", hint: "No ticks for a while: the market may be closed." };
      }
      return { label: "Live", dot: "bg-profit" };
  }
}

/**
 * The socket and feed status as a small chip (plan 1.4 `status`), announced politely when it changes, with a retry
 * once the socket has given up.
 */
export function FeedStatus({ className }: { className?: string | undefined }) {
  const client = useRealtimeClient();
  const connection = useConnectionStatus();
  const feed = useFeedStatus();
  const view = viewOf(connection, feed);

  return (
    <div data-slot="feed-status" data-connection={connection} className={cn("flex items-center gap-2", className)}>
      <p
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg"
        title={view.hint}
      >
        <span aria-hidden="true" className={cn("size-2 rounded-full", view.dot)} />
        {view.label}
      </p>
      {connection === "unavailable" && client !== null ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            client.retry();
          }}
        >
          <RefreshCw aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
