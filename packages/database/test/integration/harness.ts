/**
 * Helpers for integration tests (test workers only: they read the URLs that global-setup.ts provides).
 *
 * - Most tests share the migrated app database (`sharedDatabaseUrl()`) and keep their rows apart with `uniqueSuffix()`.
 * - Tests that need an empty or freshly migrated database create their own: `createEmptyDatabase()` or
 *   `createMigratedDatabase()`. They are dropped with the container at the end of the run.
 * - Prisma CLI commands go through `runPrismaCli(args, prismaCliTarget(url))` (database-admin.ts), which sets
 *   DATABASE_URL, DATABASE_DIRECT_URL and SHADOW_DATABASE_URL so nothing from the root .env applies.
 */
import { randomUUID } from "node:crypto";

import { inject } from "vitest";

import { createPrismaClient, Prisma } from "../../src/index";
import type { PrismaClient } from "../../src/index";
import { createDatabase, migrateDeploy, uniqueDatabaseName } from "./database-admin";
import type { PrismaCliTarget, ProcessResult, TestDatabase } from "./database-admin";

/** The shared app database, migrated once by the global setup. */
export function sharedDatabaseUrl(): string {
  return inject("databaseUrl");
}

/** Target for runPrismaCli: the given database, plus the run's (empty) shadow database. */
export function prismaCliTarget(databaseUrl: string): PrismaCliTarget {
  return { databaseUrl, shadowDatabaseUrl: inject("shadowDatabaseUrl") };
}

/**
 * Creates an empty database (a copy of template1: only the timescaledb and timescaledb_toolkit extensions, no tables).
 * @param prefix lowercase letters, digits and underscores; a random suffix keeps the name unique.
 */
export async function createEmptyDatabase(prefix: string): Promise<TestDatabase> {
  return createDatabase(inject("adminDatabaseUrl"), uniqueDatabaseName(prefix));
}

/**
 * Creates a database and applies every migration with `prisma migrate deploy` (target asserted), about half a second.
 * Cloning a migrated template (CREATE DATABASE ... TEMPLATE) would also work, but deploying runs the real migration
 * path every time and needs no pristine template database that tests must never write to.
 */
export async function createMigratedDatabase(prefix: string): Promise<TestDatabase> {
  const database = await createEmptyDatabase(prefix);
  await migrateDeploy(prismaCliTarget(database.url));
  return database;
}

/**
 * A Prisma client for a test database, through the package's own factory. Logging is off: tests that expect database
 * errors would otherwise print them, and every error still reaches the test as a rejection. Call `$disconnect()` in
 * the matching teardown.
 */
export function connect(url: string): PrismaClient {
  return createPrismaClient({ url, poolMax: 2, log: [] });
}

/** Runs `work` with a client for `url` and disconnects afterwards, whatever happens. */
export async function withClient<T>(url: string, work: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = connect(url);
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** A child's stdout and stderr together: the message for a failed exit-code expectation, so it shows what ran. */
export function outputOf(result: ProcessResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

/** A short random id for keys, emails and names, so tests sharing a database never collide. */
export function uniqueSuffix(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

/** What a failed Prisma query reports about the PostgreSQL error behind it. */
export interface DatabaseError {
  /** Prisma's error code, e.g. P2002 (unique violation) or P2010 (raw query failed). */
  readonly prismaCode: string;
  /** The PostgreSQL SQLSTATE, e.g. 23505 (unique_violation), 23514 (check_violation), P0001 (raise_exception). */
  readonly sqlState: string | undefined;
  /** PostgreSQL's own message, e.g. the text of a trigger's RAISE EXCEPTION. */
  readonly message: string | undefined;
}

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Reads the PostgreSQL error behind a rejected Prisma query. With @prisma/adapter-pg it sits in
 * `meta.driverAdapterError.cause` (`originalCode`, `originalMessage`).
 * @throws {Error} when `error` is not a PrismaClientKnownRequestError (the query failed some other way).
 */
export function databaseError(error: unknown): DatabaseError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    throw new Error(`Expected a PrismaClientKnownRequestError, got ${String(error)}`, { cause: error });
  }
  const cause = property(property(error.meta, "driverAdapterError"), "cause");
  const sqlState = property(cause, "originalCode");
  const message = property(cause, "originalMessage");
  return {
    prismaCode: error.code,
    sqlState: typeof sqlState === "string" ? sqlState : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}
