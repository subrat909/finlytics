"use client";

import { MARKET_INDEX_KEYS, TICKER_INDEX_IDS } from "@finlytics/shared";
import type { MarketQuote } from "@finlytics/shared";
import { memo, useMemo } from "react";

import { Badge } from "@finlytics/ui/components/badge";
import { cn } from "@finlytics/ui/lib/utils";

import { useMarketOverview } from "@/features/market/hooks/use-market-overview";
import { StaleDot } from "@/features/realtime/components/price-cell";
import { directionOf, formatChange, formatPercent, formatPrice } from "@/features/realtime/format";
import type { Direction } from "@/features/realtime/format";
import { useIsStale, useSubscribe, useTick } from "@/features/realtime/hooks/use-realtime";

import { useMediaQuery } from "./use-media-query";

/** The navbar ticker's indices, in order: canonical keys from the shared contract. */
const TICKER = TICKER_INDEX_IDS.map((id) => ({ id, key: MARKET_INDEX_KEYS[id] }));
const TICKER_KEYS: readonly string[] = TICKER.map(({ key }) => key);
const NO_KEYS: readonly string[] = [];

/** The ticker shows from 1280 px (`xl`); below that it's hidden and subscribes to nothing. */
export const TICKER_QUERY = "(min-width: 1280px)";

const DIRECTION_TEXT: Readonly<Record<Direction, string>> = {
  up: "text-profit",
  down: "text-loss",
  flat: "text-fg-muted",
};
const GLYPH: Readonly<Record<Direction, string>> = { up: "▲", down: "▼", flat: "" };
const SPOKEN: Readonly<Record<Direction, string>> = { up: "up", down: "down", flat: "unchanged" };

/** `NSE_INDEX|NIFTY 50` → `NIFTY 50`: the name until the overview supplies one. */
function nameFromKey(key: string): string {
  return key.slice(key.indexOf("|") + 1);
}

function toNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

interface TickerItemProps {
  instrumentKey: string;
  name: string;
  /** The overview's last numbers, shown until the first tick arrives. */
  seed: MarketQuote | undefined;
}

/**
 * One index: name and change above, last price and change % below, in tabular mono, coloured by direction with ▲/▼
 * (never colour alone). Reads its own key from the tick store, so only this item re-renders on its ticks (≤ 10/s).
 * Not a live region: ten updates a second would drown a screen reader; the full sentence is there to read on demand.
 */
const TickerItem = memo(function TickerItem({ instrumentKey, name, seed }: TickerItemProps) {
  const tick = useTick(instrumentKey);
  const stale = useIsStale(instrumentKey);
  const ltp = tick?.ltp ?? toNumber(seed?.ltp);
  const chg = tick?.chg ?? toNumber(seed?.chg);
  const chgPct = tick?.chgPct ?? toNumber(seed?.chgPct);
  const direction = directionOf(chg);
  const tone = DIRECTION_TEXT[direction];

  return (
    <li data-slot="ticker-item" data-key={instrumentKey} className="flex flex-col justify-center leading-4">
      <span aria-hidden="true" className="flex items-center justify-between gap-3">
        <span className="truncate text-2xs font-semibold tracking-wide text-fg-muted uppercase">{name}</span>
        <span className={cn("tabular text-2xs", tone)}>{formatChange(chg)}</span>
      </span>
      <span aria-hidden="true" className="flex items-center justify-between gap-3">
        <span
          className={cn("flex items-center gap-1 tabular text-xs font-medium", stale ? "text-fg-muted" : "text-fg")}
        >
          {stale ? <StaleDot /> : null}
          {formatPrice(ltp)}
        </span>
        <span className={cn("flex items-center gap-0.5 tabular text-2xs", tone)}>
          {direction === "flat" ? null : <span className="text-[0.6rem]">{GLYPH[direction]}</span>}
          {formatPercent(chgPct)}
        </span>
      </span>
      <span className="sr-only">
        {ltp === undefined
          ? `${name}: no price yet`
          : `${name} ${formatPrice(ltp)}, ${SPOKEN[direction]} ${formatChange(chg)} (${formatPercent(chgPct)})${stale ? ", stale" : ""}`}
      </span>
    </li>
  );
});

/**
 * The navbar's index ticker (plan phase-1b "Shell"): NIFTY 50, NIFTY BANK, SENSEX and INDIA VIX with live LTP,
 * change and change %. Names and first numbers come from the market overview; live values from ticks (`useTick`),
 * subscribed only while the ticker is on screen (≥ 1280 px), released on unmount. When the feed is the simulator, an
 * amber "Simulated" badge says so (simulated prices are always labelled).
 */
export function IndexTicker({ className }: { className?: string | undefined }) {
  const overview = useMarketOverview();
  const visible = useMediaQuery(TICKER_QUERY);
  useSubscribe(visible ? TICKER_KEYS : NO_KEYS);

  const quotes = useMemo(() => {
    const byKey = new Map<string, MarketQuote>();
    for (const quote of overview.data?.indices ?? []) byKey.set(quote.key, quote);
    return byKey;
  }, [overview.data?.indices]);
  const simulated = overview.data?.feed.live === false;

  return (
    <ul aria-label="Market indices" data-slot="index-ticker" className={cn("items-center gap-4", className)}>
      {simulated ? (
        <li className="flex items-center">
          <Badge tone="warning" size="sm">
            Simulated
          </Badge>
        </li>
      ) : null}
      {TICKER.map(({ key }) => {
        const quote = quotes.get(key);
        return <TickerItem key={key} instrumentKey={key} name={quote?.symbol ?? nameFromKey(key)} seed={quote} />;
      })}
    </ul>
  );
}
