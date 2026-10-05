/**
 * @finlytics/database: the Prisma client for Finlytics, bundled for ESM and CJS consumers.
 *
 * Use `getPrisma()` for the process-wide client, or `createPrismaClient()` for an explicitly configured one (tests,
 * workers with their own pool size). Everything else comes from the generated client: enums, the `Prisma` namespace
 * (Decimal, error classes, input types) and, as types only, the model types and `PrismaClient`.
 */
export { createPrismaClient, getPrisma } from "./client";
export type { CreatePrismaClientOptions, DatabaseLogLevel } from "./client";
export { DatabaseEnvError, DatabaseEnvSchema, loadDatabaseEnv } from "./env";
export type { DatabaseEnv } from "./env";

// The generated client's runtime values, except the PrismaClient class.
export * from "./generated/enums";
export * as $Enums from "./generated/enums";
export { Prisma } from "./generated/client";
// Everything else as types only. PrismaClient is a type-only export so consumers can annotate with it but never
// `new PrismaClient()`, which would bypass createPrismaClient's guards (non-empty URL, no query logging). A plain
// `export *` plus `export type { PrismaClient }` is not enough: the declaration bundler drops the shadowing and the
// runtime keeps the class. test/pkg/types.mjs (check:pkg) checks the built declarations.
export type * from "./generated/client";
