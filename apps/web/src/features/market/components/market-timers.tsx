"use client";

import type { ExchangeStatus } from "@finlytics/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { MARKET_OVERVIEW_QUERY_KEY, useMarketOverview } from "../hooks/use-market-overview";
import { formatCountdown, nextMarketEvent, phaseDot } from "../lib/countdown";
import { useSecond } from "../lib/second-clock";

function Timer({ session, now, className }: { session: ExchangeStatus; now: number; className?: string | undefined }) {
  const event = nextMarketEvent(session, now);
  return (
    <li
      data-exchange={session.exchange}
      data-phase={session.phase}
      className={cn("flex items-center gap-1.5 whitespace-nowrap", className)}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", phaseDot(session.phase))} />
      <span className="font-semibold text-fg">{session.exchange}</span>
      {event === undefined ? (
        <span className="text-fg-muted">{session.holiday ?? "Closed"}</span>
      ) : (
        <span className="text-fg-muted">
          {event.label} <span className="font-medium text-fg tabular">{formatCountdown(event.at - now)}</span>
        </span>
      )}
    </li>
  );
}

/**
 * The footer's market countdowns (NSE, and MCX from 768 px): `Pre-open in 2h 14m`, `Opens in 6m 12s`, `Closes in
 * 3h 05m`, `Post-close ends in 12m`. Ticks on the page's one shared second; when a countdown runs out it refetches the
 * overview once for the new phase (no polling).
 */
export function MarketTimers({ className }: { className?: string | undefined }) {
  const overview = useMarketOverview();
  const second = useSecond();
  const queryClient = useQueryClient();
  const refetchedFor = useRef<number | null>(null);
  const now = second ?? (overview.data === undefined ? 0 : Date.parse(overview.data.asOf));
  const sessions = (overview.data?.exchanges ?? []).filter((session) => session.exchange !== "BSE");
  const due = sessions
    .map((session) => nextMarketEvent(session, now)?.at)
    .filter((at): at is number => at !== undefined && at <= now);
  const firstDue = due.length > 0 ? Math.min(...due) : null;

  useEffect(() => {
    if (firstDue === null || refetchedFor.current === firstDue) return;
    refetchedFor.current = firstDue;
    void queryClient.invalidateQueries({ queryKey: MARKET_OVERVIEW_QUERY_KEY });
  }, [firstDue, queryClient]);

  if (overview.data === undefined) {
    return (
      <span className={cn("text-fg-muted", className)}>
        {overview.isError ? "Market status unavailable" : "Market status…"}
      </span>
    );
  }
  return (
    <ul aria-label="Market timings" data-slot="market-timers" className={cn("flex items-center gap-4", className)}>
      {sessions.map((session) => (
        <Timer
          key={session.exchange}
          session={session}
          now={now}
          className={session.exchange === "NSE" ? undefined : "hidden md:flex"}
        />
      ))}
    </ul>
  );
}
