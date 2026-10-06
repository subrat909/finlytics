import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env.schema";
import { BrokerAccessService } from "../modules/brokers/broker-access.service";
import { BrokersModule } from "../modules/brokers/brokers.module";

import {
  BrokerFeedConnector,
  FEED_ACCOUNT_ACCESS,
  FEED_CONNECTOR,
  FEED_SOURCE_BROKER,
  PaperFeedConnector,
} from "./feed-connector";
import type { FeedAccountAccess, FeedConnector } from "./feed-connector";
import { FeedService } from "./feed.service";

/** The platform feed account (MARKET_FEED_ACCOUNT_ID) through the broker vault (BrokerAccessService, stream C1). */
export function feedAccountAccess(access: Pick<BrokerAccessService, "systemAccountRef">): FeedAccountAccess {
  return {
    async open(accountId, broker) {
      const connected = await access.systemAccountRef(accountId);
      if (connected === null) throw new Error("The feed account is not connected (missing or not ACTIVE)");
      if (connected.broker !== broker) throw new Error(`The feed account is not a ${broker} account`);
      return { gateway: connected.gateway, account: connected.ref };
    },
  };
}

/** The connector for MARKET_FEED_SOURCE. */
export function createFeedConnector(config: ConfigService<Env, true>, access: FeedAccountAccess): FeedConnector {
  const source = config.get("MARKET_FEED_SOURCE", { infer: true });
  if (source === "paper") {
    return new PaperFeedConnector({
      seed: config.get("MARKET_FEED_PAPER_SEED", { infer: true }),
      tickMs: config.get("MARKET_FEED_PAPER_TICK_MS", { infer: true }),
      alwaysOn: config.get("MARKET_FEED_ALWAYS_ON", { infer: true }),
    });
  }
  const accountId = config.get("MARKET_FEED_ACCOUNT_ID", { infer: true });
  // env.schema.ts requires it for an upstox feed; this guards a misconfigured test.
  if (accountId === undefined) throw new Error("MARKET_FEED_ACCOUNT_ID is required for an upstox feed");
  return new BrokerFeedConnector(FEED_SOURCE_BROKER[source], accountId, access);
}

/**
 * The `feed` role (phase 1 plan P2): the shared market feed's leader election, connection, subscription reconciliation
 * and Redis writes. FEED_ACCOUNT_ACCESS opens the platform feed account through the broker vault (an Upstox feed).
 */
@Module({
  imports: [BrokersModule],
  providers: [
    { provide: FEED_ACCOUNT_ACCESS, inject: [BrokerAccessService], useFactory: feedAccountAccess },
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
