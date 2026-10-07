import type { CandleBar } from "@finlytics/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import type { AuthIdentity } from "../auth/auth-identity";

import { CandleListDto, CandlesQueryDto } from "./dto";
import { CandlesService } from "./candles.service";

/** `/v1/candles` (phase 1 plan "REST"): OHLCV bars from Timescale, backfilled once per range. */
@ApiTags("candles")
@Controller("v1/candles")
export class CandlesController {
  constructor(private readonly candles: CandlesService) {}

  @Get()
  @ZodResponse({ status: 200, description: "Complete bars in [from, to), ascending", type: CandleListDto })
  list(@CurrentUser() identity: AuthIdentity, @Query() query: CandlesQueryDto): Promise<CandleBar[]> {
    return this.candles.list(identity.userId, query);
  }
}
