import { describe, expect, it } from "vitest";

import { queueConnectionOptions } from "../queue-connection";
import { DEFAULT_JOB_OPTIONS, JOB_SCHEDULES, QUEUE_NAMES } from "../queue-names";

describe("queue configuration", () => {
  it("uses the existing Redis with BullMQ's required blocking-command setting", () => {
    expect(queueConnectionOptions("redis://:pw@localhost:6380")).toEqual({
      url: "redis://:pw@localhost:6380",
      maxRetriesPerRequest: null,
      connectionName: "finlytics-queue",
    });
  });

  it("retries with exponential backoff and keeps failed jobs", () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({ attempts: 4, backoff: { type: "exponential" } });
    expect(QUEUE_NAMES).toEqual({
      instrumentMasterSync: "instrument-master-sync",
      brokerTokenExpiry: "broker-token-expiry",
      brokerTokenRenew: "broker-token-renew",
    });
  });

  it("schedules the sync at 08:00 IST, the expiry check at 08:30 IST and the token renewal every 30 minutes", () => {
    expect(JOB_SCHEDULES.instrumentMasterSync).toMatchObject({ pattern: "0 8 * * *", tz: "Asia/Kolkata" });
    expect(JOB_SCHEDULES.brokerTokenExpiry).toMatchObject({ pattern: "30 8 * * *", tz: "Asia/Kolkata" });
    expect(JOB_SCHEDULES.brokerTokenRenew).toMatchObject({ pattern: "*/30 * * * *", tz: "Asia/Kolkata" });
  });
});
