"use client";

import { CandleListSchema, InstrumentSchema } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";
import { CandlestickChart, SearchX } from "lucide-react";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";

import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { FeedStatus } from "@/features/realtime/components/feed-status";
import { ChangeCell, PriceCell } from "@/features/realtime/components/price-cell";
import { formatPrice } from "@/features/realtime/format";
import { useQuoteSeed } from "@/features/realtime/hooks/use-quote-seed";
import { useSubscribe } from "@/features/realtime/hooks/use-realtime";
import { useMarketStore } from "@/features/realtime/store";
import { InstrumentSearch } from "@/features/watchlists/components/instrument-search";
import { apiRequest, isApiError } from "@/lib/api/client";

import { candleRange, toBar } from "../lib/bars";
import { TIMEFRAMES, TIMEFRAME_LABELS, TIMEFRAME_LOOKBACK_DAYS, TIMEFRAME_SECONDS } from "../schemas";
import type { Timeframe } from "../schemas";

/** The chart area: fills the viewport below the header and toolbar (frontend.md: charts fill viewport height). */
const CHART_AREA = "h-[calc(100dvh-15rem)] min-h-80";

export function ChartAreaSkeleton({ label = "Loading chart" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn(CHART_AREA, "flex flex-col gap-3 p-3")}>
      <Skeleton shape="block" className="flex-1" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

const LightweightChart = dynamic(() => import("./lightweight-chart"), {
  ssr: false,
  loading: () => <ChartAreaSkeleton />,
});

const TradingViewChart = dynamic(() => import("./tradingview-chart"), {
  ssr: false,
  loading: () => <ChartAreaSkeleton />,
});

export function chartsHref(key: string, timeframe: Timeframe): Route {
  return `/charts?key=${encodeURIComponent(key)}&tf=${timeframe}` as Route;
}

function useInstrument(key: string) {
  return useQuery({
    queryKey: ["instruments", "detail", key],
    queryFn: ({ signal }) => apiRequest(`/v1/instruments/${encodeURIComponent(key)}`, InstrumentSchema, { signal }),
    enabled: key !== "",
    staleTime: 10 * 60_000,
    retry: false,
  });
}

function useCandles(key: string, timeframe: Timeframe) {
  return useQuery({
    queryKey: ["candles", key, timeframe],
    queryFn: ({ signal }) => {
      const { from, to } = candleRange(TIMEFRAME_LOOKBACK_DAYS[timeframe], Date.now());
      const query = new URLSearchParams({ key, tf: timeframe, from: String(from), to: String(to) });
      return apiRequest(`/v1/candles?${query.toString()}`, CandleListSchema, { signal });
    },
    staleTime: 60_000,
  });
}

/**
 * Speaks the price at most every 30 s (frontend.md: throttled `aria-live` for prices), straight from the store, so a
 * tick never re-renders anything.
 */
function LivePriceAnnouncer({ instrumentKey, symbol }: { instrumentKey: string; symbol: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let spokenAt = 0;
    return useMarketStore.subscribe((state, previous) => {
      const tick = state.ticks.get(instrumentKey);
      if (tick === undefined || tick === previous.ticks.get(instrumentKey) || ref.current === null) return;
      if (tick.receivedAt - spokenAt < 30_000) return;
      spokenAt = tick.receivedAt;
      ref.current.textContent = `${symbol} ${formatPrice(tick.ltp)}`;
    });
  }, [instrumentKey, symbol]);
  return <p ref={ref} aria-live="polite" className="sr-only" data-slot="live-price-announcer" />;
}

interface TimeframeSwitcherProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}

/** The timeframe as a radio group: arrow keys move and select (the APG pattern), one tab stop. */
function TimeframeSwitcher({ value, onChange }: TimeframeSwitcherProps) {
  const refs = useRef(new Map<Timeframe, HTMLButtonElement>());
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    }
  };
  const move = (offset: number) => {
    const index = TIMEFRAMES.indexOf(value);
    const next = TIMEFRAMES[(index + offset + TIMEFRAMES.length) % TIMEFRAMES.length] ?? value;
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Timeframe"
      data-slot="timeframe-switcher"
      className="inline-flex rounded-md bg-surface-2 p-0.5"
    >
      {TIMEFRAMES.map((timeframe) => {
        const checked = timeframe === value;
        return (
          <button
            key={timeframe}
            ref={(node) => {
              if (node) refs.current.set(timeframe, node);
              else refs.current.delete(timeframe);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={TIMEFRAME_LABELS[timeframe].long}
            tabIndex={checked ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => {
              onChange(timeframe);
            }}
            className={cn(
              "h-8 min-w-10 cursor-pointer rounded-md px-2.5 text-sm font-medium tabular transition-[color,background-color]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
              checked ? "bg-surface-1 text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {TIMEFRAME_LABELS[timeframe].short}
          </button>
        );
      })}
    </div>
  );
}

interface ChartPanelProps {
  instrumentKey: string;
  timeframe: Timeframe;
  symbol: string;
  datafeedPath: string | undefined;
}

function ChartPanel({ instrumentKey, timeframe, symbol, datafeedPath }: ChartPanelProps) {
  const candles = useCandles(instrumentKey, timeframe);
  const bars = useMemo(() => (candles.data ?? []).map(toBar), [candles.data]);
  const label = TIMEFRAME_LABELS[timeframe].long;

  if (datafeedPath !== undefined) {
    return (
      <TradingViewChart
        instrumentKey={instrumentKey}
        timeframe={timeframe}
        datafeedPath={datafeedPath}
        summary={`${symbol} chart, ${label} candles`}
      />
    );
  }
  if (candles.isPending) return <ChartAreaSkeleton label="Loading candles" />;
  if (candles.isError) {
    return (
      <ErrorState
        size="inline"
        className={CHART_AREA}
        title="The candles didn't load"
        description="The Finlytics service didn't answer. Try again in a moment."
        reference={isApiError(candles.error) ? candles.error.requestId : undefined}
        onRetry={async () => {
          await candles.refetch({ throwOnError: true });
        }}
      />
    );
  }
  const last = bars.at(-1);
  const summary =
    last === undefined
      ? `${symbol} chart, ${label} candles, no history yet; live ticks draw the first candle`
      : `${symbol} candlestick chart, ${label} candles, ${String(bars.length)} candles, last close ${formatPrice(last.close)}`;
  return (
    <div className={cn(CHART_AREA, "relative")}>
      <LightweightChart
        bars={bars}
        instrumentKey={instrumentKey}
        period={TIMEFRAME_SECONDS[timeframe]}
        summary={summary}
      />
      {last === undefined ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-fg-muted">
          No price history for this timeframe yet. Live ticks draw the first candle.
        </p>
      ) : null}
    </div>
  );
}

export interface ChartsViewProps {
  /** A canonical key from `?key=`, or undefined when there is none. */
  instrumentKey?: string | undefined;
  /** `?key=` was there but isn't a valid instrument key. */
  invalidKey?: boolean | undefined;
  timeframe: Timeframe;
  /** Set when the licensed Advanced Charts library and its UDF datafeed are vendored in `public/`. */
  datafeedPath?: string | undefined;
}

/**
 * `/charts?key=` (docs/05 Charts): the instrument, its live price, a timeframe switcher and the chart. Picks an
 * instrument through the search when there's none (or it's invalid).
 */
export function ChartsView({ instrumentKey, invalidKey, timeframe: initialTimeframe, datafeedPath }: ChartsViewProps) {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const subscribed = useMemo(() => (instrumentKey ? [instrumentKey] : []), [instrumentKey]);
  useSubscribe(subscribed);
  useQuoteSeed(subscribed);
  const instrument = useInstrument(instrumentKey ?? "");
  const symbol = instrument.data?.symbol ?? instrumentKey?.split("|")[1] ?? "";

  const changeTimeframe = (next: Timeframe) => {
    setTimeframe(next);
    // The URL keeps the choice (shareable, survives reload) without a server round trip.
    if (instrumentKey) window.history.replaceState(null, "", chartsHref(instrumentKey, next));
  };

  const search = (
    <InstrumentSearch
      label="Open a chart"
      hideLabel={instrumentKey !== undefined}
      placeholder="Search an instrument to chart…"
      onSelect={(selected) => {
        router.push(chartsHref(selected.key, timeframe));
      }}
      className="sm:max-w-sm"
    />
  );

  let content: React.ReactNode;
  if (instrumentKey === undefined) {
    content = (
      <section aria-labelledby="charts-empty" className="rounded-md bg-surface-1">
        <EmptyState
          id="charts-empty"
          icon={invalidKey ? <SearchX className="text-warning" /> : <CandlestickChart className="text-highlight" />}
          title={invalidKey ? "That instrument link isn't valid" : "Choose an instrument"}
          description={
            invalidKey
              ? "Search for the instrument instead."
              : "Search an index, a stock or an option to see its candles update live."
          }
          action={<div className="w-full max-w-sm text-left">{search}</div>}
        />
      </section>
    );
  } else {
    content = (
      <>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm text-fg-muted" data-slot="chart-instrument-name">
              {instrument.data ? `${instrument.data.name} · ${instrument.data.exchange}` : instrumentKey.split("|")[0]}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <PriceCell instrumentKey={instrumentKey} size="lg" />
              <ChangeCell instrumentKey={instrumentKey} kind="abs" />
              <ChangeCell instrumentKey={instrumentKey} kind="pct" />
            </div>
            <LivePriceAnnouncer instrumentKey={instrumentKey} symbol={symbol} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TimeframeSwitcher value={timeframe} onChange={changeTimeframe} />
            <FeedStatus />
          </div>
        </div>
        <section aria-label={`${symbol} chart`} className="overflow-hidden rounded-md bg-surface-1">
          <ChartPanel
            key={datafeedPath === undefined ? "lw" : "tv"}
            instrumentKey={instrumentKey}
            timeframe={timeframe}
            symbol={symbol}
            datafeedPath={datafeedPath}
          />
        </section>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {instrumentKey === undefined ? "Charts" : symbol}
          {instrumentKey === undefined ? null : (
            <>
              {" "}
              <span className="sr-only">chart</span>
            </>
          )}
        </h1>
        {instrumentKey === undefined ? null : search}
      </div>
      {content}
    </>
  );
}
