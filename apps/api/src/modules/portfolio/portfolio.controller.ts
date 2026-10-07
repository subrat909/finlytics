import type { FundsView, HoldingsView, PositionsView } from "@finlytics/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import type { AuthIdentity } from "../auth/auth-identity";

import { FundsViewDto, HoldingsViewDto, PortfolioQueryDto, PositionsViewDto } from "./dto";
import { PortfolioService } from "./portfolio.service";

/**
 * `/v1/portfolio` (plan phase-1b): funds, positions and holdings of one broker account (`?accountId=`, else the
 * default ACTIVE one), cached 5 s. No account: 404 NOT_FOUND; the broker session ended: 409 NEEDS_RELOGIN; the broker
 * is down: 503 BROKER_UNAVAILABLE.
 */
@ApiTags("portfolio")
@Controller("v1/portfolio")
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get("funds")
  @ZodResponse({ status: 200, description: "The account's funds and margins", type: FundsViewDto })
  funds(@CurrentUser() identity: AuthIdentity, @Query() query: PortfolioQueryDto): Promise<FundsView> {
    return this.portfolio.funds(identity.userId, query);
  }

  @Get("positions")
  @ZodResponse({ status: 200, description: "Today's net positions, open first", type: PositionsViewDto })
  positions(@CurrentUser() identity: AuthIdentity, @Query() query: PortfolioQueryDto): Promise<PositionsView> {
    return this.portfolio.positions(identity.userId, query);
  }

  @Get("holdings")
  @ZodResponse({ status: 200, description: "Delivery holdings, largest value first", type: HoldingsViewDto })
  holdings(@CurrentUser() identity: AuthIdentity, @Query() query: PortfolioQueryDto): Promise<HoldingsView> {
    return this.portfolio.holdings(identity.userId, query);
  }
}
