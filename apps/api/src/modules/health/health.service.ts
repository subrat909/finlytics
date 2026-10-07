/**
 * Readiness (plan D13): `SELECT 1` within 1 s and Redis `PING` within 500 ms, in parallel. Ready only when both are up,
 * the process isn't draining and, in production, the database role check has passed once. The body says which check
 * failed, never why: no hostnames, versions, durations or error text.
 *
 * The two checks run single-flight and their result is reused for 1 s: concurrent probes (kubelet, the load balancer,
 * a flood of unauthenticated requests to an unrouted `/health/ready`) share one `SELECT 1` and one `PING` instead of
 * each taking a pooled connection. Draining and the role check are read fresh on every call.
 *
 * Liveness has no service: it touches nothing, so a database blip never restarts every pod.
 */
import type { HealthReady } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { withTimeout } from "../../common/async";
import { ReadinessState } from "../../infra/lifecycle/readiness.state";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

export const DATABASE_CHECK_TIMEOUT_MS = 1_000;
export const REDIS_CHECK_TIMEOUT_MS = 500;

/** How long a finished pair of checks answers later probes. */
export const READINESS_CACHE_MS = 1_000;

type Checks = HealthReady["checks"];

export interface Readiness {
  /** 200 when ready, otherwise 503. */
  readonly httpStatus: 200 | 503;
  readonly body: HealthReady;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly readiness: ReadinessState,
  ) {}

  /** The running checks, shared by every probe that arrives meanwhile. */
  private inFlight: Promise<Checks> | undefined;
  /** The last finished checks, and when they finished (monotonic ms). */
  private last: { readonly at: number; readonly checks: Checks } | undefined;

  async ready(): Promise<Readiness> {
    const { database, redis } = await this.checks();
    const status: HealthReady["status"] = this.readiness.isDraining
      ? "draining"
      : database === "up" && redis === "up" && !this.readiness.isRoleCheckPending
        ? "ok"
        : "unavailable";
    return { httpStatus: status === "ok" ? 200 : 503, body: { status, checks: { database, redis } } };
  }

  /** The checks: from the last second, the ones running now, or a new pair. */
  private checks(): Promise<Checks> {
    if (this.last !== undefined && performance.now() - this.last.at < READINESS_CACHE_MS) {
      return Promise.resolve(this.last.checks);
    }
    this.inFlight ??= this.runChecks().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runChecks(): Promise<Checks> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const checks = { database, redis };
    this.last = { at: performance.now(), checks };
    return checks;
  }

  private async checkDatabase(): Promise<"up" | "down"> {
    try {
      await withTimeout(this.prisma.unscoped.$queryRaw`SELECT 1`, DATABASE_CHECK_TIMEOUT_MS, "database check");
      return "up";
    } catch {
      return "down";
    }
  }

  private async checkRedis(): Promise<"up" | "down"> {
    return (await this.redis.ping(REDIS_CHECK_TIMEOUT_MS)) ? "up" : "down";
  }
}
