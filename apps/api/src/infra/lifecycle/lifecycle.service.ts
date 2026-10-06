/**
 * The shutdown sequence (plan D2), in Nest's hook order:
 *
 * 1. `onModuleDestroy`: readiness switches to `draining` (503), so the load balancer stops sending traffic.
 * 2. `beforeApplicationShutdown`: wait API_SHUTDOWN_DRAIN_MS for the load balancer to notice.
 * 3. Nest closes Fastify: no new connections, idle keep-alive sockets close, in-flight requests finish, and a request
 *    that still arrives on an open connection gets a 503 problem with `Connection: close` (bootstrap/http-hardening.ts).
 * 4. `onApplicationShutdown`: close Prisma, then Redis. Never earlier: Nest calls `onModuleDestroy` before it closes
 *    connections, so closing a client there would break in-flight requests.
 *
 * One service runs the whole sequence, so the order doesn't depend on module order.
 */
import { Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationShutdown, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";

import { sleep } from "../../common/async";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

import { ReadinessState } from "./readiness.state";

@Injectable()
export class LifecycleService implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly drainMs: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly readiness: ReadinessState,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(LifecycleService.name);
    this.drainMs = config.get("API_SHUTDOWN_DRAIN_MS", { infer: true });
  }

  onModuleDestroy(): void {
    this.readiness.startDraining();
    this.logger.info({ drainMs: this.drainMs }, "shutting down: readiness reports draining");
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.drainMs > 0) await sleep(this.drainMs);
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.prisma.close();
    } finally {
      await this.redis.close();
    }
    this.logger.info("shutdown complete: database and redis closed");
  }
}
