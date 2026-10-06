/**
 * Redis for the integration tests: the image pinned for the `redis` service in docker-compose.yml, with a random
 * password per container (test/unit/test-images.test.ts keeps the two tags equal). PostgreSQL + TimescaleDB comes from
 * @finlytics/database/testing.
 */
import { randomPassword } from "@finlytics/database/testing";

/** Keep equal to the `redis` service's image in docker-compose.yml. */
export const REDIS_IMAGE = "redis:7.4-alpine";

export interface StartedTestRedis {
  /** `redis://default:<password>@<host>:<port>`. */
  readonly url: string;
  stop(): Promise<void>;
}

/** Starts a Redis container. Loads testcontainers only when called, so importing REDIS_IMAGE stays cheap. */
export async function startTestRedis(labels: Readonly<Record<string, string>> = {}): Promise<StartedTestRedis> {
  const { RedisContainer } = await import("@testcontainers/redis");
  const container = await new RedisContainer(REDIS_IMAGE)
    .withPassword(randomPassword())
    .withLabels({ ...labels, "dev.finlytics.test": "redis" })
    .start();
  return {
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
