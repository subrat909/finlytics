import { Module } from "@nestjs/common";

import { QuotesController } from "./quotes.controller";
import { QuotesRepository } from "./quotes.repository";
import { QuotesService } from "./quotes.service";

/** `/v1/quotes`, from the global RedisModule's client. */
@Module({
  controllers: [QuotesController],
  providers: [QuotesRepository, QuotesService],
})
export class QuotesModule {}
