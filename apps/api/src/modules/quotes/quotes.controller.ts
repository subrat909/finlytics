import type { QuotesResult, RtDepth } from "@finlytics/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { QuoteDepthDto, QuoteDepthQueryDto, QuotesQueryDto, QuotesResultDto } from "./dto";
import { QuotesService } from "./quotes.service";

/**
 * `/v1/quotes?keys=a,b` (at most 50 keys): the latest quote of each, from the feed's Redis cache.
 * `/v1/quotes/depth?key=`: the latest market depth of one key (an empty book until the feed has one; 404 for an
 * unknown instrument).
 */
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

  @Get("depth")
  @ZodResponse({
    status: 200,
    description: "The latest book of one instrument, best first; empty (t 0) until the feed has one",
    type: QuoteDepthDto,
  })
  depth(@Query() query: QuoteDepthQueryDto): Promise<RtDepth> {
    return this.quotes.depth(query);
  }
}
