import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";
import { BrokersModule } from "../brokers/brokers.module";

import { PortfolioController } from "./portfolio.controller";
import { PortfolioRepository } from "./portfolio.repository";
import { PortfolioService } from "./portfolio.service";

/**
 * `/v1/portfolio`: funds, positions and holdings through BrokerAccessService (BrokersModule: the vault and the
 * gateways with their instrument maps), with the global PrismaModule and RedisModule.
 */
@Module({
  imports: [BrokersModule],
  controllers: [PortfolioController],
  providers: [PortfolioRepository, PortfolioService, { provide: CLOCK, useValue: systemClock }],
})
export class PortfolioModule {}
