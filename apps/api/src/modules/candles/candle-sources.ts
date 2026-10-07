/**
 * Where missing candles come from (phase 1 plan "Candles"; phase-1b "never serve synthetic candles"):
 *
 * 1. the user's own default ACTIVE broker account, through its market-data gateway;
 * 2. else, while a broker drives the platform feed, that feed account's history: market data only, the account's
 *    credentials stay in the vault and nothing of the account reaches the user (development's `auto` feed runs on a
 *    developer's own account; production names the platform's account);
 * 3. else, while the feed is the simulator (and outside production), deterministic paper candles, generated on the
 *    fly and never stored;
 * 4. else none: Timescale serves what it has.
 *
 * A broker source serves only instruments it has a token for (`supports`); others are served from storage.
 */
import type { BrokerAccountRef, BrokerGateway, Candle } from "@finlytics/broker-sdk";
import type { CandleTimeframe, InstrumentKey } from "@finlytics/shared";

import type { FeedSourceRecord } from "../../feed/feed-source";
import { paperCandles } from "../../feed/paper/paper-candles";

export interface CandleRequest {
  readonly instrumentKey: InstrumentKey;
  readonly timeframe: CandleTimeframe;
  readonly from: Date;
  readonly to: Date;
}

/** Fetches bars for a range, ascending. */
export interface CandleSource {
  /** For logs: `PAPER`, `UPSTOX`, … */
  readonly name: string;
  /** Synthetic bars (the simulator): served on the fly, never stored or recorded as covered. */
  readonly synthetic?: boolean;
  /** Whether the source has `key` at all (a broker needs an instrument token); absent: always. */
  supports?(key: InstrumentKey): Promise<boolean>;
  fetch(request: CandleRequest, signal?: AbortSignal): Promise<Candle[]>;
}

/** Picks the source for a user's request, or none (serve the database only). */
export interface CandleSourceResolver {
  forUser(userId: string): Promise<CandleSource | undefined>;
}

/** DI token for the {@link CandleSourceResolver}. */
export const CANDLE_SOURCE_RESOLVER = Symbol("CANDLE_SOURCE_RESOLVER");

/** DI token for the {@link CandleAccounts}. */
export const CANDLE_ACCOUNTS = Symbol("CANDLE_ACCOUNTS");

/** A broker account a backfill may use: its market-data gateway, its credentials and its instrument lookup. */
export interface CandleAccount {
  readonly gateway: BrokerGateway;
  readonly account: BrokerAccountRef;
  mapKeys(keys: readonly InstrumentKey[]): Promise<Set<InstrumentKey>>;
}

/** The accounts a backfill may use. */
export interface CandleAccounts {
  /** The user's default ACTIVE broker account (never a paper one), or null. */
  own(userId: string): Promise<CandleAccount | null>;
  /** The account driving the live feed, or null when it isn't ACTIVE any more. */
  feed(accountId: string): Promise<CandleAccount | null>;
}

/** No broker integration in this process: nobody has an account. */
export const NO_CANDLE_ACCOUNTS: CandleAccounts = Object.freeze({
  own: () => Promise.resolve(null),
  feed: () => Promise.resolve(null),
});

/** Deterministic paper candles (feed/paper/paper-candles.ts): synthetic, never stored. */
export class PaperCandleSource implements CandleSource {
  readonly name = "PAPER";
  readonly synthetic = true;

  constructor(private readonly seed: number) {}

  fetch(request: CandleRequest): Promise<Candle[]> {
    return Promise.resolve(paperCandles(request, this.seed));
  }
}

/** A broker account's history through its gateway (rate limits, breaker, timeouts, validation). */
export class BrokerCandleSource implements CandleSource {
  readonly name: string;

  constructor(private readonly link: CandleAccount) {
    this.name = link.gateway.broker;
  }

  async supports(key: InstrumentKey): Promise<boolean> {
    return (await this.link.mapKeys([key])).has(key);
  }

  fetch(request: CandleRequest, signal?: AbortSignal): Promise<Candle[]> {
    return this.link.gateway.getHistoricalCandles(this.link.account, request, { signal });
  }
}

/** The order of sources above: own account, the live feed's account, the simulator (when allowed), none. */
export class DefaultCandleSourceResolver implements CandleSourceResolver {
  constructor(
    private readonly accounts: CandleAccounts,
    private readonly feedSource: () => Promise<FeedSourceRecord>,
    private readonly paper: PaperCandleSource | undefined,
  ) {}

  async forUser(userId: string): Promise<CandleSource | undefined> {
    const own = await this.accounts.own(userId);
    if (own !== null) return new BrokerCandleSource(own);
    const feed = await this.feedSource();
    if (!feed.live) return this.paper;
    if (feed.accountId === null) return undefined;
    const shared = await this.accounts.feed(feed.accountId);
    return shared === null ? undefined : new BrokerCandleSource(shared);
  }
}
