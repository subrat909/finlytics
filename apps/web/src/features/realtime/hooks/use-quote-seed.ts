"use client";

import { MAX_QUOTE_KEYS, QuotesResultSchema } from "@finlytics/shared";
import type { QuotesResult } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiRequest } from "@/lib/api/client";

import { quoteToTick } from "../schemas";
import type { Tick } from "../schemas";
import { marketActions } from "../store";

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function fetchQuotes(keys: readonly string[], signal: AbortSignal): Promise<QuotesResult> {
  const pages = await Promise.all(
    chunks(keys, MAX_QUOTE_KEYS).map((page) =>
      apiRequest(`/v1/quotes?keys=${page.map(encodeURIComponent).join(",")}`, QuotesResultSchema, { signal }),
    ),
  );
  return Object.assign({}, ...pages) as QuotesResult;
}

/**
 * Last known quotes for `keys` (`GET /v1/quotes`, ≤ 50 per request), written into the market store so prices show
 * before the first tick, and when the market is closed. A failure only means waiting for ticks, so it's silent.
 */
export function useQuoteSeed(keys: readonly string[]): void {
  const sorted = [...new Set(keys)].sort();
  const query = useQuery({
    queryKey: ["quotes", sorted],
    queryFn: ({ signal }) => fetchQuotes(sorted, signal),
    enabled: sorted.length > 0,
    staleTime: 5_000,
    retry: false,
  });

  useEffect(() => {
    if (query.data === undefined) return;
    const seeds = new Map<string, Tick>();
    for (const [key, quote] of Object.entries(query.data)) seeds.set(key, quoteToTick(quote));
    marketActions.seedTicks(seeds);
  }, [query.data]);
}
