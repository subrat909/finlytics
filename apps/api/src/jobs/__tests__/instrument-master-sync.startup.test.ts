import type { BrokerCode } from "@finlytics/shared";
import type { Queue } from "bullmq";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../infra/prisma/prisma.service";
import type { InstrumentMasterService } from "../../modules/instruments/instrument-master.service";
import type { InstrumentSyncJobData } from "../../modules/instruments/instruments.service";
import { InstrumentMasterSyncStartup } from "../instrument-master-sync.startup";

const NOW = new Date("2026-10-06T02:30:00.000Z");
const HOUR = String(Math.floor(NOW.getTime() / 3_600_000));

function setup(active: string[], synced: Partial<Record<BrokerCode, number>> = {}) {
  const prisma = { db: { $queryRaw: vi.fn(() => Promise.resolve(active.map((broker) => ({ broker })))) } };
  const master = {
    syncableBrokers: () => ["UPSTOX", "DHAN"],
    lastSyncedAt: vi.fn((broker: BrokerCode) => Promise.resolve(synced[broker] ?? null)),
  };
  const queue = { add: vi.fn(() => Promise.resolve({})) };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const startup = new InstrumentMasterSyncStartup(
    prisma as unknown as PrismaService,
    master as unknown as InstrumentMasterService,
    queue as unknown as Queue<InstrumentSyncJobData>,
    { now: () => NOW },
    logger as unknown as PinoLogger,
  );
  return { startup, queue, logger, prisma };
}

describe("InstrumentMasterSyncStartup", () => {
  it("queues the brokers with an ACTIVE account and no sync record, once per hour", async () => {
    const { startup, queue } = setup(["UPSTOX", "DHAN", "PAPER", "NOT_A_BROKER"], { DHAN: NOW.getTime() });

    expect(await startup.run()).toEqual(["UPSTOX"]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith("sync", { broker: "UPSTOX" }, { jobId: `startup-UPSTOX-${HOUR}` });
  });

  it("runs in the background on bootstrap and logs a failure", async () => {
    const { startup, prisma, logger } = setup([]);
    prisma.db.$queryRaw.mockRejectedValueOnce(new Error("db down"));
    startup.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "could not check the instrument masters on start");
    });
  });
});
