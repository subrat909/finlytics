import { PrismaPg } from "@prisma/adapter-pg";

import {
  databaseUrlProblem,
  DEFAULT_DB_CONNECT_TIMEOUT_MS,
  DEFAULT_DB_POOL_MAX,
  DEFAULT_DB_STATEMENT_TIMEOUT_MS,
  loadDatabaseEnv,
} from "./env";
import type { DatabaseEnv } from "./env";
import { PrismaClient } from "./generated/client";

/**
 * Log levels a Finlytics Prisma client may enable. `query` is deliberately not one of them: query logs carry bound
 * parameters (emails, broker ids, tokens), which must never reach a log line.
 */
export type DatabaseLogLevel = "info" | "warn" | "error";

/** Limits for interactive transactions (`prisma.$transaction(async (tx) => …)`). */
export interface TransactionTimeouts {
  /** Longest wait for a connection to start the transaction on (Prisma `maxWait`). Defaults to 5000. */
  readonly maxWaitMs?: number;
  /**
   * Longest the transaction may run before Prisma rolls it back (Prisma `timeout`). Defaults to 12 000. Must be above
   * the statement timeout, so PostgreSQL cancels a slow statement before the client gives up on the transaction.
   */
  readonly timeoutMs?: number;
}

export interface CreatePrismaClientOptions {
  /**
   * PostgreSQL connection string: a `postgres:` or `postgresql:` URL. Required and non-empty: given no connection
   * string, `pg` silently falls back to the `PG*` environment variables and localhost, which could point the app at the
   * wrong database. Surrounding whitespace is trimmed before pg sees it. It must not set `query_timeout`,
   * `statement_timeout`, `idle_in_transaction_session_timeout`, `application_name` or `options`: `pg` would let them
   * override the options below.
   */
  readonly url: string;
  /** Maximum number of connections in the pg pool. An integer of at least 1; defaults to 10. */
  readonly poolMax?: number;
  /** Longest wait for a connection, pooled or new, before a query fails (pg `connectionTimeoutMillis`). Defaults to 5000. */
  readonly connectTimeoutMs?: number;
  /**
   * PostgreSQL `statement_timeout`, set on every connection: the server cancels a statement that runs longer, so the
   * work stops there (a client-side timeout would leave it running). Defaults to 10 000. Must be below
   * `transaction.timeoutMs`.
   */
  readonly statementTimeoutMs?: number;
  /**
   * PostgreSQL `idle_in_transaction_session_timeout`, set on every connection: the server ends a session that sits
   * idle inside a transaction this long, releasing its locks. Defaults to 15 000.
   */
  readonly idleInTransactionTimeoutMs?: number;
  /**
   * PostgreSQL `application_name`, shown in `pg_stat_activity` and the server logs: 1–63 characters from
   * `[A-Za-z0-9._-]`. Defaults to `"finlytics"`; the api uses `"finlytics-api"`.
   */
  readonly applicationName?: string;
  /** Limits for interactive transactions. */
  readonly transaction?: TransactionTimeouts;
  /**
   * Prisma log levels, printed to the console: only the strings `"info"`, `"warn"` and `"error"`. Defaults to none:
   * callers log the errors Prisma throws through the app's own logger, which redacts. Opt in only for local
   * diagnostics: Prisma prints outside that redaction, and an `error` entry includes the failed query's arguments
   * (emails, password hashes, encrypted blobs).
   */
  readonly log?: readonly DatabaseLogLevel[];
}

const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000;
const DEFAULT_TRANSACTION_MAX_WAIT_MS = 5_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 12_000;
const DEFAULT_APPLICATION_NAME = "finlytics";
const DEFAULT_LOG_LEVELS: readonly DatabaseLogLevel[] = [];

/** The largest timeout Node's timers and PostgreSQL's integer settings accept, in milliseconds. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** PostgreSQL truncates `application_name` to 63 bytes and replaces non-ASCII characters; allow neither. */
const APPLICATION_NAME = /^[A-Za-z0-9._-]{1,63}$/;

const LOG_LEVELS: readonly unknown[] = ["info", "warn", "error"];

/** `value` when it is a positive integer (at most `max`, if given), else a RangeError naming the option. */
function positiveInteger(option: string, value: number, max?: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`createPrismaClient: ${option} must be a positive integer`);
  }
  if (max !== undefined && value > max) {
    throw new RangeError(`createPrismaClient: ${option} must be at most ${String(max)}`);
  }
  return value;
}

/** A timeout in milliseconds: a positive integer that Node's timers and PostgreSQL accept. */
function timeout(option: string, value: number): number {
  return positiveInteger(option, value, MAX_TIMEOUT_MS);
}

/**
 * Only the strings "info", "warn" and "error" (security review F5). The type already says so; this guards callers that
 * bypass it (casts, plain JavaScript), including a log definition such as `{ level: "query", emit: "event" }`.
 */
function logLevels(log: unknown): DatabaseLogLevel[] {
  if (!Array.isArray(log) || !log.every((level: unknown) => typeof level === "string" && LOG_LEVELS.includes(level))) {
    throw new TypeError(
      'createPrismaClient: log takes only "info", "warn" and "error"; query logging is not allowed (it would log bound parameters)',
    );
  }
  return [...(log as DatabaseLogLevel[])];
}

/**
 * Creates a Prisma client backed by a `pg` pool (`@prisma/adapter-pg`). Pure: reads no environment variables and opens
 * no connection; the pool connects on the first query. Every connection the pool opens carries the statement and
 * idle-in-transaction timeouts and the application name as startup parameters, so they hold for every query,
 * including Prisma's own.
 *
 * @throws {TypeError} when `url` is empty, not a postgres URL or sets a parameter that would override these options,
 *   when `applicationName` is invalid, or when `log` holds anything but "info", "warn" and "error".
 * @throws {RangeError} when `poolMax` or a timeout is not a positive integer, or when `statementTimeoutMs` is not below
 *   `transaction.timeoutMs`.
 */
export function createPrismaClient({
  url,
  poolMax = DEFAULT_DB_POOL_MAX,
  connectTimeoutMs = DEFAULT_DB_CONNECT_TIMEOUT_MS,
  statementTimeoutMs = DEFAULT_DB_STATEMENT_TIMEOUT_MS,
  idleInTransactionTimeoutMs = DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  applicationName = DEFAULT_APPLICATION_NAME,
  transaction = {},
  log = DEFAULT_LOG_LEVELS,
}: CreatePrismaClientOptions): PrismaClient {
  // One trimmed string for the checks and for pg. pg-connection-string reads a URL with a leading space as a relative
  // path, so the whole URL, password included, would become the database name (and reach its error messages).
  const connectionString = url.trim();
  if (connectionString === "") {
    throw new TypeError("createPrismaClient: url must be a non-empty PostgreSQL connection string");
  }
  const urlProblem = databaseUrlProblem(connectionString);
  if (urlProblem !== undefined) throw new TypeError(`createPrismaClient: url ${urlProblem}`);
  if (!APPLICATION_NAME.test(applicationName)) {
    throw new TypeError("createPrismaClient: applicationName must be 1–63 characters from [A-Za-z0-9._-]");
  }
  const levels = logLevels(log);
  const { maxWaitMs = DEFAULT_TRANSACTION_MAX_WAIT_MS, timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS } = transaction;
  // Every option is checked before anything is constructed.
  const pool = {
    connectionString,
    max: positiveInteger("poolMax", poolMax),
    connectionTimeoutMillis: timeout("connectTimeoutMs", connectTimeoutMs),
    statement_timeout: timeout("statementTimeoutMs", statementTimeoutMs),
    idle_in_transaction_session_timeout: timeout("idleInTransactionTimeoutMs", idleInTransactionTimeoutMs),
    application_name: applicationName,
  };
  const transactionOptions = {
    maxWait: timeout("transaction.maxWaitMs", maxWaitMs),
    timeout: timeout("transaction.timeoutMs", timeoutMs),
  };
  // PostgreSQL must cancel a slow statement before Prisma gives up on its transaction: a transaction timeout fires on the
  // client and leaves the statement running, and by an unverified third-party report can return the connection
  // mid-transaction (plan D14).
  if (pool.statement_timeout >= transactionOptions.timeout) {
    throw new RangeError(
      `createPrismaClient: statementTimeoutMs (${String(pool.statement_timeout)}) must be below transaction.timeoutMs (${String(transactionOptions.timeout)})`,
    );
  }

  return new PrismaClient({ adapter: new PrismaPg(pool), log: levels, transactionOptions });
}

/** The `DB_*` variables a client is configured from. */
export type DatabaseClientEnv = Pick<
  DatabaseEnv,
  "DATABASE_URL" | "DB_POOL_MAX" | "DB_CONNECT_TIMEOUT_MS" | "DB_STATEMENT_TIMEOUT_MS"
>;

/**
 * The client options a validated database environment gives: URL, pool size, connect and statement timeouts. Spread
 * it and add what is specific to the caller, e.g.
 * `createPrismaClient({ ...prismaClientOptionsFromEnv(env), applicationName: "finlytics-api" })`.
 */
export function prismaClientOptionsFromEnv(env: DatabaseClientEnv): CreatePrismaClientOptions {
  return {
    url: env.DATABASE_URL,
    poolMax: env.DB_POOL_MAX,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  };
}

/**
 * Where `getPrisma()` caches its client: on `globalThis`, under a registered symbol, in every environment (review D7).
 * The ESM and CJS builds of this package each have their own module scope but share this symbol, so a process that
 * loads both still has one client and one pool; module re-evaluation (Next.js HMR, watch mode) reuses it too. The
 * cached client may come from the other build, so recognise its errors by `name` and `code`, never with `instanceof`.
 */
export const PRISMA_GLOBAL_KEY: unique symbol = Symbol.for("@finlytics/database/prisma");

type GlobalWithPrisma = typeof globalThis & { [PRISMA_GLOBAL_KEY]?: PrismaClient | undefined };

/**
 * Returns the process-wide Prisma client, creating it on the first call from `DATABASE_URL` and the `DB_*` variables
 * (validated with Zod: `loadDatabaseEnv`). Nothing is read or constructed at import time.
 *
 * @throws {DatabaseEnvError} on the first call, when the database environment is missing or invalid.
 */
export function getPrisma(): PrismaClient {
  const cache = globalThis as GlobalWithPrisma;
  cache[PRISMA_GLOBAL_KEY] ??= createPrismaClient(prismaClientOptionsFromEnv(loadDatabaseEnv()));
  return cache[PRISMA_GLOBAL_KEY];
}
