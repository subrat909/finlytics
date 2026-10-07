import { Module } from "@nestjs/common";

import { QuotesController } from "./quotes.controller";
import { QuotesRepository } from "./quotes.repository";
import { QuotesService } from "./quotes.service";

/** `/v1/quotes` and `/v1/quotes/depth`, from the global RedisModule's client (and PrismaModule for instrument checks). */
@Module({
  controllers: [QuotesController],
  providers: [QuotesRepository, QuotesService],
})
export class QuotesModule {}
