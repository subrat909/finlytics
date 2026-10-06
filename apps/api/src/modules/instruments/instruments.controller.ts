import type { Instrument, InstrumentSyncResult } from "@finlytics/shared";
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import { RequestMeta } from "../../common/decorators/request-meta";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import type { AuthIdentity } from "../auth/auth-identity";

import {
  InstrumentDto,
  InstrumentKeyParamsDto,
  InstrumentListDto,
  InstrumentSearchQueryDto,
  InstrumentSyncRequestDto,
  InstrumentSyncResultDto,
} from "./dto";
import { InstrumentsService } from "./instruments.service";

/** `/v1/instruments`: search (trigram with a prefix boost) and lookup, from our own instrument table. */
@ApiTags("instruments")
@Controller("v1/instruments")
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get()
  @ZodResponse({ status: 200, description: "Active instruments matching q, best first", type: InstrumentListDto })
  search(@Query() query: InstrumentSearchQueryDto): Promise<Instrument[]> {
    return this.instruments.search(query);
  }

  @Get(":key")
  @ZodResponse({ status: 200, description: "One instrument by its URL-encoded canonical key", type: InstrumentDto })
  get(@Param() params: InstrumentKeyParamsDto): Promise<Instrument> {
    return this.instruments.get(params.key);
  }
}

/** `/v1/admin/instruments`: admin operations on the instrument master. */
@ApiTags("admin")
@Controller("v1/admin/instruments")
export class InstrumentsAdminController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Post("sync")
  @HttpCode(202)
  @ZodResponse({ status: 202, description: "The queued sync jobs", type: InstrumentSyncResultDto })
  sync(
    @CurrentUser() identity: AuthIdentity,
    @Body() body: InstrumentSyncRequestDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<InstrumentSyncResult> {
    return this.instruments.requestSync(identity, body, request);
  }
}
