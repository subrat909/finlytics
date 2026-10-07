"use client";

import { memo } from "react";
import type * as React from "react";

import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { NO_VALUE, formatPrice, formatQuantity } from "@/features/realtime/format";
import { useDepth } from "@/features/realtime/hooks/use-depth";
import { depthRejectText } from "@/features/realtime/schemas";
import type { DepthLevel } from "@/features/realtime/schemas";

/** Exchanges publish five levels to retail feeds (Upstox and Dhan `full`). */
export const DEPTH_LEVELS = 5;

/** Sets a width as a percentage on the node (layout, not style: no inline style prop, CSP-safe). */
function widthRef(percent: number) {
  const width = `${String(Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100)}%`;
  return (node: HTMLElement | null) => {
    if (node !== null) node.style.width = width;
  };
}

function sum(levels: readonly DepthLevel[]): number {
  return levels.reduce((total, level) => total + level.qty, 0);
}

interface SideCellsProps {
  level: DepthLevel | undefined;
  side: "bid" | "ask";
  /** The row's quantity bars: rendered in the first cell, positioned against the row (`tr` is relative). */
  bars?: React.ReactNode;
}

function SideCells({ level, side, bars }: SideCellsProps) {
  const price = level === undefined ? NO_VALUE : formatPrice(level.price);
  return (
    <>
      <td
        className={cn(
          "py-1 text-left",
          side === "bid" ? "pl-2 text-profit" : "relative pl-3 text-loss",
          level === undefined && "text-fg-muted",
        )}
      >
        {bars}
        <span className="relative">{price}</span>
      </td>
      <td className="relative py-1 text-right text-fg-muted">
        {level === undefined || level.orders === 0 ? NO_VALUE : formatQuantity(level.orders)}
      </td>
      <td className={cn("relative py-1 text-right text-fg", side === "bid" ? "pr-3" : "pr-2")}>
        {level === undefined ? NO_VALUE : formatQuantity(level.qty)}
      </td>
    </>
  );
}

function DepthSkeleton({ levels }: { levels: number }) {
  return (
    <div aria-hidden="true" className="space-y-1.5" data-slot="market-depth-skeleton">
      {Array.from({ length: levels + 2 }, (_, row) => (
        <div key={row} className="grid grid-cols-2 gap-4">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ))}
    </div>
  );
}

export interface MarketDepthProps {
  instrumentKey: string;
  /** For the table's caption ("Market depth for RELIANCE"). */
  symbol: string;
  levels?: number | undefined;
  className?: string | undefined;
}

/**
 * Five-level market depth (docs/05 "Market depth"): bids and offers side by side with their orders and quantities,
 * a bar per level sized by quantity, the total buy and sell quantities and the buy/sell split. Streams while mounted
 * (`useDepth`: ref-counted `dsub`, seeded from the last snapshot); one table, so each row reads as one level.
 */
export const MarketDepth = memo(function MarketDepth({
  instrumentKey,
  symbol,
  levels = DEPTH_LEVELS,
  className,
}: MarketDepthProps) {
  const { depth, loading, rejected } = useDepth(instrumentKey);

  if (depth === undefined) {
    if (loading) {
      return (
        <div role="status" aria-label={`Loading market depth for ${symbol}`} className={className}>
          <DepthSkeleton levels={levels} />
        </div>
      );
    }
    return (
      <p data-slot="market-depth-empty" className={cn("py-2 text-xs text-fg-muted", className)}>
        {rejected === undefined
          ? "No market depth yet: it shows with the first order-book update."
          : `Market depth isn't streaming: ${depthRejectText(rejected)}.`}
      </p>
    );
  }

  const bids = depth.bids.slice(0, levels);
  const asks = depth.asks.slice(0, levels);
  const largest = Math.max(1, ...bids.map((level) => level.qty), ...asks.map((level) => level.qty));
  const totalBuy = depth.tbq ?? sum(bids);
  const totalSell = depth.tsq ?? sum(asks);
  const totals = totalBuy + totalSell;
  const buyShare = totals === 0 ? 50 : (totalBuy / totals) * 100;
  const rows = Array.from({ length: levels }, (_, index) => index);

  return (
    <div data-slot="market-depth" className={cn("space-y-2", className)}>
      <table className="w-full table-fixed border-collapse text-xs tabular">
        <caption className="sr-only">{`Market depth for ${symbol}: the best ${String(levels)} bids and offers`}</caption>
        <colgroup>
          <col className="w-[19%]" />
          <col className="w-[13%]" />
          <col className="w-[18%]" />
          <col className="w-[19%]" />
          <col className="w-[13%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead>
          <tr className="text-[10px] font-medium tracking-wide text-fg-muted uppercase">
            <th scope="col" className="pb-1 pl-2 text-left font-medium">
              Bid
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              Orders
            </th>
            <th scope="col" className="pr-3 pb-1 text-right font-medium">
              Qty
            </th>
            <th scope="col" className="pb-1 pl-3 text-left font-medium">
              Offer
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              Orders
            </th>
            <th scope="col" className="pr-2 pb-1 text-right font-medium">
              Qty
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((index) => {
            const bid = bids[index];
            const ask = asks[index];
            return (
              <tr key={index} className="relative" data-slot="market-depth-level">
                <SideCells
                  level={bid}
                  side="bid"
                  bars={
                    <>
                      {bid === undefined ? null : (
                        <span
                          aria-hidden="true"
                          ref={widthRef((bid.qty / largest) * 50)}
                          className="pointer-events-none absolute inset-y-px right-1/2 rounded-l-sm bg-profit/10"
                        />
                      )}
                      {ask === undefined ? null : (
                        <span
                          aria-hidden="true"
                          ref={widthRef((ask.qty / largest) * 50)}
                          className="pointer-events-none absolute inset-y-px left-1/2 rounded-r-sm bg-loss/10"
                        />
                      )}
                    </>
                  }
                />
                <SideCells level={ask} side="ask" />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border text-[11px]">
            <th scope="row" className="pt-1.5 pl-2 text-left font-medium text-fg-muted">
              Total
            </th>
            <td colSpan={2} className="pt-1.5 pr-3 text-right font-medium text-fg">
              {formatQuantity(totalBuy)}
            </td>
            <th scope="row" className="pt-1.5 pl-3 text-left font-medium text-fg-muted">
              Total
            </th>
            <td colSpan={2} className="pt-1.5 pr-2 text-right font-medium text-fg">
              {formatQuantity(totalSell)}
            </td>
          </tr>
        </tfoot>
      </table>
      <div data-slot="depth-pressure" className="space-y-1 px-2">
        <div aria-hidden="true" className="flex h-1 overflow-hidden rounded-full bg-loss/60">
          <span ref={widthRef(buyShare)} className="h-full bg-profit" />
        </div>
        <p className="flex justify-between text-[11px] tabular">
          <span className="text-profit">Buy {buyShare.toFixed(1)}%</span>
          <span className="text-loss">{(100 - buyShare).toFixed(1)}% Sell</span>
        </p>
      </div>
    </div>
  );
});
