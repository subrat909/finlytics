"use client";

import { memo, useEffect, useRef } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { NO_VALUE, directionOf, formatChange, formatPercent, formatPrice } from "../format";
import type { Direction } from "../format";
import { useIsStale, useTick } from "../hooks/use-realtime";

const FLASH_MS = 300;

/** Day direction → text colour. Colour is never the only signal: the glyph and the screen-reader word go with it. */
const DIRECTION_TEXT: Readonly<Record<Direction, string>> = {
  up: "text-profit",
  down: "text-loss",
  flat: "text-fg",
};
const GLYPH: Readonly<Record<Direction, string>> = { up: "▲", down: "▼", flat: "" };
const SPOKEN: Readonly<Record<Direction, string>> = { up: "up", down: "down", flat: "unchanged" };

/**
 * Flashes the element for 300 ms when `value` moves (profit tint up, loss tint down, the text in fg meanwhile, so the
 * contrast holds) by setting `data-flash` on the node: no extra render per tick. The tint only shows when motion is allowed (`motion-safe:`); the timer is cleared on
 * the next change and on unmount.
 */
function usePriceFlash(ref: React.RefObject<HTMLElement | null>, value: number | undefined): void {
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    const element = ref.current;
    if (element === null || value === undefined || before === undefined || value === before) return;
    element.dataset.flash = value > before ? "up" : "down";
    const timer = setTimeout(() => {
      delete element.dataset.flash;
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
      delete element.dataset.flash;
    };
  }, [ref, value]);
}

/** A grey dot: no tick for over five seconds (market closed, feed delayed). */
export function StaleDot({ className }: { className?: string | undefined }) {
  return (
    <span data-slot="stale-dot" className={cn("inline-flex items-center", className)} title="No update for over 5 s">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-fg-muted" />
      <span className="sr-only">Stale</span>
    </span>
  );
}

export interface PriceCellProps {
  instrumentKey: string;
  className?: string | undefined;
  /** `lg` for a page header (the chart's instrument), `md` in tables. */
  size?: "md" | "lg" | undefined;
}

/**
 * The live last price (finlytics-ui "Realtime price cell"): tabular mono numerals, coloured by the day's direction with
 * a ▲/▼ glyph, flashing on every move, and a grey dot once it's stale. Reads one key from the store, so only this cell
 * re-renders on its ticks.
 */
export const PriceCell = memo(function PriceCell({ instrumentKey, className, size = "md" }: PriceCellProps) {
  const tick = useTick(instrumentKey);
  const stale = useIsStale(instrumentKey);
  const ref = useRef<HTMLSpanElement>(null);
  usePriceFlash(ref, tick?.ltp);

  const direction = directionOf(tick?.chg);
  return (
    <span
      ref={ref}
      data-slot="price-cell"
      data-direction={tick === undefined ? undefined : direction}
      data-stale={stale ? "true" : undefined}
      className={cn(
        "group/price inline-flex items-center justify-end gap-1.5 rounded-sm px-1 tabular transition-[background-color] duration-300 motion-reduce:transition-none",
        "motion-safe:data-[flash=down]:bg-loss/20 motion-safe:data-[flash=up]:bg-profit/20",
        size === "lg" ? "text-2xl font-semibold" : "text-sm",
        className,
      )}
    >
      {stale ? <StaleDot /> : null}
      {tick === undefined ? (
        <span className="text-fg-muted">
          <span aria-hidden="true">{NO_VALUE}</span>
          <span className="sr-only">No price yet</span>
        </span>
      ) : (
        <span
          className={cn(
            "inline-flex items-center gap-1",
            stale ? "text-fg-muted" : DIRECTION_TEXT[direction],
            // On the tint the text turns fg for those 300 ms: profit or loss text on its own tint is under 4.5:1.
            "motion-safe:group-data-[flash]/price:text-fg",
          )}
        >
          {direction === "flat" ? null : (
            <span aria-hidden="true" className="text-[0.7em]">
              {GLYPH[direction]}
            </span>
          )}
          <span data-slot="price-cell-value">{formatPrice(tick.ltp)}</span>
          <span className="sr-only">, {SPOKEN[direction]} today</span>
        </span>
      )}
    </span>
  );
});

export interface ChangeCellProps {
  instrumentKey: string;
  /** `abs`: points from the previous close; `pct`: percent. */
  kind: "abs" | "pct";
  className?: string | undefined;
  /** Show the ▲/▼ glyph (default true). Dense rows show it once, on the price. */
  glyph?: boolean | undefined;
}

/** The day's change (points or percent), signed, coloured and with its glyph. */
export const ChangeCell = memo(function ChangeCell({ instrumentKey, kind, className, glyph = true }: ChangeCellProps) {
  const tick = useTick(instrumentKey);
  const direction = directionOf(tick?.chg);
  const text = tick === undefined ? NO_VALUE : kind === "abs" ? formatChange(tick.chg) : formatPercent(tick.chgPct);
  return (
    <span
      data-slot="change-cell"
      className={cn("inline-flex items-center justify-end gap-1 tabular text-sm", DIRECTION_TEXT[direction], className)}
    >
      {glyph && tick !== undefined && direction !== "flat" ? (
        <span aria-hidden="true" className="text-[0.7em]">
          {GLYPH[direction]}
        </span>
      ) : null}
      <span>{text}</span>
    </span>
  );
});
