"use client";

import { ChartCandlestick, GripVertical, Layers, Trash2 } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { ExchangeBadge } from "@/features/instruments/components/instrument-badges";
import { accessibleName, displaySymbol, secondaryLabel } from "@/features/instruments/lib/describe";
import { ChangeCell, PriceCell } from "@/features/realtime/components/price-cell";
import { useRejectedReason } from "@/features/realtime/hooks/use-realtime";
import { rejectReasonText } from "@/features/realtime/schemas";

import { chartHref, rowButtonId, rowDepthId } from "../lib/watchlist-lib";
import type { WatchlistItem } from "../schemas";

import { MarketDepth } from "./market-depth";

/** What the keyboard does on a row (also the row button's `aria-keyshortcuts`). */
export const ROW_SHORTCUTS = "ArrowUp ArrowDown Home End Enter D C Delete Alt+ArrowUp Alt+ArrowDown";

const ACTION = "size-7 text-fg-muted hover:bg-surface-3 hover:text-fg [&_svg]:size-3.5 focus-visible:-outline-offset-2";

export interface WatchlistRowProps {
  item: WatchlistItem;
  index: number;
  /** The roving tab stop: only this row's controls are in the tab order. */
  focusable: boolean;
  selected: boolean;
  depthOpen: boolean;
  /** The id of the list's keyboard help (`aria-describedby`). */
  helpId: string;
  onSelect: (item: WatchlistItem, index: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, item: WatchlistItem, index: number) => void;
  onToggleDepth: (item: WatchlistItem) => void;
  onRemove: (item: WatchlistItem, index: number) => void;
}

/**
 * One instrument, Kite-style (memoised: a tick re-renders only its price and change cells). The row is one button
 * (stretched over the row) that selects it; prices sit beside it; hover or keyboard focus reveals Depth, Chart and
 * Remove over the numbers. Depth expands the five-level book under the row.
 */
export const WatchlistRow = memo(function WatchlistRow({
  item,
  index,
  focusable,
  selected,
  depthOpen,
  helpId,
  onSelect,
  onKeyDown,
  onToggleDepth,
  onRemove,
}: WatchlistRowProps) {
  const { instrument } = item;
  const symbol = displaySymbol(instrument);
  const rejected = useRejectedReason(item.instrumentKey);
  const tabIndex = focusable ? 0 : -1;
  const hasDepth = instrument.segment !== "INDEX";

  return (
    <>
      <div
        data-slot="watchlist-row-body"
        data-selected={selected ? "true" : undefined}
        className={cn(
          "group/row relative flex h-11 items-center gap-3 px-3 hover:bg-surface-2",
          selected && "bg-surface-2 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
        )}
      >
        <GripVertical
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-0.5 size-3 -translate-y-1/2 text-fg-muted opacity-0 group-hover/row:opacity-100"
        />
        {/* Only the first line is the button's content, so its name (`accessibleName`) starts with what it shows. */}
        <div className="min-w-0 flex-1">
          <button
            id={rowButtonId(item.id)}
            type="button"
            tabIndex={tabIndex}
            aria-label={accessibleName(instrument)}
            aria-current={selected ? "true" : undefined}
            aria-describedby={helpId}
            aria-keyshortcuts={ROW_SHORTCUTS}
            data-slot="watchlist-row-button"
            className={cn(
              "block w-full min-w-0 cursor-pointer text-left outline-none",
              // Stretched over the row: a click anywhere selects; the focus ring is the row's.
              "after:absolute after:inset-0 after:rounded-sm after:content-['']",
              "focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid",
            )}
            onClick={() => {
              onSelect(item, index);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, item, index);
            }}
          >
            <span className="block truncate text-[13px] font-medium text-fg">{symbol}</span>
          </button>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
            <ExchangeBadge exchange={instrument.exchange} className="h-3.5 text-[9px]" />
            <span className="truncate">
              {rejected === undefined ? secondaryLabel(instrument) : `No live price: ${rejectReasonText(rejected)}`}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="sr-only">Last price</span>
          <PriceCell instrumentKey={item.instrumentKey} className="pr-0 text-[13px]" />
          <span className="flex items-center gap-2">
            <span className="sr-only">Change</span>
            <ChangeCell instrumentKey={item.instrumentKey} kind="abs" glyph={false} className="text-[11px]" />
            <ChangeCell instrumentKey={item.instrumentKey} kind="pct" glyph={false} className="text-[11px]" />
          </span>
        </div>
        <div
          data-slot="watchlist-row-actions"
          // Mouse: shown on hover (so they're visible before any click lands on them); keyboard: shown while one of
          // them has focus. Touch screens never get them (no hover): a tap selects the row and opens the details.
          className={cn(
            "absolute inset-y-0 right-0 flex items-center gap-0.5 bg-surface-2 pr-2 pl-3 opacity-0 pointer-coarse:hidden",
            "group-hover/row:opacity-100 has-[:focus-visible]:opacity-100",
          )}
        >
          {hasDepth ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className={cn(ACTION, depthOpen && "bg-surface-3 text-fg")}
              tabIndex={tabIndex}
              aria-label={`Market depth for ${symbol}`}
              aria-expanded={depthOpen}
              aria-controls={depthOpen ? rowDepthId(item.id) : undefined}
              title="Market depth (D)"
              onClick={() => {
                onToggleDepth(item);
              }}
            >
              <Layers aria-hidden="true" />
            </Button>
          ) : null}
          <Button asChild size="icon-sm" variant="ghost" className={ACTION}>
            <Link
              href={chartHref(item.instrumentKey)}
              tabIndex={tabIndex}
              draggable={false}
              aria-label={`Chart ${symbol}`}
              title="Chart (C)"
            >
              <ChartCandlestick aria-hidden="true" />
            </Link>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn(ACTION, "hover:text-loss")}
            tabIndex={tabIndex}
            aria-label={`Remove ${symbol}`}
            title="Remove (Delete)"
            onClick={() => {
              onRemove(item, index);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {depthOpen ? (
        <div
          id={rowDepthId(item.id)}
          data-slot="watchlist-row-depth"
          className="border-y border-border bg-surface-1 px-1 py-2"
        >
          <MarketDepth instrumentKey={item.instrumentKey} symbol={symbol} />
        </div>
      ) : null}
    </>
  );
});
