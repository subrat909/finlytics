/**
 * Vitest global setup for the integration tests (runs once, in the main process): starts one PostgreSQL + TimescaleDB
 * container from the pinned image, creates the shared app database and a shadow database, applies the migrations with
 * `prisma migrate deploy` (target asserted), and hands the URLs to the tests through provide/inject. The returned
 * teardown stops and removes the container; Testcontainers' Ryuk reaps it if the run is killed.
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

import { createDatabase, migrateDeploy } from "./database-admin";
import { TIMESCALE_IMAGE } from "./timescale-image";

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

/** Throwaway credentials for a container that lives as long as one test run. */
const CONTAINER_USER = "finlytics_test";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(TIMESCALE_IMAGE)
    .withDatabase("postgres")
    .withUsername(CONTAINER_USER)
    .withPassword(CONTAINER_USER)
    // TimescaleDB reports telemetry by default; a test run has nothing to report.
    .withCommand(["postgres", "-c", "timescaledb.telemetry_level=off"])
    .withLabels({ "dev.finlytics.test": "database-integration" })
    .start();

  try {
    const adminDatabaseUrl = container.getConnectionUri();
    const app = await createDatabase(adminDatabaseUrl, "finlytics_it");
    const shadow = await createDatabase(adminDatabaseUrl, "finlytics_it_shadow");
    await migrateDeploy({ databaseUrl: app.url, shadowDatabaseUrl: shadow.url });

    project.provide("adminDatabaseUrl", adminDatabaseUrl);
    project.provide("databaseUrl", app.url);
    project.provide("shadowDatabaseUrl", shadow.url);
  } catch (error) {
    // Vitest registers the teardown only when setup returns, so clean up here before failing the run.
    await container.stop();
    throw error;
  }

  return async () => {
    await container.stop();
  };
}
