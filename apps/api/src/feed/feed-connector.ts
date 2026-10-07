/**
 * Opening the shared market feed for a {@link FeedTarget} (phase 1 plan P2; phase-1b "Feed source"): the paper
 * simulator, or one broker account's market WebSocket through its market-data gateway.
 *
 * The broker path needs the vault to decrypt the account's token; it reaches it through the {@link FeedAccountAccess}
 * port, which the feed module binds to the broker vault (BrokerAccessService) and the market-data gateways.
 */
import type { BrokerAccountRef, BrokerGateway, FeedLimits, MarketFeed } from "@finlytics/broker-sdk";
import type { BrokerCode, InstrumentKey } from "@finlytics/shared";

import type { FeedTarget } from "./feed-source";
import { PaperSimulatorFeed } from "./paper/paper-simulator-feed";
import type { PaperSimulatorOptions } from "./paper/paper-simulator-feed";

/** An open feed, with what the engine needs to know about its broker. */
export interface FeedConnection {
  readonly target: FeedTarget;
  readonly feed: MarketFeed;
  /** The most instruments the connection carries. */
  readonly capacity: number;
  /** Per-mode limits within the capacity (absent: any mode up to the capacity). */
  readonly limits?: FeedLimits | undefined;
  /** The keys among `keys` this broker can stream (an instrument token exists), ready for `subscribe`. */
  mapKeys(keys: readonly InstrumentKey[]): Promise<Set<InstrumentKey>>;
}

/**
 * How many of `count` keys go in `full` mode (OHLC, ATP, depth) and how many in `ltp`: all `full` while the broker
 * allows that many in `full` alone; beyond, its mixed `full` cap plus `ltp` up to the mixed `ltp` cap (Upstox: 2000
 * `full` alone, else 1500 `full` + 2000 `ltp`). Keys beyond both are not streamed.
 */
export function planModes(
  count: number,
  capacity: number,
  limits: FeedLimits | undefined,
): { readonly full: number; readonly ltp: number } {
  const total = Math.min(count, capacity);
  if (limits === undefined || total <= limits.single.full) return { full: total, ltp: 0 };
  const full = Math.min(limits.mixed.full, total);
  return { full, ltp: Math.max(0, Math.min(total - full, limits.mixed.ltp)) };
}

/** Opens the feed of a target. */
export interface FeedConnector {
  connect(target: FeedTarget, signal: AbortSignal): Promise<FeedConnection>;
}

/** DI token for the process's {@link FeedConnector}. */
export const FEED_CONNECTOR = Symbol("FEED_CONNECTOR");

/** DI token for {@link FeedAccountAccess}. */
export const FEED_ACCOUNT_ACCESS = Symbol("FEED_ACCOUNT_ACCESS");

/** A feed account: its broker's market-data gateway and its decrypted credentials (never logged). */
export interface FeedAccountAccess {
  open(accountId: string, broker: BrokerCode): Promise<{ gateway: BrokerGateway; account: BrokerAccountRef }>;
  /** The keys among `keys` `broker` has instrument tokens for (and loads what its adapter needs). */
  mapKeys(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<Set<InstrumentKey>>;
  /** The broker refused the account's token: flag it NEEDS_RELOGIN (best effort, audited by the vault side). */
  markNeedsRelogin(accountId: string): Promise<void>;
}

/** Used until the broker vault is wired: a broker feed can't start without it. */
export const UNAVAILABLE_FEED_ACCOUNT_ACCESS: FeedAccountAccess = Object.freeze({
  open: () =>
    Promise.reject(new Error("The broker vault is not available in this process: cannot open the feed account")),
  mapKeys: () => Promise.resolve(new Set<InstrumentKey>()),
  markNeedsRelogin: () => Promise.resolve(),
});

/** Paper: the simulator, which streams any valid key. */
export function paperConnection(options: PaperSimulatorOptions): FeedConnection {
  const feed = new PaperSimulatorFeed(options);
  return {
    target: { broker: "PAPER" },
    feed,
    capacity: options.capacity ?? 5_000,
    mapKeys: (keys) => Promise.resolve(new Set(keys)),
  };
}

/** The connector for every target: the simulator for PAPER, the account's broker feed otherwise. */
export class DefaultFeedConnector implements FeedConnector {
  constructor(
    private readonly paper: PaperSimulatorOptions,
    private readonly access: FeedAccountAccess,
  ) {}

  async connect(target: FeedTarget, signal: AbortSignal): Promise<FeedConnection> {
    if (target.broker === "PAPER") return paperConnection(this.paper);
    const { gateway, account } = await this.access.open(target.accountId, target.broker);
    const feed = await gateway.connectMarketFeed(account, { signal });
    return {
      target,
      feed,
      capacity: gateway.capabilities.maxFeedInstruments,
      limits: gateway.capabilities.feedLimits,
      mapKeys: (keys) => this.access.mapKeys(target.broker, keys),
    };
  }
}
