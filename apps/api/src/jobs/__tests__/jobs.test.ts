import type { Queue } from "bullmq";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../common/clock";
import type { PrismaService, TenantTransaction } from "../../infra/prisma/prisma.service";
import type { AuditService } from "../../modules/audit/audit.service";
import type { InstrumentMasterService } from "../../modules/instruments/instrument-master.service";
import type { BrokerTokenExpiryRepository, ExpiryCandidate } from "../broker-token-expiry.repository";
import { EXPIRY_SCAN_LIMIT } from "../broker-token-expiry.repository";
import { BrokerTokenExpiryProcessor } from "../broker-token-expiry.processor";
import { BrokerTokenExpiryService, istDate } from "../broker-token-expiry.service";
import { InstrumentMasterSyncProcessor } from "../instrument-master-sync.processor";
import { JobSchedulerService } from "../job-scheduler.service";

const NOW = new Date("2026-10-06T03:00:00.000Z"); // 08:30 IST
const logger = () => ({ setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as PinoLogger;

function candidate(id: string, broker: "UPSTOX" | "DHAN", tokenExpiresAt: Date): ExpiryCandidate {
  return { id, userId: `user-${id}`, broker, label: `Label ${id}`, tokenExpiresAt };
}

function setupExpiry(expired: ExpiryCandidate[], due: ExpiryCandidate[], unchanged: ReadonlySet<string> = new Set()) {
  const page =
    (items: ExpiryCandidate[]) =>
    (...args: (Date | string)[]) => {
      const last = args.at(-1);
      const afterId = typeof last === "string" ? last : "";
      return Promise.resolve(items.filter((item) => item.id > afterId).slice(0, 2));
    };
  const repository = {
    expired: vi.fn(page(expired)),
    dueForReminder: vi.fn(page(due)),
    markExpired: vi.fn((_tx: unknown, item: ExpiryCandidate) => Promise.resolve(!unchanged.has(item.id))),
    markReminded: vi.fn((_tx: unknown, item: ExpiryCandidate) => Promise.resolve(!unchanged.has(item.id))),
    notify: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn<AuditService["record"]>().mockResolvedValue(1n) };
  const prisma = { db: { $transaction: (work: (tx: TenantTransaction) => unknown) => work({} as TenantTransaction) } };
  const clock: Clock = { now: () => NOW };
  const service = new BrokerTokenExpiryService(
    prisma as unknown as PrismaService,
    repository as unknown as BrokerTokenExpiryRepository,
    audit as unknown as AuditService,
    clock,
    logger(),
  );
  return { service, repository, audit };
}

describe("BrokerTokenExpiryService", () => {
  it("moves expired accounts to NEEDS_RELOGIN with a notification and a system audit row", async () => {
    const expired = [
      candidate("a", "UPSTOX", new Date("2026-10-05T22:00:00.000Z")),
      candidate("b", "DHAN", new Date("2026-10-01T00:00:00.000Z")),
      candidate("c", "UPSTOX", new Date("2026-10-05T22:00:00.000Z")),
    ];
    const { service, repository, audit } = setupExpiry(expired, [], new Set(["c"]));

    expect(await service.run()).toEqual({ expired: 2, reminded: 0 });
    expect(repository.expired).toHaveBeenCalledTimes(3); // pages of 2, then an empty page
    expect(repository.notify.mock.calls[0]?.[2]).toMatchObject({
      title: "Log in to Upstox again",
      severity: "warning",
      data: { brokerAccountId: "a", broker: "UPSTOX" },
    });
    expect(repository.notify.mock.calls[1]?.[2]).toMatchObject({
      body: expect.stringContaining("Generate a new one") as unknown,
    });
    expect(audit.record.mock.calls.map(([, entry]) => entry)).toEqual([
      expect.objectContaining({
        action: "broker.expire",
        actor: { type: "system" },
        subjectUserId: "user-a",
      }) as unknown,
      expect.objectContaining({ action: "broker.expire", subjectUserId: "user-b" }) as unknown,
    ]);
  });

  it("reminds Dhan accounts once, three days before expiry", async () => {
    const due = [candidate("d", "DHAN", new Date("2026-10-08T00:00:00.000Z"))];
    const { service, repository } = setupExpiry([], due);

    expect(await service.run()).toEqual({ expired: 0, reminded: 1 });
    expect(repository.dueForReminder.mock.calls[0]?.[1]).toEqual(new Date("2026-10-09T03:00:00.000Z"));
    expect(repository.notify.mock.calls[0]?.[2]).toMatchObject({
      title: "Dhan access token expires soon",
      body: expect.stringContaining("08 Oct 2026") as unknown,
    });
  });

  it("formats IST dates and scans in bounded pages", () => {
    expect(istDate(new Date("2026-10-07T20:00:00.000Z"))).toBe("08 Oct 2026");
    expect(EXPIRY_SCAN_LIMIT).toBeGreaterThan(0);
  });

  it("runs from its processor", async () => {
    const { service } = setupExpiry([], []);
    expect(await new BrokerTokenExpiryProcessor(service).process()).toEqual({ expired: 0, reminded: 0 });
  });
});

describe("InstrumentMasterSyncProcessor", () => {
  function setupSync(failing: ReadonlySet<string> = new Set()) {
    const master = {
      syncableBrokers: () => ["UPSTOX", "DHAN"],
      sync: vi.fn((broker: string) =>
        failing.has(broker)
          ? Promise.reject(new Error("down"))
          : Promise.resolve({ broker, rows: 1, deactivated: 0, skippedDeactivation: false }),
      ),
    };
    return {
      master,
      processor: new InstrumentMasterSyncProcessor(master as unknown as InstrumentMasterService, logger()),
    };
  }

  it("syncs every syncable broker for the daily job, or the one asked for", async () => {
    const { master, processor } = setupSync();

    expect(await processor.process({ id: "1", data: {} })).toHaveLength(2);
    expect(await processor.process({ id: "2", data: { broker: "DHAN", requestedBy: "admin1" } })).toEqual([
      { broker: "DHAN", rows: 1, deactivated: 0, skippedDeactivation: false },
    ]);
    expect(master.sync).toHaveBeenCalledTimes(3);
  });

  it("keeps going past a failed broker, then fails the job for a retry", async () => {
    const { master, processor } = setupSync(new Set(["UPSTOX"]));

    await expect(processor.process({ id: "3", data: {} })).rejects.toThrow("failed for UPSTOX");
    expect(master.sync).toHaveBeenCalledWith("DHAN");
  });

  it("refuses an invalid payload", async () => {
    const { processor } = setupSync();
    await expect(processor.process({ id: "4", data: { broker: "NOPE" } })).rejects.toThrow();
  });
});

describe("JobSchedulerService", () => {
  it("registers both daily schedules in IST, idempotently by id", async () => {
    const sync = { upsertJobScheduler: vi.fn().mockResolvedValue({}) };
    const expiry = { upsertJobScheduler: vi.fn().mockResolvedValue({}) };
    const scheduler = new JobSchedulerService(sync as unknown as Queue, expiry as unknown as Queue, logger());

    await scheduler.schedule();

    expect(sync.upsertJobScheduler).toHaveBeenCalledWith(
      "instrument-master-sync:daily",
      { pattern: "0 8 * * *", tz: "Asia/Kolkata" },
      { name: "sync", data: {} },
    );
    expect(expiry.upsertJobScheduler).toHaveBeenCalledWith(
      "broker-token-expiry:daily",
      { pattern: "30 8 * * *", tz: "Asia/Kolkata" },
      { name: "check", data: {} },
    );
  });

  it("logs instead of crashing the boot when Redis is unreachable", async () => {
    const failing = { upsertJobScheduler: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const error = vi.fn();
    const log = { setContext: vi.fn(), error } as unknown as PinoLogger;
    const scheduler = new JobSchedulerService(failing as unknown as Queue, failing as unknown as Queue, log);

    scheduler.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
  });
});
