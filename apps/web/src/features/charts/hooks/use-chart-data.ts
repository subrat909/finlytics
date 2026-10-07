"use client";

import { CandleListSchema, InstrumentSchema } from "@finlytics/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiRequest } from "@/lib/api/client";

import { normalizeBars, toBar } from "../lib/bars";
import type { Bar } from "../lib/bars";
import { DAY_S } from "../lib/time";
import { INTERVALS, maxRequestSpan } from "../schemas";
import type { ChartInterval } from "../schemas";

/** `GET /v1/instruments/:key`: the name, exchange and tick size for the header and the price format. */
export function useInstrument(key: string) {
  return useQuery({
    queryKey: ["instruments", "detail", key],
    queryFn: ({ signal }) => apiRequest(`/v1/instruments/${encodeURIComponent(key)}`, InstrumentSchema, { signal }),
    enabled: key !== "",
    staleTime: 10 * 60_000,
    retry: false,
  });
}

interface HistoryPage {
  bars: Bar[];
  /** The page's window, real epoch seconds: `[from, to)`. */
  from: number;
  to: number;
  /** Consecutive empty pages up to this one (history ends after a few). */
  emptyStreak: number;
}

interface PageParam {
  to: number;
  emptyStreak: number;
}

/** The api serves 2000 onwards. */
const EARLIEST = Date.UTC(2000, 0, 1) / 1_000;
/** Empty windows in a row before older history counts as exhausted. */
const MAX_EMPTY_PAGES = 3;

async function fetchPage(key: string, interval: ChartInterval, param: PageParam | null, signal: AbortSignal) {
  const spec = INTERVALS[interval];
  const maxSpan = maxRequestSpan(spec.source);
  // The first page is the interval's lookback; older pages take as much as one request may.
  const span = param === null ? Math.min(spec.lookbackDays * DAY_S, maxSpan) : maxSpan;
  const to = param?.to ?? Math.floor(Date.now() / 1_000);
  const from = Math.max(EARLIEST, to - span);
  const query = new URLSearchParams({ key, tf: spec.source, from: String(from), to: String(to) });
  const candles = await apiRequest(`/v1/candles?${query.toString()}`, CandleListSchema, { signal });
  const page: HistoryPage = {
    bars: candles.map(toBar),
    from,
    to,
    emptyStreak: candles.length === 0 ? (param?.emptyStreak ?? 0) + 1 : 0,
  };
  return page;
}

/**
 * Candle history for a chart, newest window first, older windows prepended on demand (`fetchOlder`, when the user
 * scrolls left or picks a longer range). Each request stays within the api's bar cap. Live bars come from ticks, so
 * the history isn't refetched on focus.
 */
export function useCandleHistory(key: string, interval: ChartInterval) {
  const query = useInfiniteQuery({
    queryKey: ["candles", "history", key, interval],
    initialPageParam: null as PageParam | null,
    queryFn: ({ pageParam, signal }) => fetchPage(key, interval, pageParam, signal),
    getNextPageParam: () => undefined,
    getPreviousPageParam: (oldest: HistoryPage): PageParam | undefined =>
      oldest.emptyStreak >= MAX_EMPTY_PAGES || oldest.from <= EARLIEST
        ? undefined
        : { to: oldest.from, emptyStreak: oldest.emptyStreak },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    enabled: key !== "",
  });

  const pages = query.data?.pages;
  const bars = useMemo(() => normalizeBars((pages ?? []).flatMap((page) => page.bars)), [pages]);
  return { query, bars };
}
