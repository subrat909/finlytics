"use client";

import { ArrowDownUp, Gauge, TrendingUp } from "lucide-react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { useDepth } from "@/features/realtime/hooks/use-depth";
import { useTick } from "@/features/realtime/hooks/use-realtime";
import { formatPercent, formatQuantityCompact } from "@/features/realtime/format";

/** Sets layout properties on the node through a ref (no inline style prop: CSP-safe, tokens stay single-sourced). */
function layoutRef(properties: Readonly<Record<string, string>>) {
  return (node: HTMLElement | null) => {
    if (node === null) return;
    for (const [name, value] of Object.entries(properties)) node.style.setProperty(name, value);
  };
}

const percent = (value: number) => `${String(Math.round(value * 100) / 100)}%`;

/** `(a − b) / b × 100`, or null without both numbers (or a zero base). */
export function pctChange(value: number | null | undefined, base: number | null | undefined): number | null {
  if (value === null || value === undefined || base === null || base === undefined || base === 0) return null;
  return ((value - base) / base) * 100;
}

/** Where `value` sits in `[low, high]`, 0–100; null without a range. */
export function rangePosition(value: number, low: number | null | undefined, high: number | null | undefined) {
  if (low === null || low === undefined || high === null || high === undefined || high <= low) return null;
  return Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
}

function tone(value: number | null): string {
  if (value === null || value === 0) return "text-fg-muted";
  return value > 0 ? "text-profit" : "text-loss";
}

/** A centred bar: right and green for gains, left and red for losses, ±3 % fills it. */
function DivergingBar({ value }: { value: number | null }) {
  const width = value === null ? 0 : Math.min(50, (Math.abs(value) / 3) * 50);
  return (
    <span aria-hidden="true" className="relative block h-1.5 w-full rounded-full bg-surface-3">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <span
        className={cn("absolute inset-y-0 rounded-full", value !== null && value < 0 ? "bg-loss" : "bg-profit")}
        ref={layoutRef(
          value !== null && value < 0
            ? { right: "50%", left: "auto", width: percent(width) }
            : { left: "50%", right: "auto", width: percent(width) },
        )}
      />
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className={cn("font-medium tabular", tone(value))}>
          {value === null ? "—" : `${value > 0 ? "▲" : value < 0 ? "▼" : ""} ${formatPercent(value)}`}
        </span>
      </span>
      <DivergingBar value={value} />
    </li>
  );
}

function Tile({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-surface-1 p-3">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
        <span aria-hidden="true" className="[&_svg]:size-3.5">
          {icon}
        </span>
        {title}
      </h4>
      {children}
    </div>
  );
}

function OrderFlow({ instrumentKey }: { instrumentKey: string }) {
  const { depth } = useDepth(instrumentKey);
  const buy = depth?.tbq ?? null;
  const sell = depth?.tsq ?? null;
  const total = buy !== null && sell !== null ? buy + sell : 0;
  const buyShare = total > 0 && buy !== null ? (buy / total) * 100 : null;
  return (
    <Tile icon={<ArrowDownUp className="text-highlight" />} title="Order flow">
      {buyShare === null ? (
        <p className="text-xs text-fg-muted">Waiting for the order book…</p>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-between text-xs tabular">
            <span className="font-medium text-profit">Buyers {buyShare.toFixed(0)}%</span>
            <span className="font-medium text-loss">{(100 - buyShare).toFixed(0)}% Sellers</span>
          </div>
          <span
            role="meter"
            aria-label="Share of buy quantity"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(buyShare)}
            className="flex h-2 overflow-hidden rounded-full bg-loss/70"
          >
            <span className="h-full bg-profit" ref={layoutRef({ width: percent(buyShare) })} />
          </span>
          <div className="flex justify-between text-2xs text-fg-muted tabular">
            <span>{formatQuantityCompact(buy)} bid qty</span>
            <span>{formatQuantityCompact(sell)} ask qty</span>
          </div>
        </div>
      )}
    </Tile>
  );
}

export interface SessionInsightsProps {
  instrumentKey: string;
  /** Indices have no order book: the order-flow tile is left out. */
  tradable: boolean;
}

/**
 * The watchlist detail's live session read-out (instead of a chart: no candles fetched, no canvas): performance
 * against the previous close, the open and the average price, where the price sits in the day's range, the opening
 * gap, and the order-flow split from the book's total buy and sell quantities. All from ticks on the tab's socket.
 */
export function SessionInsights({ instrumentKey, tradable }: SessionInsightsProps) {
  const tick = useTick(instrumentKey);
  const ltp = tick?.ltp;
  const vsClose = tick === undefined ? null : tick.chgPct;
  const vsOpen = pctChange(ltp, tick?.open);
  const vsAtp = pctChange(ltp, tick?.atp);
  const gap = pctChange(tick?.open, tick?.close);
  const position = ltp === undefined ? null : rangePosition(ltp, tick?.low, tick?.high);
  const rangePct = pctChange(tick?.high, tick?.low);

  return (
    <div data-slot="session-insights" className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-3">
      <Tile icon={<TrendingUp className="text-primary" />} title="Performance">
        <ul className="space-y-3">
          <Metric label="vs previous close" value={vsClose} />
          <Metric label="vs today's open" value={vsOpen} />
          {tradable ? <Metric label="vs average price" value={vsAtp} /> : null}
        </ul>
      </Tile>
      <Tile icon={<Gauge className="text-violet" />} title="Day range">
        {position === null ? (
          <p className="text-xs text-fg-muted">The range fills in with the first trades.</p>
        ) : (
          <div className="space-y-2">
            <span
              role="meter"
              aria-label="Price within today's range"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(position)}
              className="relative block h-2 rounded-full bg-gradient-to-r from-loss/60 via-surface-3 to-profit/60"
            >
              <span
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1 bg-fg"
                ref={layoutRef({ left: percent(position) })}
              />
            </span>
            <p className="flex justify-between text-2xs text-fg-muted tabular">
              <span>Low</span>
              <span className="font-medium text-fg">{position.toFixed(0)}% of range</span>
              <span>High</span>
            </p>
          </div>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-sm bg-surface-2 px-2 py-1.5">
            <dt className="text-2xs text-fg-muted">Range width</dt>
            <dd className="font-medium text-fg tabular">{rangePct === null ? "—" : `${rangePct.toFixed(2)}%`}</dd>
          </div>
          <div className="rounded-sm bg-surface-2 px-2 py-1.5">
            <dt className="text-2xs text-fg-muted">Opening gap</dt>
            <dd className={cn("font-medium tabular", tone(gap))}>{gap === null ? "—" : formatPercent(gap)}</dd>
          </div>
        </dl>
      </Tile>
      {tradable ? <OrderFlow instrumentKey={instrumentKey} /> : null}
    </div>
  );
}
