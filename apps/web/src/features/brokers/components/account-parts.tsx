"use client";

import { Clock, Radio, Star } from "lucide-react";

import { cn } from "@finlytics/ui/lib/utils";

import { Badge, Meter } from "@/features/dashboard/components/ui";
import { formatDuration } from "@/features/portfolio/lib/format";

import { STATUS_VIEW } from "../config";
import { useNow } from "../hooks/use-now";
import { sessionState } from "../lib/session";
import type { BrokerAccountView } from "../schemas";

/** The account's status as a tinted badge with a dot (the label carries the meaning). */
export function StatusBadge({ status }: { status: BrokerAccountView["status"] }) {
  const view = STATUS_VIEW[status];
  return (
    <Badge tone={view.tone} data-slot="broker-status" data-status={status}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {view.label}
    </Badge>
  );
}

export function DefaultBadge() {
  return (
    <Badge tone="warning" data-slot="broker-default">
      <Star aria-hidden="true" className="fill-current" />
      Default
    </Badge>
  );
}

/** This account's session streams the shared market feed (best effort, see `feedAccountId`). */
export function FeedBadge() {
  return (
    <Badge tone="profit" data-slot="broker-feed" title="The shared market feed streams through this session">
      <Radio aria-hidden="true" />
      Feeds market data
    </Badge>
  );
}

/**
 * Time left in the broker session, as text and a bar: "Ends in 5h 12m", amber in the last two hours, "Ended" once
 * past; paper never expires. Updates every minute (no clock during the server render: then only the absolute state).
 */
export function SessionCountdown({
  account,
  compact = false,
  className,
}: {
  account: Pick<BrokerAccountView, "tokenExpiresAt" | "lastLoginAt" | "status">;
  /** Text only (dashboard rows). */
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  const now = useNow();
  const session = sessionState(account, now);
  const inactive = account.status !== "ACTIVE";

  let text: string;
  switch (session.kind) {
    case "none":
      text = "No expiry";
      break;
    case "unknown":
      text = "—";
      break;
    case "ended":
      text = "Session ended";
      break;
    default:
      text = inactive ? "Not active" : `Ends in ${formatDuration(session.remainingMs ?? 0)}`;
  }
  const warn = !inactive && (session.kind === "soon" || session.kind === "ended");

  return (
    <div data-slot="broker-session" data-session={session.kind} className={cn("min-w-0 space-y-1", className)}>
      <p className={cn("flex items-center gap-1 text-sm tabular", warn ? "text-warning" : "text-fg")}>
        {warn ? <Clock aria-hidden="true" className="size-3.5 shrink-0" /> : null}
        <span className="truncate">{text}</span>
      </p>
      {!compact && session.fraction !== null && !inactive ? (
        <Meter
          value={session.fraction}
          label="Session time left"
          valueText={`${String(Math.round(session.fraction * 100))}% of the session left`}
          tone={session.kind === "ok" ? "profit" : "warning"}
          className="max-w-36"
        />
      ) : null}
    </div>
  );
}
