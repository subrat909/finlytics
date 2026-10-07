/**
 * @finlytics/database/testing: a migrated PostgreSQL + TimescaleDB for integration tests, shared by this package and
 * apps/api (plan D16). Needs Docker, and the optional peer dependencies `testcontainers` and
 * `@testcontainers/postgresql`. Never imports "vitest", so a Vitest global setup can use it in the main process.
 *
 * ```ts
 * // vitest global setup
 * const database = await startTestDatabase(); // random password, migrated with `prisma migrate deploy`
 * project.provide("databaseUrl", database.databaseUrl);
 * return () => database.stop();
 * ```
 *
 * Every helper that connects or runs the Prisma CLI first checks that its URL is the container's: never port 5432 or
 * 5433, never a URL without a port, so a test can't touch the dev database.
 */
export { databaseNameOf, describeTestDatabaseUrl, parseTestDatabaseUrl } from "./database-url";
export { TIMESCALE_IMAGE } from "./images";
export { createDatabase, randomPassword, startTestDatabase, uniqueDatabaseName } from "./postgres";
export type { StartedTestDatabase, StartTestDatabaseOptions, TestDatabase } from "./postgres";
export { cliDatasource, migrateDeploy, PACKAGE_ROOT, runPrismaCli } from "./prisma-cli";
export type { CliDatasource, PrismaCliTarget } from "./prisma-cli";
export { runProcess } from "./process";
export type { ProcessResult, RunProcessOptions } from "./process";
