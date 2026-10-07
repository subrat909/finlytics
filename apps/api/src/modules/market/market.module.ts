import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";
import { FeedStateModule } from "../../feed/feed-state.module";

import { MarketController } from "./market.controller";
import { MarketRepository } from "./market.repository";
import { MarketService } from "./market.service";

/** `GET /v1/market/overview` (phase-1b "Market overview"), from Redis (`quote:*`, `feed:*`) and `MarketHoliday`. */
@Module({
  imports: [FeedStateModule],
  controllers: [MarketController],
  providers: [MarketRepository, MarketService, { provide: CLOCK, useValue: systemClock }],
})
export class MarketModule {}
