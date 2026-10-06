/**
 * Market and order feed contracts (operation 12, plan B12). One connection of each per broker, shared by every user:
 * the gateway hands out the same feed object to every caller. Reference counting of instruments belongs to the api
 * (1.4, Redis `subs:<instrumentKey>`); a feed only knows its current key set, which it re-subscribes by itself after a
 * reconnect.
 */
import type { InstrumentKey } from "@finlytics/shared";

import type { FeedMode, OrderUpdate, Tick, TradeUpdate } from "../models";

import type { Unsubscribe } from "./emitter";

/**
 * - `connecting`: first connect or reconnecting with backoff
 * - `up`: connected and subscribed
 * - `degraded`: connected but late (missed heartbeats, partial resubscribe)
 * - `down`: disconnected, retrying
 * - `closed`: `close()` was called; terminal
 */
export type FeedStatus = "connecting" | "up" | "degraded" | "down" | "closed";

export interface MarketFeedEvents {
  tick: Tick;
  status: FeedStatus;
  /** Parse errors, listener errors and connection errors. Never fatal on their own: watch `status`. */
  error: unknown;
}

export interface OrderFeedEvents {
  order: OrderUpdate;
  trade: TradeUpdate;
  status: FeedStatus;
  error: unknown;
}

export interface MarketFeed {
  readonly status: FeedStatus;
  /**
   * Adds keys (or changes their mode). Resolves when the broker has the request; ticks follow as events.
   *
   * @throws {BrokerRejectedError} when the set would exceed the broker's `maxFeedInstruments`.
   */
  subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void>;
  /** Removes keys. Unknown keys are ignored. */
  unsubscribe(keys: readonly InstrumentKey[]): Promise<void>;
  /** The current key set and modes: what a reconnect re-subscribes. */
  subscriptions(): ReadonlyMap<InstrumentKey, FeedMode>;
  on<E extends keyof MarketFeedEvents>(event: E, listener: (payload: MarketFeedEvents[E]) => void): Unsubscribe;
  /** Closes the connection for good; `status` becomes `closed`. Idempotent. */
  close(): Promise<void>;
}

export interface OrderFeed {
  readonly status: FeedStatus;
  on<E extends keyof OrderFeedEvents>(event: E, listener: (payload: OrderFeedEvents[E]) => void): Unsubscribe;
  /** Closes the connection for good; `status` becomes `closed`. Idempotent. */
  close(): Promise<void>;
}
