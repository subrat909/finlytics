"use client";

import { useEffect, useState } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { formatClock } from "../lib/time";
import { CHART_RANGES, INTERVALS, RANGES } from "../schemas";
import type { ChartRange } from "../schemas";
import { useWorkspace } from "../store/workspace-store";

import { Divider, Hint, focusRing, toolButtonClasses } from "./ui";

/** The IST clock: its own one-second timer, so only it re-renders. */
function IstClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
    };
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return (
    <span data-slot="ist-clock" className="hidden px-1.5 text-xs text-fg-muted tabular sm:inline">
      <span className="text-fg">{now === null ? "--:--:--" : formatClock(now)}</span> (UTC+5:30)
    </span>
  );
}

export interface BottomBarProps {
  onRange: (range: ChartRange) => void;
}

/** Ranges (each switches to its interval and zooms), the IST clock and the price scale's % / log / auto toggles. */
export function BottomBar({ onRange }: BottomBarProps) {
  const scaleMode = useWorkspace((state) => state.scaleMode);
  const autoScale = useWorkspace((state) => state.autoScale);
  const setScale = useWorkspace((state) => state.setScale);
  const scaleButton = "h-7 min-w-7 px-1.5 text-xs font-medium";

  return (
    <div
      data-slot="chart-bottom-bar"
      className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-border bg-surface-1 px-1.5"
    >
      <div
        role="group"
        aria-label="Date range"
        className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]"
      >
        {CHART_RANGES.map((range) => (
          <Hint key={range} label={`${RANGES[range].long}, ${INTERVALS[RANGES[range].interval].short} bars`} side="top">
            <button
              type="button"
              aria-label={`${RANGES[range].label}, ${RANGES[range].long.toLowerCase()}`}
              onClick={() => {
                onRange(range);
              }}
              className={cn(toolButtonClasses, "h-7 px-2 text-xs font-medium")}
            >
              {RANGES[range].label}
            </button>
          </Hint>
        ))}
      </div>
      <span className="min-w-1 flex-1" />
      <IstClock />
      <Divider className="hidden sm:block" />
      <div role="group" aria-label="Price scale" className="flex items-center gap-0.5">
        <button
          type="button"
          aria-pressed={scaleMode === "percent"}
          aria-label="Percentage scale"
          onClick={() => {
            setScale({ scaleMode: scaleMode === "percent" ? "normal" : "percent" });
          }}
          className={cn(toolButtonClasses, scaleButton)}
        >
          %
        </button>
        <button
          type="button"
          aria-pressed={scaleMode === "log"}
          aria-label="Log scale"
          onClick={() => {
            setScale({ scaleMode: scaleMode === "log" ? "normal" : "log" });
          }}
          className={cn(toolButtonClasses, scaleButton)}
        >
          log
        </button>
        <button
          type="button"
          aria-pressed={autoScale}
          aria-label="Auto-fit the price scale"
          onClick={() => {
            setScale({ autoScale: !autoScale });
          }}
          className={cn(toolButtonClasses, scaleButton)}
        >
          auto
        </button>
      </div>
      <Divider />
      <a
        href="https://www.tradingview.com/"
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          "shrink-0 rounded-sm px-1 text-[11px] text-fg-muted hover:text-fg hover:underline md:inline",
          focusRing,
        )}
      >
        <span className="hidden md:inline">Charts by </span>TradingView
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}
