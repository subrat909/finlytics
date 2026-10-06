/**
 * Where the shared market feed comes from (phase 1 plan P2): `MARKET_FEED_SOURCE=paper` (the simulator) or `upstox`
 * (Upstox's market WebSocket through BrokerGateway, with the token of the `BrokerAccount` in MARKET_FEED_ACCOUNT_ID).
 *
 * The Upstox path needs the broker vault (stream C1) to decrypt that account's token; it reaches it through the
 * {@link FeedAccountAccess} port, which the feed module binds to C1's service when it exists.
 */
import type { BrokerAccountRef, BrokerGateway, MarketFeed } from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";

import type { MarketFeedSource } from "../config/env.schema";

import { PaperSimulatorFeed } from "./paper/paper-simulator-feed";
import type { PaperSimulatorOptions } from "./paper/paper-simulator-feed";

/** Opens the broker's one market-feed connection. */
export interface FeedConnector {
  readonly broker: BrokerCode;
  connect(signal: AbortSignal): Promise<MarketFeed>;
}

/** DI token for the process's {@link FeedConnector}. */
export const FEED_CONNECTOR = Symbol("FEED_CONNECTOR");

/** DI token for {@link FeedAccountAccess}. */
export const FEED_ACCOUNT_ACCESS = Symbol("FEED_ACCOUNT_ACCESS");

/** The platform feed account: its broker's gateway and its decrypted credentials (never logged). */
export interface FeedAccountAccess {
  open(accountId: string, broker: BrokerCode): Promise<{ gateway: BrokerGateway; account: BrokerAccountRef }>;
}

/** Used until the broker vault is wired: an Upstox feed can't start without it. */
export const UNAVAILABLE_FEED_ACCOUNT_ACCESS: FeedAccountAccess = Object.freeze({
  open: () =>
    Promise.reject(new Error("The broker vault is not available in this process: cannot open the feed account")),
});

/** The broker code each feed source publishes under (`ticks:<BROKER>`, `subs:wanted:<BROKER>`, `lock:feed:<BROKER>`). */
export const FEED_SOURCE_BROKER: Readonly<Record<MarketFeedSource, BrokerCode>> = Object.freeze({
  paper: "PAPER",
  upstox: "UPSTOX",
});

export class PaperFeedConnector implements FeedConnector {
  readonly broker = "PAPER";

  constructor(private readonly options: PaperSimulatorOptions) {}

  connect(): Promise<MarketFeed> {
    return Promise.resolve(new PaperSimulatorFeed(this.options));
  }
}

export class BrokerFeedConnector implements FeedConnector {
  constructor(
    readonly broker: BrokerCode,
    private readonly accountId: string,
    private readonly access: FeedAccountAccess,
  ) {}

  async connect(signal: AbortSignal): Promise<MarketFeed> {
    const { gateway, account } = await this.access.open(this.accountId, this.broker);
    return gateway.connectMarketFeed(account, { signal });
  }
}
