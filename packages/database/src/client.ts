import { PrismaPg } from "@prisma/adapter-pg";

import { DEFAULT_DB_POOL_MAX, loadDatabaseEnv } from "./env";
import { PrismaClient } from "./generated/client";

/**
 * Log levels a Finlytics Prisma client may enable. `query` is deliberately not one of them: query logs carry bound
 * parameters (emails, broker ids, tokens), which must never reach a log line.
 */
export type DatabaseLogLevel = "info" | "warn" | "error";

export interface CreatePrismaClientOptions {
  /**
   * PostgreSQL connection string. Required and non-empty: given no connection string, `pg` silently falls back to the
   * `PG*` environment variables and localhost, which could point the app at the wrong database.
   */
  readonly url: string;
  /** Maximum number of connections in the pg pool. An integer of at least 1; defaults to 10. */
  readonly poolMax?: number;
  /**
   * Prisma log levels, printed to the console. Defaults to none: callers log the errors Prisma throws through the
   * app's own logger, which redacts. Opt in only for local diagnostics: Prisma prints outside that redaction, and an
   * `error` entry includes the failed query's arguments (emails, password hashes, encrypted blobs).
   */
  readonly log?: readonly DatabaseLogLevel[];
}

const DEFAULT_LOG_LEVELS: readonly DatabaseLogLevel[] = [];

/**
 * Creates a Prisma client backed by a `pg` pool (`@prisma/adapter-pg`). Pure: reads no environment variables and opens
 * no connection; the pool connects on the first query.
 *
 * @throws {TypeError} when `url` is empty or `log` contains `query`.
 * @throws {RangeError} when `poolMax` is not a positive integer.
 */
export function createPrismaClient({
  url,
  poolMax = DEFAULT_DB_POOL_MAX,
  log = DEFAULT_LOG_LEVELS,
}: CreatePrismaClientOptions): PrismaClient {
  if (url.trim() === "") {
    throw new TypeError("createPrismaClient: url must be a non-empty PostgreSQL connection string");
  }
  if (!Number.isInteger(poolMax) || poolMax < 1) {
    throw new RangeError("createPrismaClient: poolMax must be a positive integer");
  }
  // The type already excludes `query`; this guards callers that bypass it (casts, plain JavaScript).
  if ((log as readonly string[]).includes("query")) {
    throw new TypeError("createPrismaClient: query logging is not allowed (it would log bound parameters)");
  }

  const adapter = new PrismaPg({ connectionString: url, max: poolMax });
  return new PrismaClient({ adapter, log: [...log] });
}

/**
 * Where `getPrisma()` caches its client outside production, so that module re-evaluation (Next.js HMR, watch mode)
 * reuses one pool instead of opening a new one each time. A registered symbol is shared by the ESM and CJS builds.
 */
export const PRISMA_GLOBAL_KEY: unique symbol = Symbol.for("@finlytics/database/prisma");

type GlobalWithPrisma = typeof globalThis & { [PRISMA_GLOBAL_KEY]?: PrismaClient | undefined };

let productionClient: PrismaClient | undefined;

function createPrismaClientFromEnv(): PrismaClient {
  const env = loadDatabaseEnv();
  return createPrismaClient({ url: env.DATABASE_URL, poolMax: env.DB_POOL_MAX });
}

/**
 * Returns the process-wide Prisma client, creating it on the first call from `DATABASE_URL` and `DB_POOL_MAX`
 * (validated with Zod). Nothing is read or constructed at import time.
 *
 * In production the client lives in a module variable. Elsewhere it is cached on `globalThis`, so hot reloads reuse
 * one client and one pool.
 *
 * @throws {DatabaseEnvError} on the first call, when the database environment is missing or invalid.
 */
export function getPrisma(): PrismaClient {
  if (process.env["NODE_ENV"] === "production") {
    productionClient ??= createPrismaClientFromEnv();
    return productionClient;
  }
  const cache = globalThis as GlobalWithPrisma;
  cache[PRISMA_GLOBAL_KEY] ??= createPrismaClientFromEnv();
  return cache[PRISMA_GLOBAL_KEY];
}
