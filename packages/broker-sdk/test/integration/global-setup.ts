/**
 * Vitest global setup for the integration tests (runs once, in the main process): starts one Redis container from
 * the pinned image and hands its URL to the tests through provide/inject. The teardown stops and removes it;
 * Testcontainers' Ryuk reaps it if the run is killed.
 */
import type { TestProject } from "vitest/node";

import { startTestRedis } from "./containers";

declare module "vitest" {
  export interface ProvidedContext {
    /** `redis://default:<password>@<host>:<port>` of the test container. */
    redisUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const redis = await startTestRedis();
  project.provide("redisUrl", redis.url);
  return async () => {
    await redis.stop();
  };
}
