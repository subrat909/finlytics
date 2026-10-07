"use client";

import { FundsViewSchema, HoldingsViewSchema, PositionsViewSchema } from "@finlytics/shared";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { z } from "zod";

import { BROKERS_QUERY_KEY } from "@/features/brokers/hooks/use-brokers";
import { MARKET_OVERVIEW_QUERY_KEY } from "@/features/market/hooks/use-market-overview";
import { apiRequest, isApiError } from "@/lib/api/client";
import type { ApiPath } from "@/lib/api/client";

export const PORTFOLIO_QUERY_KEY = ["portfolio"] as const;

/** Fresh for five seconds, like the api's per-account cache (broker.md: funds/positions cached 5 s). */
export const PORTFOLIO_STALE_MS = 30_000;

export type PortfolioKind = "funds" | "positions" | "holdings";

export function portfolioQueryKey(kind: PortfolioKind, accountId?: string) {
  return [...PORTFOLIO_QUERY_KEY, kind, accountId ?? "default"] as const;
}

export function portfolioPath(kind: PortfolioKind, accountId?: string): ApiPath {
  return `/v1/portfolio/${kind}${accountId === undefined ? "" : `?accountId=${encodeURIComponent(accountId)}`}`;
}

/**
 * What a failed portfolio request means for the page:
 * - `no_broker`: 404 `NOT_FOUND`, no ACTIVE account (or the chosen one is gone) → the onboarding state.
 * - `needs_relogin`: 409 `NEEDS_RELOGIN`, the broker session ended → the one-click re-login prompt.
 * - `error`: anything else → an error state with a retry.
 */
export type PortfolioErrorKind = "no_broker" | "needs_relogin" | "error";

export function portfolioErrorKind(error: unknown): PortfolioErrorKind {
  if (isApiError(error)) {
    if (error.code === "NEEDS_RELOGIN") return "needs_relogin";
    if (error.code === "NOT_FOUND" || error.status === 404) return "no_broker";
  }
  return "error";
}

export interface PortfolioQueryOptions {
  /** False until the page knows there is an ACTIVE account (no request otherwise). */
  enabled?: boolean | undefined;
}

function usePortfolioQuery<T>(
  kind: PortfolioKind,
  schema: z.ZodType<T>,
  accountId: string | undefined,
  { enabled = true }: PortfolioQueryOptions,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: portfolioQueryKey(kind, accountId),
    queryFn: async ({ signal }) => {
      try {
        return await apiRequest(portfolioPath(kind, accountId), schema, { signal });
      } catch (error) {
        // NEEDS_RELOGIN: the api has just marked the account; NOT_FOUND: the list is stale (account gone or inactive).
        // The banner and the broker panels read the list, so refresh it.
        if (isApiError(error) && (error.code === "NEEDS_RELOGIN" || error.code === "NOT_FOUND")) {
          void queryClient.invalidateQueries({ queryKey: BROKERS_QUERY_KEY });
        }
        throw error;
      }
    },
    staleTime: PORTFOLIO_STALE_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/** `GET /v1/portfolio/funds`: margins of `accountId` (default: the user's default ACTIVE account). */
export function useFunds(accountId?: string, options: PortfolioQueryOptions = {}) {
  return usePortfolioQuery("funds", FundsViewSchema, accountId, options);
}

/** `GET /v1/portfolio/positions`: today's net positions, open first. Live P&L comes from ticks on top. */
export function usePositions(accountId?: string, options: PortfolioQueryOptions = {}) {
  return usePortfolioQuery("positions", PositionsViewSchema, accountId, options);
}

/** `GET /v1/portfolio/holdings`: delivery holdings, largest first. */
export function useHoldings(accountId?: string, options: PortfolioQueryOptions = {}) {
  return usePortfolioQuery("holdings", HoldingsViewSchema, accountId, options);
}

/**
 * The dashboard's refresh: funds, positions, holdings, the broker list and the market overview again. `refreshing`
 * is true while any portfolio request is in flight.
 */
export function useRefreshPortfolio() {
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: PORTFOLIO_QUERY_KEY }) > 0;
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: PORTFOLIO_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: BROKERS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: MARKET_OVERVIEW_QUERY_KEY }),
    ]);
  }, [queryClient]);
  return { refresh, refreshing };
}
