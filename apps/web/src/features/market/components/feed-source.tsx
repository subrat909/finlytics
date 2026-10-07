"use client";

import type { FeedInfo, RtFeedState } from "@finlytics/shared";
import Link from "next/link";

import { Tooltip } from "@finlytics/ui/components/tooltip";
import { cn } from "@finlytics/ui/lib/utils";

import { useFeedStatus } from "@/features/realtime/hooks/use-realtime";

import { BROKER_NAMES } from "../lib/ist";

export interface FeedSourceProps {
  /** The overview's feed; undefined while it loads or when it failed. */
  feed: FeedInfo | undefined;
  /** The overview query's state, for the placeholder's spoken text. */
  status: "pending" | "error" | "success";
  className?: string | undefined;
}

const LIVE_VIEW: Readonly<Record<RtFeedState, { label: string; dot: string }>> = {
  up: { label: "Live", dot: "bg-profit" },
  stale: { label: "Delayed", dot: "bg-warning" },
  down: { label: "Feed down", dot: "bg-loss" },
};

/** Why prices are simulated, in our words: the api's reason (never a broker's message), then what to do. */
export function simulatedReason(feed: FeedInfo): string {
  const given = feed.reason?.trim() ?? "";
  const reason = given === "" ? "No broker market feed is connected." : given;
  return `${reason.endsWith(".") ? reason : `${reason}.`} Prices are simulated; connect a broker for live data.`;
}

/**
 * Where prices come from (plan phase-1b "Shell"): `Live · Upstox` in green, or an amber "Simulated" chip that links to
 * Brokers, with the reason in a tooltip (hover or keyboard focus). A live feed that goes quiet reads "Delayed", one
 * that drops "Feed down", from the socket's `status` when it has spoken, else from the overview. Loading and errors are
 * quiet: the word "Feed" and a grey dot.
 */
export function FeedSource({ feed, status, className }: FeedSourceProps) {
  const socketFeed = useFeedStatus();

  if (feed === undefined) {
    return (
      <span data-slot="feed-source" data-state={status} className={cn("flex items-center gap-1.5", className)}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-surface-3" />
        <span className="text-fg-muted">Feed</span>
        <span className="sr-only">{status === "error" ? "status unavailable" : "status loading"}</span>
      </span>
    );
  }

  if (!feed.live) {
    return (
      <Tooltip content={simulatedReason(feed)} side="top">
        <Link
          href="/brokers"
          data-slot="feed-source"
          data-live="false"
          className={cn(
            "flex h-5 items-center gap-1.5 rounded-sm bg-warning/10 px-1.5 font-semibold text-warning",
            "transition-[color,background-color] hover:bg-warning/15",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
            className,
          )}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          Simulated <span className="sr-only">prices</span>
        </Link>
      </Tooltip>
    );
  }

  const state = socketFeed === "unknown" ? feed.state : socketFeed;
  const view = LIVE_VIEW[state];
  return (
    <span
      data-slot="feed-source"
      data-live="true"
      data-feed={state}
      className={cn("flex items-center gap-1.5 whitespace-nowrap", className)}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", view.dot)} />
      <span className={cn("font-semibold", state === "up" ? "text-profit" : "text-fg")}>{view.label}</span>
      <span className="text-fg-muted">
        <span aria-hidden="true">· </span>
        <span className="sr-only">from </span>
        {BROKER_NAMES[feed.source]}
      </span>
    </span>
  );
}
