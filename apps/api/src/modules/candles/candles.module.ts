import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CLOCK, systemClock } from "../../common/clock";
import type { Env } from "../../config/env.schema";
import { FeedSourceReader } from "../../feed/feed-source";
import { FeedStateModule } from "../../feed/feed-state.module";
import { RedisService } from "../../infra/redis/redis.service";
import { BrokerAccessService } from "../brokers/broker-access.service";
import type { ConnectedAccount } from "../brokers/broker-access.service";
import { BrokersModule } from "../brokers/brokers.module";
import { MarketGateways, MarketGatewaysModule } from "../instruments/market-gateways";

import { CandleCoverageStore } from "./candle-coverage";
import type { CoverageRedis } from "./candle-coverage";
import {
  CANDLE_ACCOUNTS,
  CANDLE_SOURCE_RESOLVER,
  DefaultCandleSourceResolver,
  PaperCandleSource,
} from "./candle-sources";
import type { CandleAccount, CandleAccounts } from "./candle-sources";
import { CandlesController } from "./candles.controller";
import { CandlesRepository } from "./candles.repository";
import { CANDLE_COVERAGE, CandlesService } from "./candles.service";

/**
 * The accounts a backfill may use, opened by the broker vault (BrokerAccessService: the user's own account is scoped
 * to the user; the feed account is opened by id) and wired to the market-data gateways (instrument-aware adapters). A
 * paper account has no history of its own, so it counts as none.
 */
export function candleAccounts(
  access: Pick<BrokerAccessService, "defaultAccountRef" | "systemAccountRef">,
  gateways: Pick<MarketGateways, "gateway" | "mapKeys" | "has">,
): CandleAccounts {
  const link = (connected: ConnectedAccount | null): CandleAccount | null => {
    if (connected === null || connected.broker === "PAPER" || !gateways.has(connected.broker)) return null;
    return {
      gateway: gateways.gateway(connected.broker),
      account: connected.ref,
      mapKeys: (keys) => gateways.mapKeys(connected.broker, keys),
    };
  };
  return {
    own: async (userId) => link(await access.defaultAccountRef(userId)),
    feed: async (accountId) => link(await access.systemAccountRef(accountId)),
  };
}

/**
 * `GET /v1/candles`, and CandlesService for the UDF datafeed. Backfills use the user's own account, else the live
 * feed's account; synthetic paper candles are served on the fly while the simulator drives the feed (never in
 * production).
 */
@Module({
  imports: [BrokersModule, MarketGatewaysModule, FeedStateModule],
  controllers: [CandlesController],
  providers: [
    CandlesRepository,
    CandlesService,
    { provide: CLOCK, useValue: systemClock },
    {
      provide: CANDLE_ACCOUNTS,
      inject: [BrokerAccessService, MarketGateways],
      useFactory: candleAccounts,
    },
    {
      provide: PaperCandleSource,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PaperCandleSource(config.get("MARKET_FEED_PAPER_SEED", { infer: true })),
    },
    {
      provide: CANDLE_SOURCE_RESOLVER,
      inject: [ConfigService, CANDLE_ACCOUNTS, PaperCandleSource, FeedSourceReader],
      useFactory: (
        config: ConfigService<Env, true>,
        accounts: CandleAccounts,
        paper: PaperCandleSource,
        feed: FeedSourceReader,
      ) =>
        new DefaultCandleSourceResolver(
          accounts,
          async () => (await feed.current()).source,
          config.get("NODE_ENV", { infer: true }) === "production" ? undefined : paper,
        ),
    },
    {
      provide: CANDLE_COVERAGE,
      inject: [RedisService],
      useFactory: (redis: RedisService) => new CandleCoverageStore(redis.client as unknown as CoverageRedis),
    },
  ],
  exports: [CandlesService],
})
export class CandlesModule {}
