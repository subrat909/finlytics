"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { formatIstTime } from "../lib/ist";

/** One timer per mounted clock, ticking every second; cleared when the clock unmounts. */
function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, 1_000);
  return () => {
    clearInterval(timer);
  };
}

/** The current second: a stable snapshot within a second, so React re-renders once per tick. */
function currentSecond(): number {
  return Math.floor(Date.now() / 1_000);
}

function serverSnapshot(): null {
  return null;
}

/**
 * The IST clock (`14:32:07 IST`), isolated: only this component re-renders every second. The server and the
 * hydration render show a placeholder (their clocks differ), then the live time. Not a live region: a clock that
 * spoke every second would be noise; `<time>` gives the moment to anyone who reads it.
 */
export function IstClock({ className }: { className?: string | undefined }) {
  const second = useSyncExternalStore(subscribe, currentSecond, serverSnapshot);
  const ms = second === null ? null : second * 1_000;
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
