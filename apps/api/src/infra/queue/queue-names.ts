/**
 * BullMQ queues (backend.md "Jobs"; plan P6, P7). Keys live under `bull:<queue>:*` (infra/redis/keys.ts), owned by
 * BullMQ. Jobs are idempotent, retried with exponential backoff, and their payloads are validated with Zod by the
 * processor; failed jobs stay in the queue's failed set (the dead-letter list) for monitoring.
 */
import type { DefaultJobOptions } from "bullmq";

export const QUEUE_NAMES = Object.freeze({
  /** Daily 08:00 IST per broker, and on demand (`POST /v1/admin/instruments/sync`). */
  instrumentMasterSync: "instrument-master-sync",
  /** Daily 08:30 IST: expired tokens → NEEDS_RELOGIN. */
  brokerTokenExpiry: "broker-token-expiry",
  /** Every 30 minutes: renews ACTIVE Dhan tokens expiring within 3 hours (phase 1b). Payload `{}`. */
  brokerTokenRenew: "broker-token-renew",
} as const);
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Retries with exponential backoff (30 s, 60 s, 120 s); bounded history; failed jobs kept as the dead-letter list. */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = Object.freeze({
  attempts: 4,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1_000 },
});

/** The repeating schedules (job schedulers), in Asia/Kolkata. */
export const JOB_SCHEDULES = Object.freeze({
  instrumentMasterSync: { id: "instrument-master-sync:daily", pattern: "0 8 * * *", tz: "Asia/Kolkata" },
  brokerTokenExpiry: { id: "broker-token-expiry:daily", pattern: "30 8 * * *", tz: "Asia/Kolkata" },
  brokerTokenRenew: { id: "broker-token-renew:30m", pattern: "*/30 * * * *", tz: "Asia/Kolkata" },
} as const);
