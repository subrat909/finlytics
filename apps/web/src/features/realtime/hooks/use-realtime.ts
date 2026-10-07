"use client";

import { useEffect } from "react";

import { useRealtimeClient } from "../components/realtime-provider";
import type { FeedSource, Tick } from "../schemas";
import { isStale, useMarketStore } from "../store";
import type { ConnectionStatus, MarketState } from "../store";

export { useDepth } from "./use-depth";
export type { DepthView } from "./use-depth";

const SEPARATOR = "\n";

/**
 * Subscribes to live ticks for `keys` while the component is mounted (ref-counted across the tab; released in the
 * effect's cleanup). The dependency is the keys' content, so a new array with the same keys changes nothing.
 */
export function useSubscribe(keys: readonly string[]): void {
  const client = useRealtimeClient();
  const signature = keys.filter((key) => key !== "").join(SEPARATOR);

  useEffect(() => {
    if (client === null || signature === "") return;
    return client.subscribe(signature.split(SEPARATOR));
  }, [client, signature]);
}

/** The latest tick for `key`; re-renders only when this key's tick changes (≤ 10 times a second). */
export function useTick(key: string | undefined): Tick | undefined {
  return useMarketStore((state) => (key === undefined ? undefined : state.ticks.get(key)));
}

/** Whether `key`'s last tick is older than five seconds; re-renders only when that flips. */
export function useIsStale(key: string | undefined): boolean {
  return useMarketStore((state) => key !== undefined && isStale(state.ticks.get(key), state.now));
}

/** Why the server refused to stream `key`, if it did. */
export function useRejectedReason(key: string | undefined): string | undefined {
  return useMarketStore((state) => (key === undefined ? undefined : state.rejected.get(key)));
}

export function useConnectionStatus(): ConnectionStatus {
  return useMarketStore((state) => state.connection);
}

export function useFeedStatus(): MarketState["feed"] {
  return useMarketStore((state) => state.feed);
}

/**
 * Which broker's feed drives the prices, and whether it is live (`live: false` is the paper simulator: label prices
 * "Simulated"). Undefined until the server's first `status`.
 */
export function useFeedSource(): FeedSource | undefined {
  return useMarketStore((state) => state.source);
}
