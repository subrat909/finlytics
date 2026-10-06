/**
 * The api's Prisma client (plan D14), built once from the validated environment with @finlytics/database's factory:
 * pool size, 5 s connect timeout, server-side `statement_timeout` (10 s) and `idle_in_transaction_session_timeout`
 * (15 s), `application_name = finlytics-api`, interactive transactions `maxWait` 2 s and `timeout` 12 s
 * (TRANSACTION_LIMITS: 14 s in all, inside the 15 s request budget). No query logging. The pool connects on the first
 * query.
 *
 * - `db`: the client with the tenancy guard (./tenancy.extension.ts). Every repository uses this one.
 * - `unscoped`: the base client. Lint allows it only in src/infra/prisma, src/modules/auth (the session lookup by
 *   token) and src/modules/health (`SELECT 1`).
 *
 * Closed by LifecycleService in `onApplicationShutdown`, after in-flight requests have finished.
 */
import { createPrismaClient, prismaClientOptionsFromEnv } from "@finlytics/database";
import type { PrismaClient } from "@finlytics/database";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { TRANSACTION_LIMITS } from "../../config/env.schema";
import type { Env } from "../../config/env.schema";

import { tenancyGuard } from "./tenancy.extension";

/** The PostgreSQL `application_name` of the api's connections. */
export const API_APPLICATION_NAME = "finlytics-api";

/** The tenancy-guarded client for `base`. */
export function withTenancyGuard(base: PrismaClient) {
  return base.$extends(tenancyGuard);
}

/** The tenancy-guarded Prisma client type (`PrismaService.db`). */
export type TenantPrismaClient = ReturnType<typeof withTenancyGuard>;

/**
 * The client an interactive transaction on `db` hands its callback (`db.$transaction(async (tx) => …)`): still
 * tenancy-guarded. Repositories take it as their first argument when a service runs them in one transaction.
 */
export type TenantTransaction = Parameters<
  Extract<Parameters<TenantPrismaClient["$transaction"]>[0], (...args: never[]) => unknown>
>[0];

@Injectable()
export class PrismaService {
  readonly unscoped: PrismaClient;
  readonly db: TenantPrismaClient;
  private closing: Promise<void> | undefined;

  constructor(config: ConfigService<Env, true>) {
    const options = prismaClientOptionsFromEnv({
      DATABASE_URL: config.get("DATABASE_URL", { infer: true }),
      DB_POOL_MAX: config.get("DB_POOL_MAX", { infer: true }),
      DB_CONNECT_TIMEOUT_MS: config.get("DB_CONNECT_TIMEOUT_MS", { infer: true }),
      DB_STATEMENT_TIMEOUT_MS: config.get("DB_STATEMENT_TIMEOUT_MS", { infer: true }),
    });
    this.unscoped = createPrismaClient({
      ...options,
      applicationName: API_APPLICATION_NAME,
      transaction: { maxWaitMs: TRANSACTION_LIMITS.maxWaitMs, timeoutMs: TRANSACTION_LIMITS.timeoutMs },
    });
    this.db = withTenancyGuard(this.unscoped);
  }

  /** Disconnects the pool. Idempotent. */
  close(): Promise<void> {
    this.closing ??= this.unscoped.$disconnect();
    return this.closing;
  }
}
