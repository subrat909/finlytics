/**
 * Vitest global setup for the api integration tests (runs once, in the main process): one PostgreSQL + TimescaleDB
 * container (pinned image, random password, migrated with `prisma migrate deploy`) and one Redis container (random
 * password), handed to the test files through provide/inject. Tests keep their rows apart with unique ids; outages
 * are simulated per app (a URL on a closed port), never by stopping a shared container.
 */
import { startTestDatabase } from "@finlytics/database/testing";
import type { TestProject } from "vitest/node";

import { startTestRedis } from "./containers";

declare module "vitest" {
  export interface ProvidedContext {
    /** The container's maintenance database, as its superuser. */
    adminDatabaseUrl: string;
    /** The migrated app database, as the container's superuser. */
    databaseUrl: string;
    /** `redis://default:<password>@host:port`. */
    redisUrl: string;
  }
}

const LABELS = { "dev.finlytics.test.suite": "api-integration" };

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [database, redis] = await Promise.allSettled([startTestDatabase({ labels: LABELS }), startTestRedis(LABELS)]);
  if (database.status === "rejected" || redis.status === "rejected") {
    // Each helper stops its own container on failure; stop the one that did start.
    if (database.status === "fulfilled") await database.value.stop();
    if (redis.status === "fulfilled") await redis.value.stop();
    throw database.status === "rejected" ? database.reason : (redis as PromiseRejectedResult).reason;
  }

  project.provide("adminDatabaseUrl", database.value.adminUrl);
  project.provide("databaseUrl", database.value.databaseUrl);
  project.provide("redisUrl", redis.value.url);

  return async () => {
    await Promise.all([database.value.stop(), redis.value.stop()]);
  };
}
