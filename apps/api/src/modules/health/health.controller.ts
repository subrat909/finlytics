import type { HealthLive, HealthReady } from "@finlytics/shared";
import { Controller, Get, Res } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { ZodResponse, ZodSerializerDto } from "nestjs-zod";

import { Public } from "../../common/decorators/public";
import { SkipRateLimit } from "../../common/decorators/skip-rate-limit";

import { HealthLiveDto, HealthReadyDto } from "./dto";
import { HealthService } from "./health.service";

/**
 * Probes (plan D13), outside `/v1`: plain JSON (probes read the status code), public, never access-logged, never
 * rate-limited, and never routed by the ingress.
 */
@ApiTags("health")
@Controller("health")
@Public()
@SkipRateLimit()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 while the process runs. No I/O. */
  @Get("live")
  @ZodResponse({ status: 200, description: "The process is alive", type: HealthLiveDto })
  live(): HealthLive {
    return { status: "ok" };
  }

  /** 200 when the database and Redis answer; 503 otherwise, and while draining. */
  @Get("ready")
  @ZodSerializerDto(HealthReadyDto)
  @ApiResponse({ status: 200, description: "Ready: the database and Redis answer", type: HealthReadyDto.Output })
  @ApiResponse({
    status: 503,
    description: "Not ready (a dependency is down, or the process is draining); plain JSON, not a problem",
    type: HealthReadyDto.Output,
  })
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReady> {
    const { httpStatus, body } = await this.health.ready();
    reply.status(httpStatus);
    return body;
  }
}
