import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CLOCK, systemClock } from "../../common/clock";
import type { Env } from "../../config/env.schema";
import { RedisService } from "../../infra/redis/redis.service";
import { BrokerAccessService } from "../brokers/broker-access.service";
import { BrokersModule } from "../brokers/brokers.module";

import { CandleCoverageStore } from "./candle-coverage";
import type { CoverageRedis } from "./candle-coverage";
import {
  CANDLE_SOURCE_RESOLVER,
  DEFAULT_BROKER_ACCOUNT,
  DefaultCandleSourceResolver,
  PaperCandleSource,
} from "./candle-sources";
import type { DefaultBrokerAccountLookup } from "./candle-sources";
import { CandlesController } from "./candles.controller";
import { CandlesRepository } from "./candles.repository";
import { CANDLE_COVERAGE, CandlesService } from "./candles.service";

/**
 * `GET /v1/candles`, and CandlesService for the UDF datafeed. DEFAULT_BROKER_ACCOUNT looks up the user's default
 * ACTIVE broker account for backfills; the paper source is used only while MARKET_FEED_SOURCE is paper.
 */
/**
 * The user's default ACTIVE broker account (BrokerAccessService, stream C1). A PAPER account has no history of its
 * own, so it counts as none: the paper source then serves, when the platform runs on paper.
 */
export function defaultBrokerAccount(
  access: Pick<BrokerAccessService, "defaultAccountRef">,
): DefaultBrokerAccountLookup {
  return async (userId) => {
    const connected = await access.defaultAccountRef(userId);
    if (connected === null || connected.broker === "PAPER") return null;
    return { gateway: connected.gateway, account: connected.ref };
  };
}

@Module({
  imports: [BrokersModule],
  controllers: [CandlesController],
  providers: [
    CandlesRepository,
    CandlesService,
    { provide: CLOCK, useValue: systemClock },
    {
      provide: DEFAULT_BROKER_ACCOUNT,
      inject: [BrokerAccessService],
      useFactory: (access: BrokerAccessService): DefaultBrokerAccountLookup => defaultBrokerAccount(access),
    },
    {
      provide: PaperCandleSource,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PaperCandleSource(config.get("MARKET_FEED_PAPER_SEED", { infer: true })),
    },
    {
      provide: CANDLE_SOURCE_RESOLVER,
      inject: [ConfigService, DEFAULT_BROKER_ACCOUNT, PaperCandleSource],
      useFactory: (config: ConfigService<Env, true>, lookup: DefaultBrokerAccountLookup, paper: PaperCandleSource) =>
        new DefaultCandleSourceResolver(
          lookup,
          config.get("MARKET_FEED_SOURCE", { infer: true }) === "paper" ? paper : undefined,
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
