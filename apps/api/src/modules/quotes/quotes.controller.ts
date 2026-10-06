import type { QuotesResult } from "@finlytics/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { QuotesQueryDto, QuotesResultDto } from "./dto";
import { QuotesService } from "./quotes.service";

/** `/v1/quotes?keys=a,b` (at most 50 keys): the latest quote of each, from the feed's Redis cache. */
@ApiTags("quotes")
@Controller("v1/quotes")
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ZodResponse({
    status: 200,
    description: "Quotes by instrument key; keys without a quote are left out",
    type: QuotesResultDto,
  })
  get(@Query() query: QuotesQueryDto): Promise<QuotesResult> {
    return this.quotes.get(query);
  }
}
