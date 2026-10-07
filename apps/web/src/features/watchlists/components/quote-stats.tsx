"use client";

import type { Instrument } from "@finlytics/shared";
import { memo } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { isDerivative } from "@/features/instruments/lib/describe";
import { formatPrice, formatQuantity, formatQuantityCompact } from "@/features/realtime/format";
import { useTick } from "@/features/realtime/hooks/use-realtime";

/** Places the day-range marker (layout, set on the node: no inline style prop). */
function leftRef(percent: number) {
  const left = `${String(Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100)}%`;
  return (node: HTMLElement | null) => {
    if (node !== null) node.style.left = left;
  };
}

interface DayRangeProps {
  low: number | null | undefined;
  high: number | null | undefined;
  ltp: number | undefined;
}

/** The day's low-to-high bar with a marker at the last price. */
function DayRange({ low, high, ltp }: DayRangeProps) {
  const known =
    low !== null && low !== undefined && high !== null && high !== undefined && ltp !== undefined && high >= low;
  const percent = known ? (high === low ? 50 : ((ltp - low) / (high - low)) * 100) : undefined;
  return (
    <div data-slot="day-range" className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px] text-fg-muted">
        <span>
          Day low <span className="tabular text-fg">{formatPrice(low)}</span>
        </span>
        <span>
          Day high <span className="tabular text-fg">{formatPrice(high)}</span>
        </span>
      </div>
      <div aria-hidden="true" className="relative h-1.5 rounded-full bg-surface-3">
        {percent === undefined ? null : (
          <span
            ref={leftRef(percent)}
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          />
        )}
      </div>
      <p className="sr-only">
        {percent === undefined
          ? "The day's range isn't known yet."
          : `The last price is ${String(Math.round(Math.min(100, Math.max(0, percent))))}% of the way from the day's low to its high.`}
      </p>
    </div>
  );
}

export interface QuoteStatsProps {
  instrument: Instrument;
  className?: string | undefined;
}

/**
 * The day's numbers for one instrument (docs/05 "Quote"): open, high, low, previous close, average traded price,
 * volume, open interest and lot size (what applies to its segment), then the day range. Live from the store.
 */
export const QuoteStats = memo(function QuoteStats({ instrument, className }: QuoteStatsProps) {
  const tick = useTick(instrument.key);
  const derivative = isDerivative(instrument);
  const stats: [label: string, value: string][] = [
    ["Open", formatPrice(tick?.open)],
    ["High", formatPrice(tick?.high)],
    ["Low", formatPrice(tick?.low)],
    ["Prev close", formatPrice(tick?.close)],
  ];
  if (instrument.segment !== "INDEX") {
    stats.push(["ATP", formatPrice(tick?.atp)], ["Volume", formatQuantityCompact(tick?.vol)]);
  }
  if (derivative) stats.push(["OI", formatQuantityCompact(tick?.oi)], ["Lot size", formatQuantity(instrument.lotSize)]);

  return (
    <div data-slot="quote-stats" className={cn("space-y-3", className)}>
      <dl
        className={cn(
          "grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border",
          stats.length === 6 ? "@md:grid-cols-3" : "@md:grid-cols-4",
        )}
      >
        {stats.map(([label, value]) => (
          <div key={label} className="bg-surface-1 px-3 py-2">
            <dt className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">{label}</dt>
            <dd className="mt-0.5 text-[13px] text-fg tabular">{value}</dd>
          </div>
        ))}
      </dl>
      <DayRange low={tick?.low} high={tick?.high} ltp={tick?.ltp} />
    </div>
  );
});
