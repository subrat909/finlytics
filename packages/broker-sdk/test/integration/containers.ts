/**
 * Redis for the integration tests: the image pinned for the `redis` service in docker-compose.yml (a unit test keeps
 * the two tags equal, src/__tests__/registry.test.ts), with a random password per container.
 */
import { randomBytes } from "node:crypto";

/** Keep equal to the `redis` service's image in docker-compose.yml. */
export const REDIS_IMAGE = "redis:7.4-alpine";

export interface StartedTestRedis {
  /** `redis://default:<password>@<host>:<port>`. */
  readonly url: string;
  stop(): Promise<void>;
}

/** Starts a Redis container. Loads testcontainers only when called, so importing REDIS_IMAGE stays cheap. */
export async function startTestRedis(): Promise<StartedTestRedis> {
  const { RedisContainer } = await import("@testcontainers/redis");
  const container = await new RedisContainer(REDIS_IMAGE)
    .withPassword(randomBytes(18).toString("base64url"))
    .withLabels({ "dev.finlytics.test": "redis", "dev.finlytics.test.suite": "broker-sdk-integration" })
    .start();
  return {
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
