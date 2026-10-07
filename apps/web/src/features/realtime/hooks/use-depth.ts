"use client";

import { RtDepthSchema } from "@finlytics/shared";
import type { RtDepth } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiRequest, isApiError } from "@/lib/api/client";

import { useRealtimeClient } from "../components/realtime-provider";
import { depthFromWire } from "../schemas";
import type { Depth } from "../schemas";
import { marketActions, useMarketStore } from "../store";

export interface DepthView {
  /** The latest book, best levels first; undefined until a snapshot or the first streamed book. */
  depth: Depth | undefined;
  /** The REST snapshot is loading and nothing has streamed yet. */
  loading: boolean;
  /** Why the server refused to stream it (the `dsub` ack's reason), if it did. */
  rejected: string | undefined;
}

/** `GET /v1/quotes/depth?key=`: the last book the feed saw; null without one (404). */
async function fetchDepth(key: string, signal: AbortSignal): Promise<RtDepth | null> {
  try {
    return await apiRequest(`/v1/quotes/depth?key=${encodeURIComponent(key)}`, RtDepthSchema, { signal });
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/**
 * `key`'s market depth while the component is mounted: the stream (`dsub`, ref-counted across the tab, released in
 * the effect's cleanup) plus the last snapshot from `GET /v1/quotes/depth` so a book shows at once and when the market
 * is closed. Undefined `key` (an index: no order book) subscribes to nothing.
 */
export function useDepth(key: string | undefined): DepthView {
  const client = useRealtimeClient();
  const active = key === undefined || key === "" ? undefined : key;

  useEffect(() => {
    if (client === null || active === undefined) return;
    return client.subscribeDepth(active);
  }, [client, active]);

  const seed = useQuery({
    queryKey: ["quotes", "depth", active],
    queryFn: ({ signal }) => fetchDepth(active ?? "", signal),
    enabled: active !== undefined,
    staleTime: 5_000,
    retry: false,
  });

  useEffect(() => {
    const snapshot = seed.data;
    if (active === undefined || snapshot === undefined || snapshot === null || snapshot.k !== active) return;
    marketActions.seedDepth(active, depthFromWire(snapshot, snapshot.t));
  }, [active, seed.data]);

  const depth = useMarketStore((state) => (active === undefined ? undefined : state.depth.get(active)));
  const rejected = useMarketStore((state) => (active === undefined ? undefined : state.depthRejected.get(active)));
  return { depth, loading: depth === undefined && seed.isLoading, rejected };
}
