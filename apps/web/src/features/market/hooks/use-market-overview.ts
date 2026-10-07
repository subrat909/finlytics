"use client";

import { MarketOverviewSchema } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";

export const MARKET_OVERVIEW_QUERY_KEY = ["market", "overview"] as const;

/**
 * `GET /v1/market/overview`: exchange sessions, the feed's source, indices, movers and breadth (plan phase-1b
 * "Market"). One query shared by the navbar, the footer and the dashboard; live prices still come from ticks
 * (`useTick`), this refreshes the rest every 15 s while the tab is visible.
 */
export function useMarketOverview() {
  return useQuery({
    queryKey: MARKET_OVERVIEW_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/market/overview", MarketOverviewSchema, { signal }),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}
