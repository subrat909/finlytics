/**
 * Broker access for market data (phase-1b "Feed source", "Candle backfill"): a thin layer over the shared
 * `BrokerGateways` (one gateway per broker: rate limiter in Redis, circuit breakers, timeouts, output validation; its
 * adapters resolve instruments through the brokers module's maps over `InstrumentBrokerToken`), plus
 * {@link MarketGateways.mapKeys}: which canonical keys a broker can stream or backfill at all (an active token exists;
 * a cached presence check, not an adapter map), so the feed skips keys without a token instead of failing a whole
 * subscribe, and the adapter's own map is ready (`prepare`) before it is asked to name them.
 *
 * `instruments.synced` clears this process's presence cache, so a fresh master is visible at once.
 */
import type { BrokerCode, InstrumentKey } from "@finlytics/shared";
import { Injectable, Module } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";

import { FEED_EVENTS } from "../../feed/feed-events";
import { BrokerGateways, BrokerGatewaysModule } from "../brokers/broker-gateways";

import { InstrumentTokenCache, InstrumentTokensRepository } from "./instrument-tokens";

/** The process's instrument-token cache. */
@Injectable()
export class InstrumentTokens extends InstrumentTokenCache {
  constructor(repository: InstrumentTokensRepository) {
    super(repository, () => Date.now());
  }

  /** A sync changed the tokens: forget what was cached. */
  @OnEvent(FEED_EVENTS.instrumentsSynced)
  onInstrumentsSynced(): void {
    this.clear();
  }
}

@Injectable()
export class MarketGateways {
  constructor(
    private readonly gateways: BrokerGateways,
    readonly tokens: InstrumentTokens,
  ) {}

  /** Whether an adapter is registered for `broker`. */
  has(broker: BrokerCode): boolean {
    return this.gateways.has(broker);
  }

  /** The shared gateway of `broker`. @throws when no adapter is registered (BROKER_UNAVAILABLE). */
  gateway(broker: BrokerCode): ReturnType<BrokerGateways["gateway"]> {
    return this.gateways.gateway(broker);
  }

  /** The keys among `keys` that `broker` can stream or backfill (an active token exists). Paper simulates any key. */
  async mapKeys(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<Set<InstrumentKey>> {
    if (broker === "PAPER") return new Set(keys);
    const [found] = await Promise.all([this.tokens.tokensFor(broker, keys), this.gateways.prepare(broker)]);
    return new Set(found.keys());
  }

  /** Whether `broker` has any synced instrument (the paper broker always has). */
  hasInstruments(broker: BrokerCode): Promise<boolean> {
    return broker === "PAPER" ? Promise.resolve(true) : this.tokens.hasAny(broker);
  }
}

/** {@link MarketGateways} and the instrument-token cache, for the feed and the candle backfill. */
@Module({
  imports: [BrokerGatewaysModule],
  providers: [InstrumentTokensRepository, InstrumentTokens, MarketGateways],
  exports: [MarketGateways, InstrumentTokens],
})
export class MarketGatewaysModule {}
