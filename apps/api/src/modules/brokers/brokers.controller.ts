import type { BrokerAccountView, BrokerAuthRedirect, BrokerLimits } from "@finlytics/shared";
import { SESSION_COOKIE_NAME, SESSION_TOKEN_PATTERN } from "@finlytics/shared";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Redirect, Req } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import { Public } from "../../common/decorators/public";
import { RequestMeta } from "../../common/decorators/request-meta";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import type { Env } from "../../config/env.schema";
import type { AuthIdentity } from "../auth/auth-identity";
import { SessionService } from "../auth/session.service";

import type { CallbackOutcome } from "./brokers.service";
import { BrokersService } from "./brokers.service";
import {
  BrokerAccountListDto,
  BrokerAccountParamsDto,
  BrokerAccountViewDto,
  BrokerAuthRedirectDto,
  BrokerLimitsDto,
  ConnectDhanDto,
  ConnectPaperDto,
  ConnectUpstoxDto,
  UpdateBrokerAccountDto,
  UpstoxCallbackRawQueryDto,
} from "./dto";

/**
 * `/v1/brokers` (plan "REST"): the user's broker accounts. Responses never include credentials, tokens or the broker
 * client id. Every write is audited. The Upstox callback is `@Public()` (the browser arrives from Upstox) and checks
 * the signed state against the session cookie itself; it always answers with a redirect.
 */
@ApiTags("brokers")
@Controller("v1/brokers")
export class BrokersController {
  private readonly cookieName: string;

  constructor(
    private readonly brokers: BrokersService,
    private readonly sessions: SessionService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieName = SESSION_COOKIE_NAME[config.get("NODE_ENV", { infer: true })];
  }

  @Get()
  @ZodResponse({ status: 200, description: "The user's broker accounts, oldest first", type: BrokerAccountListDto })
  list(@CurrentUser() identity: AuthIdentity): Promise<BrokerAccountView[]> {
    return this.brokers.list(identity.userId);
  }

  @Get("limits")
  @ZodResponse({
    status: 200,
    description: "The plan's broker and paper account limits, and how many the user has",
    type: BrokerLimitsDto,
  })
  limits(@CurrentUser() identity: AuthIdentity): Promise<BrokerLimits> {
    return this.brokers.limits(identity.userId);
  }

  @Post("upstox")
  @ZodResponse({ status: 201, description: "A PENDING account and the Upstox login URL", type: BrokerAuthRedirectDto })
  connectUpstox(
    @CurrentUser() identity: AuthIdentity,
    @Body() body: ConnectUpstoxDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<BrokerAuthRedirect> {
    return this.brokers.connectUpstox(identity, body, request);
  }

  @Get("upstox/callback")
  @Public()
  @Redirect(undefined, 302)
  async upstoxCallback(
    @Query() query: UpstoxCallbackRawQueryDto,
    @Req() request: FastifyRequest,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<CallbackOutcome> {
    const token = request.cookies[this.cookieName];
    const identity =
      token !== undefined && SESSION_TOKEN_PATTERN.test(token) ? await this.sessions.resolve(token) : null;
    return this.brokers.upstoxCallback(query, identity, meta);
  }

  @Post("dhan")
  @ZodResponse({ status: 201, description: "The connected Dhan account", type: BrokerAccountViewDto })
  connectDhan(
    @CurrentUser() identity: AuthIdentity,
    @Body() body: ConnectDhanDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<BrokerAccountView> {
    return this.brokers.connectDhan(identity.userId, body, request);
  }

  @Post("paper")
  @ZodResponse({ status: 201, description: "The connected paper account", type: BrokerAccountViewDto })
  connectPaper(
    @CurrentUser() identity: AuthIdentity,
    @Body() body: ConnectPaperDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<BrokerAccountView> {
    return this.brokers.connectPaper(identity.userId, body, request);
  }

  @Post(":id/relogin")
  @HttpCode(200)
  @ZodResponse({ status: 200, description: "A fresh Upstox login URL", type: BrokerAuthRedirectDto })
  relogin(
    @CurrentUser() identity: AuthIdentity,
    @Param() params: BrokerAccountParamsDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<BrokerAuthRedirect> {
    return this.brokers.relogin(identity, params.id, request);
  }

  @Patch(":id")
  @ZodResponse({ status: 200, description: "The updated account", type: BrokerAccountViewDto })
  update(
    @CurrentUser() identity: AuthIdentity,
    @Param() params: BrokerAccountParamsDto,
    @Body() body: UpdateBrokerAccountDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<BrokerAccountView> {
    return this.brokers.update(identity.userId, params.id, body, request);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentUser() identity: AuthIdentity,
    @Param() params: BrokerAccountParamsDto,
    @RequestMeta() request: RequestMetadata,
  ): Promise<void> {
    await this.brokers.remove(identity.userId, params.id, request);
  }
}
