"use client";

import { CandlestickChart, SearchX } from "lucide-react";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { EmptyState } from "@finlytics/ui/components/empty-state";
import { cn } from "@finlytics/ui/lib/utils";

import { DEFAULT_INTERVAL } from "../schemas";
import type { ChartInterval } from "../schemas";

import { ChartWorkspaceSkeleton } from "./chart-skeleton";
import { POPULAR, SymbolSearch } from "./symbol-search";
import { focusRing } from "./ui";

const ChartWorkspace = dynamic(() => import("./chart-workspace"), {
  ssr: false,
  loading: () => <ChartWorkspaceSkeleton />,
});

const TradingViewChart = dynamic(() => import("./tradingview-chart"), {
  ssr: false,
  loading: () => <ChartWorkspaceSkeleton />,
});

function href(key: string, interval: ChartInterval): Route {
  return `/charts?key=${encodeURIComponent(key)}&tf=${interval}` as Route;
}

/** No instrument yet (or a broken link): search, or one click on a popular index. */
function ChartsEmpty({ invalidKey, interval }: { invalidKey: boolean; interval: ChartInterval }) {
  const router = useRouter();
  return (
    <div className="flex min-w-0 flex-1 overflow-y-auto bg-bg p-1">
      <section
        aria-labelledby="charts-empty"
        className="flex min-h-full w-full flex-col items-center rounded-sm border border-border bg-surface-1"
      >
        <h1 className="sr-only">Charts</h1>
        <EmptyState
          id="charts-empty"
          className="w-full pb-6"
          icon={invalidKey ? <SearchX className="text-warning" /> : <CandlestickChart className="text-highlight" />}
          title={invalidKey ? "That instrument link isn't valid" : "Choose an instrument"}
          description={
            invalidKey
              ? "Search for the instrument instead."
              : "Search an index, a stock or an option to open its chart, with live candles, indicators and drawing tools."
          }
          action={
            <SymbolSearch
              label="Open a chart"
              variant="inline"
              onSelect={(option) => {
                router.push(href(option.key, interval));
              }}
              className="w-full max-w-md text-left"
            />
          }
        />
        <nav aria-label="Popular indices" className="w-full max-w-3xl px-4 pb-10">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">Popular indices</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {POPULAR.map((option) => (
              <li key={option.key}>
                <Link
                  href={href(option.key, interval)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-sm bg-surface-2 px-3 py-2.5 transition-[background-color] hover:bg-surface-3",
                    focusRing,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">{option.symbol}</span>
                    <span className="block truncate text-xs text-fg-muted">{option.description}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-fg-muted">{option.exchange}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </div>
  );
}

export interface ChartsViewProps {
  /** A canonical key from `?key=`, or undefined when there is none. */
  instrumentKey?: string | undefined;
  /** `?key=` was there but isn't a valid instrument key. */
  invalidKey?: boolean | undefined;
  /** From `?tf=`, when valid. */
  interval?: ChartInterval | undefined;
  /** Set when the licensed Advanced Charts library and its UDF datafeed are vendored in `public/`. */
  datafeedPath?: string | undefined;
  userId?: string | undefined;
}

/**
 * `/charts?key=&tf=` (plan phase-1b "Charts"): the TradingView-style workspace on Lightweight Charts, or TradingView
 * Advanced Charts when the licensed library is vendored. Without an instrument: the search and popular indices.
 */
export function ChartsView({ instrumentKey, invalidKey, interval, datafeedPath, userId }: ChartsViewProps) {
  if (instrumentKey === undefined) {
    return <ChartsEmpty invalidKey={invalidKey ?? false} interval={interval ?? DEFAULT_INTERVAL} />;
  }
  if (datafeedPath !== undefined) {
    const symbol = instrumentKey.split("|")[1] ?? instrumentKey;
    return (
      <div className="flex min-w-0 flex-1 bg-bg p-1">
        <section
          aria-label={`${symbol} chart`}
          className="relative min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-surface-1"
        >
          <h1 className="sr-only">{symbol} chart</h1>
          <TradingViewChart
            instrumentKey={instrumentKey}
            timeframe={interval ?? DEFAULT_INTERVAL}
            datafeedPath={datafeedPath}
            summary={`${symbol} chart`}
          />
        </section>
      </div>
    );
  }
  return <ChartWorkspace key={instrumentKey} instrumentKey={instrumentKey} interval={interval} userId={userId} />;
}
