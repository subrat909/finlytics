import type { UdfConfig, UdfHistory, UdfSearchResult, UdfSymbolInfo } from "@finlytics/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import type { AuthIdentity } from "../auth/auth-identity";

import {
  UdfConfigDto,
  UdfHistoryDto,
  UdfHistoryQueryDto,
  UdfSearchQueryDto,
  UdfSearchResultDto,
  UdfSymbolInfoDto,
  UdfSymbolQueryDto,
} from "./dto";
import { UdfService } from "./udf.service";

/** `/v1/udf/*`: the TradingView UDF datafeed (session auth, like every `/v1` route). */
@ApiTags("udf")
@Controller("v1/udf")
export class UdfController {
  constructor(private readonly udf: UdfService) {}

  @Get("config")
  @ZodResponse({ status: 200, description: "Datafeed configuration", type: UdfConfigDto })
  config(): UdfConfig {
    return this.udf.config();
  }

  /** Server time in epoch seconds, as a bare number. */
  @Get("time")
  time(): number {
    return this.udf.time();
  }

  @Get("symbols")
  @ZodResponse({ status: 200, description: "Symbol info for a canonical instrument key", type: UdfSymbolInfoDto })
  symbols(@Query() query: UdfSymbolQueryDto): Promise<UdfSymbolInfo> {
    return this.udf.symbol(query.symbol);
  }

  @Get("search")
  @ZodResponse({ status: 200, description: "Matching symbols", type: UdfSearchResultDto })
  search(@Query() query: UdfSearchQueryDto): Promise<UdfSearchResult> {
    return this.udf.search(query);
  }

  @Get("history")
  @ZodResponse({ status: 200, description: "Bars as UDF parallel arrays, or no_data", type: UdfHistoryDto })
  history(@CurrentUser() identity: AuthIdentity, @Query() query: UdfHistoryQueryDto): Promise<UdfHistory> {
    return this.udf.history(identity.userId, query);
  }
}
