"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { useRealtimeClient } from "./realtime-provider";
import { useConnectionStatus, useFeedStatus } from "../hooks/use-realtime";
import type { ConnectionStatus, MarketState } from "../store";

interface StatusView {
  label: string;
  /** A one-word label for tight headers (`compact`); the full label stays the accessible text. */
  short: string;
  /** Dot colour (a token utility); the label carries the meaning. */
  dot: string;
  hint?: string | undefined;
}

function viewOf(connection: ConnectionStatus, feed: MarketState["feed"]): StatusView {
  switch (connection) {
    case "idle":
    case "connecting":
      return { label: "Connecting…", short: "Connecting", dot: "bg-info" };
    case "reconnecting":
      return {
        label: "Reconnecting…",
        short: "Reconnecting",
        dot: "bg-warning",
        hint: "Prices resume when the connection is back.",
      };
    case "unavailable":
      return {
        label: "Live prices unavailable",
        short: "Offline",
        dot: "bg-loss",
        hint: "The realtime service didn't answer.",
      };
    case "connected":
      if (feed === "down") {
        return { label: "Feed down", short: "Feed down", dot: "bg-loss", hint: "The market feed is reconnecting." };
      }
      if (feed === "stale") {
        return {
          label: "Feed delayed",
          short: "Delayed",
          dot: "bg-warning",
          hint: "No ticks for a while: the market may be closed.",
        };
      }
      return { label: "Live", short: "Live", dot: "bg-profit" };
  }
}

export interface FeedStatusProps {
  className?: string | undefined;
  /** One word and an icon-only retry, for panel headers. */
  compact?: boolean | undefined;
}

/**
 * The socket and feed status as a small chip (plan 1.4 `status`), announced politely when it changes, with a retry
 * once the socket has given up.
 */
export function FeedStatus({ className, compact = false }: FeedStatusProps) {
  const client = useRealtimeClient();
  const connection = useConnectionStatus();
  const feed = useFeedStatus();
  const view = viewOf(connection, feed);

  return (
    <div
      data-slot="feed-status"
      data-connection={connection}
      className={cn("flex items-center", compact ? "gap-1" : "gap-2", className)}
    >
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center rounded-full bg-surface-2 font-medium text-fg",
          compact ? "h-6 gap-1.5 px-2 text-[11px]" : "gap-2 px-2.5 py-1 text-xs",
        )}
        title={view.hint}
      >
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", view.dot)} />
        {compact ? (
          <>
            <span aria-hidden="true">{view.short}</span>
            <span className="sr-only">{view.label}</span>
          </>
        ) : (
          view.label
        )}
      </p>
      {connection === "unavailable" && client !== null ? (
        compact ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Retry"
            className="size-6"
            onClick={() => {
              client.retry();
            }}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        ) : (
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
        )
      ) : null}
    </div>
  );
}
