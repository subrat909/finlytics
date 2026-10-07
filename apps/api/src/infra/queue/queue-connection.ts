/**
 * BullMQ's Redis connection options. BullMQ opens connections of its own (a queue's, and a blocking one per worker), so
 * this is configuration, not the request-path client (infra/redis). `maxRetriesPerRequest: null` is required by BullMQ
 * workers: their blocking commands must not fail on a slow Redis.
 */
import type { ConnectionOptions } from "bullmq";

export function queueConnectionOptions(redisUrl: string): ConnectionOptions {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
    connectionName: "finlytics-queue",
  };
}
