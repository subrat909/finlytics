/**
 * Where missing candles come from (phase 1 plan "Candles"): the user's default ACTIVE broker account through
 * `BrokerGateway.getHistoricalCandles`, or the paper source. Paper candles are synthetic, so they are only used (and
 * stored) while the whole platform runs on the paper feed (MARKET_FEED_SOURCE=paper); otherwise a user without a
 * broker account is served what Timescale already has.
 */
import type { BrokerAccountRef, BrokerGateway, Candle } from "@finlytics/broker-sdk";
import type { CandleTimeframe, InstrumentKey } from "@finlytics/shared";

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
  fetch(request: CandleRequest, signal?: AbortSignal): Promise<Candle[]>;
}

/** Picks the source for a user's request, or none (serve the database only). */
export interface CandleSourceResolver {
  forUser(userId: string): Promise<CandleSource | undefined>;
}

/** DI token for the {@link CandleSourceResolver}. */
export const CANDLE_SOURCE_RESOLVER = Symbol("CANDLE_SOURCE_RESOLVER");

/** DI token for a function returning the user's default ACTIVE broker account (gateway + credentials), or null. */
export const DEFAULT_BROKER_ACCOUNT = Symbol("DEFAULT_BROKER_ACCOUNT");

export type DefaultBrokerAccountLookup = (
  userId: string,
) => Promise<{ readonly gateway: BrokerGateway; readonly account: BrokerAccountRef } | null>;

/** No broker integration in this process: nobody has a default account. */
export const NO_DEFAULT_BROKER_ACCOUNT: DefaultBrokerAccountLookup = () => Promise.resolve(null);

/** Deterministic paper candles (feed/paper/paper-candles.ts). */
export class PaperCandleSource implements CandleSource {
  readonly name = "PAPER";

  constructor(private readonly seed: number) {}

  fetch(request: CandleRequest): Promise<Candle[]> {
    return Promise.resolve(paperCandles(request, this.seed));
  }
}

/** A broker account's history through its gateway (rate limits, breaker, timeouts, validation). */
export class BrokerCandleSource implements CandleSource {
  readonly name: string;

  constructor(
    private readonly gateway: BrokerGateway,
    private readonly account: BrokerAccountRef,
  ) {
    this.name = gateway.broker;
  }

  fetch(request: CandleRequest, signal?: AbortSignal): Promise<Candle[]> {
    return this.gateway.getHistoricalCandles(this.account, request, { signal });
  }
}

/** The user's default active account, else the paper source when the platform runs on paper, else none. */
export class DefaultCandleSourceResolver implements CandleSourceResolver {
  constructor(
    private readonly defaultAccount: DefaultBrokerAccountLookup,
    private readonly paper: PaperCandleSource | undefined,
  ) {}

  async forUser(userId: string): Promise<CandleSource | undefined> {
    const found = await this.defaultAccount(userId);
    if (found !== null) return new BrokerCandleSource(found.gateway, found.account);
    return this.paper;
  }
}
