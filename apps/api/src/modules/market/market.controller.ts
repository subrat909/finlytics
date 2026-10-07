import type { MarketOverview } from "@finlytics/shared";
import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { MarketOverviewDto } from "./dto";
import { MarketService } from "./market.service";

/** `/v1/market/overview`: sessions, the feed's source and state, indices and NIFTY 50 movers (cached ≤ 1 s). */
@ApiTags("market")
@Controller("v1/market")
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get("overview")
  @ZodResponse({
    status: 200,
    description: "Exchange sessions (IST), the market feed, indices and NIFTY 50 gainers, losers, most active, breadth",
    type: MarketOverviewDto,
  })
  overview(): Promise<MarketOverview> {
    return this.market.overview();
  }
}
