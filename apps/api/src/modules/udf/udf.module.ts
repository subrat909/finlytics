import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";
import { CandlesModule } from "../candles/candles.module";

import { UdfController } from "./udf.controller";
import { UdfRepository } from "./udf.repository";
import { UdfService } from "./udf.service";

/** `/v1/udf/*`: the TradingView UDF datafeed over CandlesService and the instrument master. */
@Module({
  imports: [CandlesModule],
  controllers: [UdfController],
  providers: [UdfRepository, UdfService, { provide: CLOCK, useValue: systemClock }],
})
export class UdfModule {}
