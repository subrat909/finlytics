"use client";

import { CandleListSchema } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";
import { ChartLine } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo } from "react";

import { Button } from "@finlytics/ui/components/button";
import { Skeleton } from "@finlytics/ui/components/skeleton";

import { formatPrice } from "@/features/realtime/format";
import { useMarketStore } from "@/features/realtime/store";
import { apiRequest } from "@/lib/api/client";

import { intradayRange, lastSession } from "../lib/intraday";

/** The chart's shape while Lightweight Charts and the candles load. */
export function IntradayChartSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col justify-end gap-2" data-slot="mini-chart-skeleton">
      <Skeleton shape="block" className="min-h-0 flex-1" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

const MiniChart = dynamic(() => import("./mini-chart"), {
  ssr: false,
  loading: () => <IntradayChartSkeleton />,
});

/** `GET /v1/candles?tf=M5` for the last few days; the chart keeps the latest session. Refreshed every minute. */
export function useIntradayCandles(instrumentKey: string) {
  return useQuery({
    queryKey: ["candles", instrumentKey, "M5", "intraday"],
    queryFn: ({ signal }) => {
      const { from, to } = intradayRange(Date.now());
      const query = new URLSearchParams({ key: instrumentKey, tf: "M5", from: String(from), to: String(to) });
      return apiRequest(`/v1/candles?${query.toString()}`, CandleListSchema, { signal });
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export interface IntradayChartProps {
  instrumentKey: string;
  symbol: string;
}

/** The intraday (5-minute) line of one instrument around its previous close, with loading, empty and error states. */
export function IntradayChart({ instrumentKey, symbol }: IntradayChartProps) {
  const candles = useIntradayCandles(instrumentKey);
  const points = useMemo(() => lastSession(candles.data ?? []), [candles.data]);
  // Only the previous close: this component doesn't re-render per tick (the chart reads ticks itself).
  const previousClose = useMarketStore((state) => state.ticks.get(instrumentKey)?.close ?? null);

  if (candles.isPending) {
    return (
      <div role="status" aria-label={`Loading the intraday chart for ${symbol}`} className="h-full">
        <IntradayChartSkeleton />
      </div>
    );
  }
  if (candles.isError) {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-fg">The intraday chart didn&apos;t load.</p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void candles.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center" data-slot="mini-chart-empty">
        <ChartLine aria-hidden="true" className="size-5 text-highlight" />
        <p className="max-w-60 text-xs text-fg-muted">
          No intraday candles yet. The line appears once the first 5-minute candle closes.
        </p>
      </div>
    );
  }
  const values = points.map((point) => point.value);
  const summary = `${symbol} intraday chart, 5-minute closes: ${String(points.length)} points from ${formatPrice(first.value)} to ${formatPrice(last.value)}, high ${formatPrice(Math.max(...values))}, low ${formatPrice(Math.min(...values))}`;
  return (
    <MiniChart
      instrumentKey={instrumentKey}
      points={points}
      baseline={previousClose ?? first.value}
      summary={summary}
    />
  );
}
