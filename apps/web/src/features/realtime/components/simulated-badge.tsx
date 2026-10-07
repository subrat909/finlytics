"use client";

import { FlaskConical } from "lucide-react";

import { cn } from "@finlytics/ui/lib/utils";

import { useFeedSource } from "../hooks/use-realtime";

export interface SimulatedBadgeProps {
  className?: string | undefined;
}

/**
 * The amber "Simulated" label (plan phase-1b "Design language"): shown wherever prices appear while the shared feed
 * isn't a live broker (`status.live === false`, the paper simulator). Renders nothing while live or unknown.
 */
export function SimulatedBadge({ className }: SimulatedBadgeProps) {
  const source = useFeedSource();
  if (source === undefined || source.live) return null;
  return (
    <span
      data-slot="simulated-badge"
      title="No broker feed is live: these prices come from the simulator."
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-warning/40 bg-warning/5 px-1.5 text-[11px] font-semibold tracking-wide text-warning uppercase",
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="size-3" />
      Simulated
      <span className="sr-only"> prices: no broker feed is live</span>
    </span>
  );
}
