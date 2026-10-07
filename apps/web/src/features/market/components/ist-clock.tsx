"use client";

import { cn } from "@finlytics/ui/lib/utils";

import { formatIstTime } from "../lib/ist";
import { useSecond } from "../lib/second-clock";

/**
 * The IST clock (`14:32:07 IST`), isolated: only this component re-renders every second. The server and the
 * hydration render show a placeholder (their clocks differ), then the live time. Not a live region: a clock that
 * spoke every second would be noise; `<time>` gives the moment to anyone who reads it.
 */
export function IstClock({ className }: { className?: string | undefined }) {
  const ms = useSecond();
  return (
    <time
      data-slot="ist-clock"
      dateTime={ms === null ? undefined : new Date(ms).toISOString()}
      className={cn("tabular whitespace-nowrap text-fg", className)}
    >
      {ms === null ? "--:--:--" : formatIstTime(ms, true)}
      <span className="text-fg-muted"> IST</span>
    </time>
  );
}
