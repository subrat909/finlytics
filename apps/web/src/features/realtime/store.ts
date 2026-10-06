/**
 * `useMarketStore` (frontend.md "State"): the live ticks in a Map, the socket and feed status, the keys the server
 * refused and a one-second clock for staleness. Components read one value through a selector (`useTick`,
 * `useIsStale`), so a tick re-renders only the cells of its own instrument. Writes come from the RealtimeClient in
 * batches (at most ten a second) and from REST quote seeds.
 */
import { create } from "zustand";

import type { FeedStatus, Tick } from "./schemas";

/** Ticks older than this are stale: a grey dot instead of the live colour (frontend.md "Edge cases"). */
export const STALE_AFTER_MS = 5_000;

/**
 * The socket, as the UI shows it:
 * - `idle`: nothing subscribed yet, so no socket (pages without live prices never open one).
 * - `connecting` / `reconnecting`: first attempt, or retrying with backoff after a drop.
 * - `connected`: the `/rt` namespace accepted us.
 * - `unavailable`: the server refused the handshake (signed out, origin) or gave up; `retry()` tries again.
 */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "unavailable";

export interface MarketState {
  ticks: ReadonlyMap<string, Tick>;
  connection: ConnectionStatus;
  /** The shared broker feed behind the socket; `unknown` until the server says. */
  feed: FeedStatus | "unknown";
  /** Keys the server refused, with its reason (a plan's `maxRtSubscriptions`, an unknown key). */
  rejected: ReadonlyMap<string, string>;
  /** Epoch ms, advanced every second while anything is subscribed; staleness compares against it. */
  now: number;
}

const EMPTY_TICKS: ReadonlyMap<string, Tick> = new Map();
const EMPTY_REJECTED: ReadonlyMap<string, string> = new Map();

function initialState(): MarketState {
  return { ticks: EMPTY_TICKS, connection: "idle", feed: "unknown", rejected: EMPTY_REJECTED, now: Date.now() };
}

export const useMarketStore = create<MarketState>()(() => initialState());

/** Writes, for the RealtimeClient and the quote seeds (no React needed). */
export const marketActions = {
  /** Applies a batch: one new Map per batch, unchanged ticks keep their identity (their cells don't re-render). */
  applyTicks(batch: ReadonlyMap<string, Tick>): void {
    if (batch.size === 0) return;
    useMarketStore.setState((state) => {
      const ticks = new Map(state.ticks);
      for (const [key, tick] of batch) ticks.set(key, tick);
      return { ticks };
    });
  },

  /** Initial values from `GET /v1/quotes`; never overwrites a tick that is at least as new. */
  seedTicks(seeds: ReadonlyMap<string, Tick>): void {
    if (seeds.size === 0) return;
    useMarketStore.setState((state) => {
      let ticks: Map<string, Tick> | undefined;
      for (const [key, seed] of seeds) {
        const current = state.ticks.get(key);
        if (current !== undefined && current.ts >= seed.ts) continue;
        ticks ??= new Map(state.ticks);
        ticks.set(key, seed);
      }
      return ticks === undefined ? state : { ticks };
    });
  },

  /** Drops keys nothing shows any more, so the Map stays the size of what's on screen. */
  forget(keys: readonly string[]): void {
    useMarketStore.setState((state) => {
      // Returning the same state skips the update (and every selector) entirely.
      if (!keys.some((key) => state.ticks.has(key) || state.rejected.has(key))) return state;
      const ticks = new Map(state.ticks);
      const rejected = new Map(state.rejected);
      for (const key of keys) {
        ticks.delete(key);
        rejected.delete(key);
      }
      return { ticks, rejected };
    });
  },

  setRejected(entries: readonly { key: string; reason: string }[]): void {
    if (entries.length === 0) return;
    useMarketStore.setState((state) => {
      const rejected = new Map(state.rejected);
      for (const { key, reason } of entries) rejected.set(key, reason);
      return { rejected };
    });
  },

  setConnection(connection: ConnectionStatus): void {
    if (useMarketStore.getState().connection !== connection) useMarketStore.setState({ connection });
  },

  setFeed(feed: FeedStatus | "unknown"): void {
    if (useMarketStore.getState().feed !== feed) useMarketStore.setState({ feed });
  },

  tickClock(now: number): void {
    useMarketStore.setState({ now });
  },

  /** Tests and sign-out. */
  reset(): void {
    useMarketStore.setState(initialState(), true);
  },
};

export function isStale(tick: Tick | undefined, now: number): boolean {
  return tick !== undefined && now - tick.receivedAt > STALE_AFTER_MS;
}
