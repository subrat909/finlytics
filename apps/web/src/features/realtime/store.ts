/**
 * `useMarketStore` (frontend.md "State"): the live ticks and market depth in Maps, the socket and feed status, the
 * feed's source, the keys the server refused and a one-second clock for staleness. Components read one value through
 * a selector (`useTick`, `useIsStale`, `useDepth`), so a tick re-renders only the cells of its own instrument. Writes
 * come from the RealtimeClient in batches (at most ten a second) and from REST seeds.
 */
import { create } from "zustand";

import { mergeTick } from "./schemas";
import type { Depth, FeedSource, FeedStatus, Tick } from "./schemas";

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
  /** Which broker drives the prices and whether they are live; undefined until the server says. */
  source: FeedSource | undefined;
  /** Keys the server refused, with its reason (a plan's `maxRtSubscriptions`, an unknown key). */
  rejected: ReadonlyMap<string, string>;
  /** Market depth for the keys something shows (at most `RT_MAX_DEPTH_KEYS` stream at once). */
  depth: ReadonlyMap<string, Depth>;
  /** Keys whose depth stream the server refused, with its reason. */
  depthRejected: ReadonlyMap<string, string>;
  /** Epoch ms, advanced every second while anything is subscribed; staleness compares against it. */
  now: number;
}

const EMPTY_TICKS: ReadonlyMap<string, Tick> = new Map();
const EMPTY_REJECTED: ReadonlyMap<string, string> = new Map();
const EMPTY_DEPTH: ReadonlyMap<string, Depth> = new Map();

function initialState(): MarketState {
  return {
    ticks: EMPTY_TICKS,
    connection: "idle",
    feed: "unknown",
    source: undefined,
    rejected: EMPTY_REJECTED,
    depth: EMPTY_DEPTH,
    depthRejected: EMPTY_REJECTED,
    now: Date.now(),
  };
}

export const useMarketStore = create<MarketState>()(() => initialState());

function withTicks(current: ReadonlyMap<string, Tick>, batch: ReadonlyMap<string, Tick>): Map<string, Tick> {
  const ticks = new Map(current);
  for (const [key, tick] of batch) ticks.set(key, mergeTick(tick, current.get(key)));
  return ticks;
}

function withDepth(current: ReadonlyMap<string, Depth>, batch: ReadonlyMap<string, Depth>): Map<string, Depth> {
  const depth = new Map(current);
  for (const [key, book] of batch) depth.set(key, book);
  return depth;
}

/** Writes, for the RealtimeClient and the REST seeds (no React needed). */
export const marketActions = {
  /** Applies a batch: one new Map per batch, unchanged ticks keep their identity (their cells don't re-render). */
  applyTicks(batch: ReadonlyMap<string, Tick>): void {
    if (batch.size === 0) return;
    useMarketStore.setState((state) => ({ ticks: withTicks(state.ticks, batch) }));
  },

  /** Ticks and depth from one flush, in one store update (one render). */
  applyBatch(ticks: ReadonlyMap<string, Tick>, depth: ReadonlyMap<string, Depth>): void {
    if (ticks.size === 0 && depth.size === 0) return;
    useMarketStore.setState((state) => ({
      ...(ticks.size === 0 ? {} : { ticks: withTicks(state.ticks, ticks) }),
      ...(depth.size === 0 ? {} : { depth: withDepth(state.depth, depth) }),
    }));
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
        ticks.set(key, mergeTick(seed, current));
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

  /** Depth from one stream message batch (the client) or a test. */
  applyDepth(batch: ReadonlyMap<string, Depth>): void {
    if (batch.size === 0) return;
    useMarketStore.setState((state) => ({ depth: withDepth(state.depth, batch) }));
  },

  /** A REST depth snapshot; never overwrites a book that is at least as new. */
  seedDepth(key: string, depth: Depth): void {
    const current = useMarketStore.getState().depth.get(key);
    if (current !== undefined && current.t >= depth.t) return;
    useMarketStore.setState((state) => ({ depth: withDepth(state.depth, new Map([[key, depth]])) }));
  },

  /** Drops the depth (and depth refusals) of every key not in `keep`. */
  forgetDepthExcept(keep: { has(key: string): boolean }): void {
    useMarketStore.setState((state) => {
      const stale = [...state.depth.keys(), ...state.depthRejected.keys()].filter((key) => !keep.has(key));
      if (stale.length === 0) return state;
      const depth = new Map(state.depth);
      const depthRejected = new Map(state.depthRejected);
      for (const key of stale) {
        depth.delete(key);
        depthRejected.delete(key);
      }
      return { depth, depthRejected };
    });
  },

  /** Records (or, with undefined, clears) why the server refused `key`'s depth stream. */
  setDepthRejected(key: string, reason: string | undefined): void {
    const current = useMarketStore.getState().depthRejected.get(key);
    if (current === reason) return;
    useMarketStore.setState((state) => {
      const depthRejected = new Map(state.depthRejected);
      if (reason === undefined) depthRejected.delete(key);
      else depthRejected.set(key, reason);
      return { depthRejected };
    });
  },

  /** Every depth refusal is void after a reconnect: the client asks again. */
  clearDepthRejected(): void {
    if (useMarketStore.getState().depthRejected.size > 0) useMarketStore.setState({ depthRejected: EMPTY_REJECTED });
  },

  setConnection(connection: ConnectionStatus): void {
    if (useMarketStore.getState().connection !== connection) useMarketStore.setState({ connection });
  },

  setFeed(feed: FeedStatus | "unknown"): void {
    if (useMarketStore.getState().feed !== feed) useMarketStore.setState({ feed });
  },

  /** Keeps the object's identity while nothing changes, so `useFeedSource()` re-renders only on a real change. */
  setSource(source: FeedSource | undefined): void {
    const current = useMarketStore.getState().source;
    if (current?.source === source?.source && current?.live === source?.live) return;
    useMarketStore.setState({ source: source === undefined ? undefined : { ...source } });
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
