"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChartCandlestick, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { memo, useLayoutEffect, useRef } from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { ChangeCell, PriceCell } from "@/features/realtime/components/price-cell";
import { useRejectedReason } from "@/features/realtime/hooks/use-realtime";
import { rejectReasonText } from "@/features/realtime/schemas";

import { describeInstrument, symbolOf } from "../schemas";
import type { WatchlistItem } from "../schemas";

/** Row height estimates: one line from 640 px, a two-line card below (measured once rendered). */
const ROW_ESTIMATE_PX = 60;
const OVERSCAN = 8;

/** Desktop columns: instrument, LTP, change, change %, actions. Below 640 px the row is a card. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(5.5rem,1fr))_auto] sm:items-center";

export function chartHref(instrumentKey: string): Route {
  return `/charts?key=${encodeURIComponent(instrumentKey)}` as Route;
}

export interface RowActions {
  onMove: (item: WatchlistItem, offset: -1 | 1) => void;
  onRemove: (item: WatchlistItem) => void;
}

interface WatchlistRowProps extends RowActions {
  item: WatchlistItem;
  index: number;
  count: number;
}

/**
 * One instrument (memoised: a tick re-renders only its PriceCell and ChangeCells, never the row). A one-line grid row
 * from 640 px; a card below (symbol and LTP, then the description and change, then the actions).
 */
const WatchlistRow = memo(function WatchlistRow({ item, index, count, onMove, onRemove }: WatchlistRowProps) {
  const symbol = symbolOf(item);
  const rejected = useRejectedReason(item.instrumentKey);
  return (
    <div className={cn(ROW_GRID, "rounded-md px-3 py-2.5 hover:bg-surface-2 sm:px-4")}>
      <div className="min-w-0">
        <Link
          href={chartHref(item.instrumentKey)}
          className="block truncate rounded-sm font-medium text-fg hover:text-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          {symbol}
          <span className="sr-only">, open the chart</span>
        </Link>
        <p className="truncate text-xs text-fg-muted">
          {rejected ? `No live price: ${rejectReasonText(rejected)}` : describeInstrument(item.instrument)}
        </p>
      </div>
      <div className="text-right sm:contents">
        <span className="sr-only">Last price </span>
        <PriceCell instrumentKey={item.instrumentKey} className="sm:justify-self-end" />
        <div className="flex justify-end gap-2 sm:contents">
          <span className="sr-only">Change </span>
          <ChangeCell instrumentKey={item.instrumentKey} kind="abs" className="sm:justify-self-end" />
          <span className="sr-only">Change percent </span>
          <ChangeCell instrumentKey={item.instrumentKey} kind="pct" className="sm:justify-self-end" />
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
        <Button asChild size="icon-sm" variant="ghost" className="sm:hidden">
          <Link href={chartHref(item.instrumentKey)} aria-label={`Chart ${symbol}`}>
            <ChartCandlestick aria-hidden="true" />
          </Link>
        </Button>
        <Button
          id={`${item.id}-up`}
          size="icon-sm"
          variant="ghost"
          aria-label={`Move ${symbol} up`}
          disabled={index === 0}
          onClick={() => {
            onMove(item, -1);
          }}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          id={`${item.id}-down`}
          size="icon-sm"
          variant="ghost"
          aria-label={`Move ${symbol} down`}
          disabled={index === count - 1}
          onClick={() => {
            onMove(item, 1);
          }}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${symbol}`}
          className="text-loss"
          onClick={() => {
            onRemove(item);
          }}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
});

export interface WatchlistTableProps extends RowActions {
  name: string;
  items: readonly WatchlistItem[];
}

/**
 * The instruments of one watchlist, virtualised (TanStack Virtual: only the rows in view, plus a few, are in the DOM).
 * A list, not a table: each row says what its numbers are to screen readers, and `aria-setsize`/`aria-posinset` keep
 * the count right while rows outside the view aren't rendered.
 */
export function WatchlistTable({ name, items, onMove, onRemove }: WatchlistTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLUListElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render on purpose; rows re-render from its state
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    getItemKey: (index) => items[index]?.id ?? index,
    initialRect: { width: 0, height: 600 },
  });
  const totalSize = virtualizer.getTotalSize();

  // The spacer's height is layout, not style: set on the node (frontend.md: no inline styles).
  useLayoutEffect(() => {
    if (innerRef.current) innerRef.current.style.height = `${String(totalSize)}px`;
  }, [totalSize]);

  return (
    <div data-slot="watchlist-table" className="rounded-md bg-surface-1">
      <div
        aria-hidden="true"
        className={cn(ROW_GRID, "hidden rounded-t-md bg-surface-2 px-4 py-2 text-xs font-medium text-fg-muted sm:grid")}
      >
        <span>Instrument</span>
        <span className="text-right">LTP</span>
        <span className="text-right">Change</span>
        <span className="text-right">Change %</span>
        <span className="w-[6.5rem]" />
      </div>
      <div ref={scrollRef} className="max-h-[calc(100dvh-18rem)] min-h-40 overflow-y-auto overscroll-contain p-1">
        <ul ref={innerRef} aria-label={`Instruments in ${name}`} className="relative w-full">
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            if (item === undefined) return null;
            return (
              <li
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-slot="watchlist-row"
                data-instrument-key={item.instrumentKey}
                aria-setsize={items.length}
                aria-posinset={virtualRow.index + 1}
                ref={(node) => {
                  if (node === null) return;
                  node.style.transform = `translateY(${String(virtualRow.start)}px)`;
                  virtualizer.measureElement(node);
                }}
                className="absolute top-0 left-0 w-full"
              >
                <WatchlistRow
                  item={item}
                  index={virtualRow.index}
                  count={items.length}
                  onMove={onMove}
                  onRemove={onRemove}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
