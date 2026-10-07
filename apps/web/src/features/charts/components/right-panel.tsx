"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ListPlus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";

import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { useIsStale, useSubscribe, useTick } from "@/features/realtime/hooks/use-realtime";
import type { Tick } from "@/features/realtime/schemas";
import { useWatchlists } from "@/features/watchlists/hooks/use-watchlists";

import { NO_VALUE, directionOf, formatCompact, formatNumber, formatPercent } from "../lib/format";

import { useChartInfo } from "./chart-context";
import { SimulatedBadge, focusRing } from "./ui";

type QuoteFields = Partial<Record<"open" | "high" | "low" | "close" | "oi" | "atp", number | null>>;

/** A tick field the feed may not send yet (W's realtime client adds them). */
function field(tick: Tick | undefined, name: keyof QuoteFields): number | null {
  if (tick === undefined) return null;
  const value = (tick as Tick & QuoteFields)[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const DIRECTION_TEXT = { up: "text-profit", down: "text-loss", flat: "text-fg" } as const;
const GLYPH = { up: "▲", down: "▼", flat: "" } as const;

/** Where the last price sits in the day's range, as a marker on a bar. */
function DayRange({
  low,
  high,
  last,
  precision,
}: {
  low: number | null;
  high: number | null;
  last: number | null;
  precision: number;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const ratio = low !== null && high !== null && last !== null && high > low ? (last - low) / (high - low) : null;
  useLayoutEffect(() => {
    if (marker.current !== null && ratio !== null) {
      marker.current.style.left = `${String(Math.min(100, Math.max(0, ratio * 100)))}%`;
    }
  }, [ratio]);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-fg-muted">
        <span>Day low</span>
        <span>Day high</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-2" aria-hidden="true">
        {ratio === null ? null : (
          <span
            ref={marker}
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          />
        )}
      </div>
      <div className="flex justify-between text-xs tabular text-fg">
        <span>{formatNumber(low, precision)}</span>
        <span>{formatNumber(high, precision)}</span>
      </div>
    </div>
  );
}

function QuoteDetails({ simulated }: { simulated: boolean }) {
  const info = useChartInfo();
  const tick = useTick(info.instrumentKey);
  const stale = useIsStale(info.instrumentKey);
  const { precision } = info;
  const direction = directionOf(tick?.chg);
  const stats: [string, string][] = [
    ["Open", formatNumber(field(tick, "open"), precision)],
    ["High", formatNumber(field(tick, "high"), precision)],
    ["Low", formatNumber(field(tick, "low"), precision)],
    ["Prev close", formatNumber(field(tick, "close"), precision)],
    ["Volume", tick?.vol ? formatCompact(tick.vol) : NO_VALUE],
    ["Avg price", formatNumber(field(tick, "atp"), precision)],
    ["Open interest", formatCompact(field(tick, "oi"))],
  ];

  return (
    <section
      aria-labelledby="chart-quote-title"
      data-slot="chart-quote"
      className="space-y-4 border-b border-border p-3"
    >
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <h2 id="chart-quote-title" className="truncate text-sm font-semibold text-fg">
            {info.symbol}
          </h2>
          <span className="rounded-sm bg-surface-2 px-1.5 text-[11px] font-semibold text-fg">{info.exchange}</span>
          {simulated ? <SimulatedBadge /> : null}
        </div>
        <p className="truncate text-xs text-fg-muted">{info.name}</p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2" data-slot="chart-quote-price">
        <span
          className={cn(
            "text-2xl font-semibold tabular",
            stale || tick === undefined ? "text-fg-muted" : DIRECTION_TEXT[direction],
          )}
        >
          {tick === undefined ? NO_VALUE : formatNumber(tick.ltp, precision)}
        </span>
        {tick === undefined ? null : (
          <span className={cn("text-sm tabular", DIRECTION_TEXT[direction])}>
            {direction === "flat" ? null : (
              <span aria-hidden="true" className="mr-0.5 text-[0.7em]">
                {GLYPH[direction]}
              </span>
            )}
            {formatNumber(tick.chg, precision, "always")} ({formatPercent(tick.chgPct)})
          </span>
        )}
        {stale ? <span className="text-xs text-fg-muted">· no update for over 5 s</span> : null}
      </div>
      <DayRange low={field(tick, "low")} high={field(tick, "high")} last={tick?.ltp ?? null} precision={precision} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-right tabular text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface WatchRowProps {
  instrumentKey: string;
  symbol: string;
  exchange: string;
  active: boolean;
  href: Route;
}

const WatchRow = memo(function WatchRow({ instrumentKey, symbol, exchange, active, href }: WatchRowProps) {
  const tick = useTick(instrumentKey);
  const direction = directionOf(tick?.chg);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-slot="chart-watchlist-row"
      className={cn(
        "grid h-9 grid-cols-[minmax(0,1fr)_auto_4.25rem] items-center gap-2 rounded-md px-2 text-[13px] transition-[background-color]",
        "hover:bg-surface-2 aria-[current=page]:bg-primary/10",
        focusRing,
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-fg">{symbol}</span>
        <span className="text-[10px] text-fg-muted">{exchange}</span>
      </span>
      <span className="text-right tabular text-fg">{tick === undefined ? NO_VALUE : formatNumber(tick.ltp)}</span>
      <span className={cn("text-right text-xs tabular", DIRECTION_TEXT[direction])}>
        {tick === undefined ? NO_VALUE : formatPercent(tick.chgPct)}
      </span>
    </Link>
  );
});

const ROW_PX = 36;

function WatchlistSection({ hrefFor }: { hrefFor: (key: string) => Route }) {
  const info = useChartInfo();
  const watchlists = useWatchlists();
  const selectId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const lists = useMemo(() => watchlists.data ?? [], [watchlists.data]);
  const list = lists.find((candidate) => candidate.id === chosen) ?? lists[0];
  const items = useMemo(() => list?.items ?? [], [list]);
  const keys = useMemo(() => items.map((item) => item.instrumentKey), [items]);
  useSubscribe(keys);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLUListElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render on purpose; rows re-render from its state
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX,
    overscan: 8,
    getItemKey: (index) => items[index]?.id ?? index,
    initialRect: { width: 0, height: 480 },
  });
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (innerRef.current) innerRef.current.style.height = `${String(totalSize)}px`;
  }, [totalSize]);

  let body: React.ReactNode;
  if (watchlists.isPending) {
    body = (
      <div aria-hidden="true" className="space-y-2 p-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-7" />
        ))}
      </div>
    );
  } else if (watchlists.isError) {
    body = (
      <ErrorState
        size="inline"
        headingLevel={3}
        title="Your watchlists didn't load"
        description="Try again in a moment."
        onRetry={async () => {
          await watchlists.refetch({ throwOnError: true });
        }}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        size="inline"
        headingLevel={3}
        icon={<ListPlus className="text-highlight" />}
        title={lists.length === 0 ? "No watchlists yet" : "This watchlist is empty"}
        description="Add instruments to switch charts from here."
        action={
          <Link
            href={"/watchlists"}
            className={cn(
              "inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary/90",
              focusRing,
            )}
          >
            Open watchlists
          </Link>
        }
      />
    );
  } else {
    body = (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
        <ul ref={innerRef} aria-label={`Instruments in ${list?.name ?? "the watchlist"}`} className="relative w-full">
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index];
            if (item === undefined) return null;
            return (
              <li
                key={row.key}
                data-index={row.index}
                aria-setsize={items.length}
                aria-posinset={row.index + 1}
                ref={(node) => {
                  if (node === null) return;
                  node.style.transform = `translateY(${String(row.start)}px)`;
                  virtualizer.measureElement(node);
                }}
                className="absolute top-0 left-0 w-full"
              >
                <WatchRow
                  instrumentKey={item.instrumentKey}
                  symbol={item.instrument.tradingSymbol ?? item.instrument.symbol}
                  exchange={item.instrument.exchange}
                  active={item.instrumentKey === info.instrumentKey}
                  href={hrefFor(item.instrumentKey)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${selectId}-title`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h2 id={`${selectId}-title`} className="text-sm font-medium text-fg">
          Watchlist
        </h2>
        {lists.length > 1 ? (
          <>
            <label htmlFor={selectId} className="sr-only">
              Show watchlist
            </label>
            <select
              id={selectId}
              value={list?.id ?? ""}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
              className={cn(
                "h-7 max-w-36 rounded-md border border-border-strong bg-surface-2 px-1.5 text-xs text-fg hover:bg-surface-3",
                focusRing,
              )}
            >
              {lists.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div
          aria-hidden="true"
          className="grid grid-cols-[minmax(0,1fr)_auto_4.25rem] gap-2 px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-muted uppercase"
        >
          <span>Symbol</span>
          <span className="text-right">Last</span>
          <span className="text-right">Chg%</span>
        </div>
      ) : null}
      {body}
    </section>
  );
}

export interface RightPanelProps {
  simulated: boolean;
  hrefFor: (key: string) => Route;
}

/** The side panel (wide screens): the instrument's quote and the user's watchlist to switch charts. */
export function RightPanel({ simulated, hrefFor }: RightPanelProps) {
  return (
    <section
      aria-label="Quote and watchlist"
      data-slot="chart-side-panel"
      className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface-1 xl:flex"
    >
      <QuoteDetails simulated={simulated} />
      <WatchlistSection hrefFor={hrefFor} />
    </section>
  );
}
