import type { InstrumentKey } from "@finlytics/shared";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env.schema";
import { BrokerAccessService } from "../modules/brokers/broker-access.service";
import { BrokersModule } from "../modules/brokers/brokers.module";
import { MarketGateways, MarketGatewaysModule } from "../modules/instruments/market-gateways";

import { DefaultFeedConnector, FEED_ACCOUNT_ACCESS, FEED_CONNECTOR } from "./feed-connector";
import type { FeedAccountAccess, FeedConnector } from "./feed-connector";
import { FeedAccountsRepository } from "./feed-accounts.repository";
import { FeedSourceSelector } from "./feed-selector";
import type { FeedAccountDirectory } from "./feed-selector";
import { FEED_SELECTION, FeedService } from "./feed.service";

/**
 * A feed account through the broker vault (BrokerAccessService) and the market-data gateways (instrument-aware
 * adapters). Remembers each opened account's owner, to flag it NEEDS_RELOGIN when the broker refuses its token.
 */
export function feedAccountAccess(
  access: Pick<BrokerAccessService, "systemAccountRef" | "markNeedsRelogin">,
  gateways: Pick<MarketGateways, "gateway" | "mapKeys">,
): FeedAccountAccess {
  const owners = new Map<string, string>();
  return {
    async open(accountId, broker) {
      const connected = await access.systemAccountRef(accountId);
      if (connected === null) throw new Error("The feed account is not connected (missing or not ACTIVE)");
      if (connected.broker !== broker) throw new Error(`The feed account is not a ${broker} account`);
      owners.set(accountId, connected.userId);
      return { gateway: gateways.gateway(broker), account: connected.ref };
    },
    mapKeys: (broker, keys: readonly InstrumentKey[]) => gateways.mapKeys(broker, keys),
    async markNeedsRelogin(accountId) {
      const userId = owners.get(accountId);
      if (userId !== undefined) await access.markNeedsRelogin(userId, accountId);
    },
  };
}

/** The connector for every source: the simulator (MARKET_FEED_PAPER_*) or a broker account's feed. */
export function createFeedConnector(config: ConfigService<Env, true>, access: FeedAccountAccess): FeedConnector {
  return new DefaultFeedConnector(
    {
      seed: config.get("MARKET_FEED_PAPER_SEED", { infer: true }),
      tickMs: config.get("MARKET_FEED_PAPER_TICK_MS", { infer: true }),
      alwaysOn: config.get("MARKET_FEED_ALWAYS_ON", { infer: true }),
    },
    access,
  );
}

/** The source selection for MARKET_FEED_SOURCE (and MARKET_FEED_ACCOUNT_ID). */
export function createFeedSelector(
  config: ConfigService<Env, true>,
  directory: FeedAccountDirectory,
): FeedSourceSelector {
  return new FeedSourceSelector(
    config.get("MARKET_FEED_SOURCE", { infer: true }),
    config.get("MARKET_FEED_ACCOUNT_ID", { infer: true }),
    directory,
  );
}

/**
 * The `feed` role (phase 1 plan P2; phase-1b "Feed source"): the shared market feed's leader election, source
 * selection, connection, subscription reconciliation and Redis writes. FEED_ACCOUNT_ACCESS opens broker accounts
 * through the vault; MarketGatewaysModule gives adapters that resolve instruments from our token table.
 */
@Module({
  imports: [BrokersModule, MarketGatewaysModule],
  providers: [
    FeedAccountsRepository,
    {
      provide: FEED_ACCOUNT_ACCESS,
      inject: [BrokerAccessService, MarketGateways],
      useFactory: feedAccountAccess,
    },
    {
      provide: FEED_SELECTION,
      inject: [ConfigService, FeedAccountsRepository],
      useFactory: createFeedSelector,
    },
    {
      provide: FEED_CONNECTOR,
      inject: [ConfigService, FEED_ACCOUNT_ACCESS],
      useFactory: createFeedConnector,
    },
    FeedService,
  ],
  exports: [FeedService],
})
export class FeedModule {}
