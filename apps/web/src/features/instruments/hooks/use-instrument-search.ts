"use client";

import { InstrumentListSchema } from "@finlytics/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";

export const SEARCH_LIMIT = 20;

/** `GET /v1/instruments?q=&limit=20`; the previous results stay while the next query loads. */
export function useInstrumentSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["instruments", "search", q],
    queryFn: ({ signal }) =>
      apiRequest(`/v1/instruments?q=${encodeURIComponent(q)}&limit=${String(SEARCH_LIMIT)}`, InstrumentListSchema, {
        signal,
      }),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
