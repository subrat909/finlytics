/**
 * @finlytics/database: the Prisma client for Finlytics, bundled for ESM and CJS consumers.
 *
 * Use `getPrisma()` for the process-wide client, or `createPrismaClient()` for an explicitly configured one (the api,
 * tests, workers with their own pool size). Everything else comes from the generated client: enums, the `Prisma`
 * namespace (Decimal, error classes, input types) and, as types only, the model types and `PrismaClient`.
 *
 * Test helpers (a migrated TimescaleDB in a Testcontainers container) live in the separate `@finlytics/database/testing`
 * entry, so nothing here loads testcontainers.
 */
export { createPrismaClient, getPrisma, prismaClientOptionsFromEnv } from "./client";
export type { CreatePrismaClientOptions, DatabaseClientEnv, DatabaseLogLevel, TransactionTimeouts } from "./client";
export {
  checkDatabaseEnv,
  databaseEnvShape,
  DatabaseEnvError,
  DatabaseEnvSchema,
  DEFAULT_DB_CONNECT_TIMEOUT_MS,
  DEFAULT_DB_POOL_MAX,
  DEFAULT_DB_STATEMENT_TIMEOUT_MS,
  formatEnvIssues,
  loadDatabaseEnv,
} from "./env";
export type { DatabaseEnv, DatabaseEnvRuleInput } from "./env";

// The generated client's runtime values, except the PrismaClient class.
export * from "./generated/enums";
export * as $Enums from "./generated/enums";
export { Prisma } from "./generated/client";
// Everything else as types only. PrismaClient is a type-only export so consumers can annotate with it but never
// `new PrismaClient()`, which would bypass createPrismaClient's guards (URL, timeouts, no query logging). A plain
// `export *` plus `export type { PrismaClient }` is not enough: the declaration bundler drops the shadowing and the
// runtime keeps the class. test/pkg/types.mjs (check:pkg) checks the built declarations.
export type * from "./generated/client";
