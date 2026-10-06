/**
 * Vitest global setup for the integration tests (runs once, in the main process): starts one PostgreSQL + TimescaleDB
 * container with `startTestDatabase` (src/testing: pinned image, random password, app database migrated with
 * `prisma migrate deploy`, empty shadow database) and hands the URLs to the tests through provide/inject. The returned
 * teardown stops and removes the container; Testcontainers' Ryuk reaps it if the run is killed.
 */
import type { TestProject } from "vitest/node";

import { startTestDatabase } from "../../src/testing/index";

declare module "vitest" {
  export interface ProvidedContext {
    /** The container's maintenance database (`postgres`). Connect here only to CREATE DATABASE. */
    adminDatabaseUrl: string;
    /** The shared app database, migrated once. Tests keep their rows apart with unique ids. */
    databaseUrl: string;
    /** An empty database for SHADOW_DATABASE_URL, so no Prisma CLI command can pick one up from the root .env. */
    shadowDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Stops its own container when it fails, so a failed setup leaves nothing behind.
  const database = await startTestDatabase({ labels: { "dev.finlytics.test.suite": "database-integration" } });

  project.provide("adminDatabaseUrl", database.adminUrl);
  project.provide("databaseUrl", database.databaseUrl);
  project.provide("shadowDatabaseUrl", database.shadowDatabaseUrl);

  return async () => {
    await database.stop();
  };
}
