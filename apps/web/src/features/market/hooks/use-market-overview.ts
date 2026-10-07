"use client";

import { MarketOverviewSchema } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";

export const MARKET_OVERVIEW_QUERY_KEY = ["market", "overview"] as const;

export interface MarketOverviewOptions {
  /** Poll while mounted (the dashboard's movers); the shell doesn't poll: countdowns tick locally. */
  refetchMs?: number | undefined;
}

/**
 * `GET /v1/market/overview` (our cache, never a broker): sessions, the feed's source, indices, movers and breadth.
 * One query shared by the navbar, the footer and the dashboard. It refreshes when a session changes (the countdown
 * invalidates it), on `user` events, and every `refetchMs` only where a page asks.
 */
export function useMarketOverview(options: MarketOverviewOptions = {}) {
  return useQuery({
    queryKey: MARKET_OVERVIEW_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/market/overview", MarketOverviewSchema, { signal }),
    staleTime: 10_000,
    refetchInterval: options.refetchMs ?? false,
    refetchIntervalInBackground: false,
  });
}
