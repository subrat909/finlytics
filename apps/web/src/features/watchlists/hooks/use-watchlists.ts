"use client";

import { InstrumentListSchema, WatchlistListSchema, WatchlistSchema } from "@finlytics/shared";
import type { Instrument, Watchlist } from "@finlytics/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiRequest } from "@/lib/api/client";

export const WATCHLISTS_QUERY_KEY = ["watchlists"] as const;
export const SEARCH_LIMIT = 20;

function listPath(id: string): `/v1/${string}` {
  return `/v1/watchlists/${encodeURIComponent(id)}`;
}

/** `GET /v1/watchlists` with items. */
export function useWatchlists() {
  return useQuery({
    queryKey: WATCHLISTS_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/watchlists", WatchlistListSchema, { signal }),
  });
}

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

function useInvalidateWatchlists() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: WATCHLISTS_QUERY_KEY });
}

/** Optimistic edits of the cached lists; the returned snapshot restores them if the request fails. */
function useOptimisticLists() {
  const queryClient = useQueryClient();
  return {
    async apply(update: (lists: Watchlist[]) => Watchlist[]) {
      await queryClient.cancelQueries({ queryKey: WATCHLISTS_QUERY_KEY });
      const previous = queryClient.getQueryData<Watchlist[]>(WATCHLISTS_QUERY_KEY);
      if (previous) queryClient.setQueryData<Watchlist[]>(WATCHLISTS_QUERY_KEY, update(previous));
      return previous;
    },
    restore(previous: Watchlist[] | undefined) {
      if (previous) queryClient.setQueryData(WATCHLISTS_QUERY_KEY, previous);
    },
  };
}

export function useCreateWatchlist() {
  const invalidate = useInvalidateWatchlists();
  return useMutation({
    mutationKey: ["watchlists", "create"],
    mutationFn: (name: string) => apiRequest("/v1/watchlists", WatchlistSchema, { method: "POST", json: { name } }),
    onSettled: invalidate,
  });
}

export function useRenameWatchlist() {
  const invalidate = useInvalidateWatchlists();
  return useMutation({
    mutationKey: ["watchlists", "rename"],
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest(listPath(id), z.unknown(), { method: "PATCH", json: { name } }),
    onSettled: invalidate,
  });
}

export function useDeleteWatchlist() {
  const invalidate = useInvalidateWatchlists();
  const optimistic = useOptimisticLists();
  return useMutation({
    mutationKey: ["watchlists", "delete"],
    mutationFn: (id: string) => apiRequest(listPath(id), z.unknown(), { method: "DELETE" }),
    onMutate: (id) => optimistic.apply((lists) => lists.filter((list) => list.id !== id)),
    onError: (_error, _id, previous) => {
      optimistic.restore(previous);
    },
    onSettled: invalidate,
  });
}

export function useAddWatchlistItem() {
  const invalidate = useInvalidateWatchlists();
  return useMutation({
    mutationKey: ["watchlists", "items", "add"],
    mutationFn: ({ watchlistId, instrument }: { watchlistId: string; instrument: Instrument }) =>
      apiRequest(`${listPath(watchlistId)}/items`, z.unknown(), {
        method: "POST",
        json: { instrumentKey: instrument.key },
      }),
    onSettled: invalidate,
  });
}

export function useRemoveWatchlistItem() {
  const invalidate = useInvalidateWatchlists();
  const optimistic = useOptimisticLists();
  return useMutation({
    mutationKey: ["watchlists", "items", "remove"],
    mutationFn: ({ watchlistId, itemId }: { watchlistId: string; itemId: string }) =>
      apiRequest(`${listPath(watchlistId)}/items/${encodeURIComponent(itemId)}`, z.unknown(), { method: "DELETE" }),
    onMutate: ({ watchlistId, itemId }) =>
      optimistic.apply((lists) =>
        lists.map((list) =>
          list.id === watchlistId ? { ...list, items: list.items.filter((item) => item.id !== itemId) } : list,
        ),
      ),
    onError: (_error, _variables, previous) => {
      optimistic.restore(previous);
    },
    onSettled: invalidate,
  });
}

/** `PUT /v1/watchlists/:id/items/order {itemIds}`: the whole order, applied optimistically. */
export function useReorderWatchlistItems() {
  const invalidate = useInvalidateWatchlists();
  const optimistic = useOptimisticLists();
  return useMutation({
    mutationKey: ["watchlists", "items", "order"],
    mutationFn: ({ watchlistId, itemIds }: { watchlistId: string; itemIds: readonly string[] }) =>
      apiRequest(`${listPath(watchlistId)}/items/order`, z.unknown(), { method: "PUT", json: { itemIds } }),
    onMutate: ({ watchlistId, itemIds }) =>
      optimistic.apply((lists) =>
        lists.map((list) => {
          if (list.id !== watchlistId) return list;
          const byId = new Map(list.items.map((item) => [item.id, item]));
          const items = itemIds.flatMap((id, position) => {
            const item = byId.get(id);
            return item ? [{ ...item, position }] : [];
          });
          return { ...list, items };
        }),
      ),
    onError: (_error, _variables, previous) => {
      optimistic.restore(previous);
    },
    onSettled: invalidate,
  });
}
