"use client";

import type { Instrument } from "@finlytics/shared";
import { ChartCandlestick, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { ExchangeBadge, SegmentBadge } from "@/features/instruments/components/instrument-badges";
import { accessibleName, displaySymbol, searchDetail } from "@/features/instruments/lib/describe";
import { ChangeCell, PriceCell } from "@/features/realtime/components/price-cell";
import { SimulatedBadge } from "@/features/realtime/components/simulated-badge";
import { directionOf, formatIstTime, formatPercent, formatPrice } from "@/features/realtime/format";
import { useRejectedReason, useSubscribe, useTick } from "@/features/realtime/hooks/use-realtime";
import { rejectReasonText } from "@/features/realtime/schemas";
import { useMarketStore } from "@/features/realtime/store";

import { chartHref } from "../lib/watchlist-lib";

import { IntradayChart } from "./intraday-chart";
import { MarketDepth } from "./market-depth";
import { QuoteStats } from "./quote-stats";

/** The detail panel announces the price at most this often (frontend.md: throttled `aria-live`). */
export const ANNOUNCE_EVERY_MS = 10_000;

const SPOKEN_DIRECTION = { up: "up", down: "down", flat: "unchanged" } as const;

/**
 * A polite live region for one instrument's price: the first announcement comes {@link ANNOUNCE_EVERY_MS} after the
 * panel opens, then at most that often while the price moves. Reads the store directly (no render per tick); keyed by
 * instrument, so switching rows starts over.
 */
function PriceAnnouncer({ instrumentKey, name }: { instrumentKey: string; name: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const speak = () => {
      timer = undefined;
      const tick = useMarketStore.getState().ticks.get(instrumentKey);
      if (tick === undefined) return;
      last = Date.now();
      const direction = directionOf(tick.chg);
      const change = direction === "flat" ? "" : ` ${formatPercent(Math.abs(tick.chgPct)).replace("+", "")}`;
      setText(`${name} ${formatPrice(tick.ltp)}, ${SPOKEN_DIRECTION[direction]}${change}`);
    };
    const unsubscribe = useMarketStore.subscribe((state, previous) => {
      const tick = state.ticks.get(instrumentKey);
      if (tick === undefined || tick === previous.ticks.get(instrumentKey) || timer !== undefined) return;
      timer = setTimeout(speak, Math.max(0, last + ANNOUNCE_EVERY_MS - Date.now()));
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [instrumentKey, name]);
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true" data-slot="price-announcer">
      {text}
    </p>
  );
}

/** The big price, the day's change and the time of the last trade. */
function QuoteLine({ instrumentKey }: { instrumentKey: string }) {
  const tick = useTick(instrumentKey);
  const rejected = useRejectedReason(instrumentKey);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <PriceCell instrumentKey={instrumentKey} size="lg" className="-ml-1" />
      <span className="flex items-center gap-2">
        <ChangeCell instrumentKey={instrumentKey} kind="abs" glyph={false} />
        <ChangeCell instrumentKey={instrumentKey} kind="pct" glyph={false} />
      </span>
      <span className="text-xs text-fg-muted">
        {rejected === undefined
          ? tick === undefined
            ? "Waiting for the first price"
            : `Last trade ${formatIstTime(tick.ts)} IST`
          : `No live price: ${rejectReasonText(rejected)}`}
      </span>
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-2 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
      {children}
    </h3>
  );
}

export interface InstrumentDetailProps {
  instrument: Instrument;
  /** In a sheet: a close button in the header. */
  onClose?: (() => void) | undefined;
  /** Wraps the heading (the sheet makes it the dialog's title). */
  renderTitle?: ((heading: React.ReactElement) => React.ReactNode) | undefined;
  /** Removes the instrument from the open watchlist (touch screens have no row actions); `removeLabel` names it. */
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
  /** Enter on a row focuses the heading (desktop). */
  headingRef?: React.Ref<HTMLHeadingElement> | undefined;
  className?: string | undefined;
}

/**
 * The selected instrument (docs/05 "Watchlists"): quote header with the live price and an amber "Simulated" badge when
 * the feed isn't a live broker, the day's statistics and range, five-level market depth (not for indices) and the
 * intraday chart, plus a throttled price announcement. Subscribes to its key (ref-counted with the list's).
 */
export function InstrumentDetail({
  instrument,
  onClose,
  onRemove,
  removeLabel,
  renderTitle,
  headingRef,
  className,
}: InstrumentDetailProps) {
  const id = useId();
  const key = instrument.key;
  const symbol = displaySymbol(instrument);
  useSubscribe([key]);

  const heading = (
    <h2
      ref={headingRef}
      // In a sheet the dialog's Title (asChild) gives the heading its id (an own id, even undefined, would win).
      {...(renderTitle ? {} : { id: `${id}-title` })}
      tabIndex={-1}
      className="truncate rounded-sm text-base font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      {symbol}
    </h2>
  );

  return (
    <article
      data-slot="instrument-detail"
      data-instrument-key={key}
      aria-labelledby={renderTitle ? undefined : `${id}-title`}
      className={cn("@container flex min-h-0 flex-1 flex-col", className)}
    >
      <header className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {renderTitle ? renderTitle(heading) : heading}
              <ExchangeBadge exchange={instrument.exchange} />
              <SegmentBadge segment={instrument.segment} />
              <SimulatedBadge />
            </div>
            <p className="truncate text-xs text-fg-muted">{searchDetail(instrument)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button asChild size="sm" variant="secondary">
              <Link href={chartHref(key)} data-slot="open-chart">
                <ChartCandlestick aria-hidden="true" />
                Open chart
              </Link>
            </Button>
            {onRemove ? (
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-fg-muted hover:text-loss"
                aria-label={removeLabel ?? `Remove ${symbol}`}
                title={removeLabel ?? `Remove ${symbol}`}
                onClick={onRemove}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
            {onClose ? (
              <Button size="icon-sm" variant="ghost" aria-label="Close details" onClick={onClose}>
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        <QuoteLine instrumentKey={key} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid gap-x-6 gap-y-5 p-4 @3xl:grid-cols-2">
          <section aria-labelledby={`${id}-today`} className="@3xl:col-span-2">
            <SectionTitle id={`${id}-today`}>Today</SectionTitle>
            <QuoteStats instrument={instrument} />
          </section>
          <section aria-labelledby={`${id}-depth`}>
            <SectionTitle id={`${id}-depth`}>Market depth</SectionTitle>
            {instrument.segment === "INDEX" ? (
              <p className="py-2 text-xs text-fg-muted">
                Indices aren&apos;t traded, so they have no order book. Add a future or an option to see depth.
              </p>
            ) : (
              <MarketDepth instrumentKey={key} symbol={symbol} />
            )}
          </section>
          <section aria-labelledby={`${id}-chart`} className="flex flex-col">
            <SectionTitle id={`${id}-chart`}>Intraday · 5 min</SectionTitle>
            <div className="h-56 @3xl:h-auto @3xl:min-h-56 @3xl:flex-1">
              <IntradayChart instrumentKey={key} symbol={symbol} />
            </div>
          </section>
        </div>
      </div>
      <PriceAnnouncer key={key} instrumentKey={key} name={accessibleName(instrument)} />
    </article>
  );
}
