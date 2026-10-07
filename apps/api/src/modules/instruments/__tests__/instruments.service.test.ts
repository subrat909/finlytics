import { BrokerUnavailableError } from "@finlytics/broker-sdk";
import type { InstrumentRow } from "@finlytics/broker-sdk";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { Queue } from "bullmq";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../common/clock";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../common/problem-json/domain-errors";
import { PINNED_KEYS } from "../../../feed/pinned-keys";
import type { PrismaService, TenantTransaction } from "../../../infra/prisma/prisma.service";
import type { RedisService } from "../../../infra/redis/redis.service";
import type { AuthIdentity } from "../../auth/auth-identity";
import type { AuditService } from "../../audit/audit.service";
import { gateways as buildGateways, REQUEST } from "../../brokers/__tests__/support";
import { InstrumentMasterService, MASTER_BATCH_SIZE } from "../instrument-master.service";
import { modelToInstrument, toInstrument, trimDecimal } from "../instrument.mapper";
import type { InstrumentRecord } from "../instrument.mapper";
import type { InstrumentsRepository } from "../instruments.repository";
import { symbolOf } from "../instruments.repository";
import type { InstrumentSyncJobData } from "../instruments.service";
import { InstrumentsService } from "../instruments.service";
import { escapeLike, parseSearchTerms } from "../search-terms";

const NOW = new Date("2026-10-06T02:30:00.000Z");
const clock: Clock = { now: () => NOW };
const warn = vi.fn();
const logger = { setContext: vi.fn(), warn, info: vi.fn(), debug: vi.fn() } as unknown as PinoLogger;

/** A Redis client with GET and SET (EX) on a map. */
function fakeRedis(initial: Record<string, string> = {}) {
  const strings = new Map(Object.entries(initial));
  const client = {
    get: vi.fn((key: string) => Promise.resolve(strings.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      strings.set(key, value);
      return Promise.resolve("OK");
    }),
  };
  return { strings, client, service: { client } as unknown as RedisService };
}

const RELIANCE: InstrumentRecord = {
  key: "NSE_EQ|RELIANCE",
  exchange: "NSE",
  segment: "EQ",
  symbol: "RELIANCE",
  tradingSymbol: "RELIANCE",
  name: "Reliance Industries",
  expiry: null,
  strike: null,
  optionType: null,
  lotSize: 1,
  tickSize: "0.0500",
  isActive: true,
};

function row(index: number, overrides: Partial<InstrumentRow> = {}): InstrumentRow {
  return {
    instrumentKey: `NSE_EQ|SYM${String(index)}` as InstrumentRow["instrumentKey"],
    brokerToken: `tok-${String(index)}`,
    exchange: "NSE",
    segment: "EQ",
    tradingSymbol: `SYM${String(index)}`,
    name: `Symbol ${String(index)}`,
    lotSize: 1,
    tickSize: "0.05",
    ...overrides,
  };
}

describe("search terms", () => {
  it("keeps the raw text and reads option terms out of it", () => {
    expect(parseSearchTerms("  reliance  ")).toEqual({ raw: "RELIANCE", rawPattern: "RELIANCE" });
    expect(parseSearchTerms("nifty 25000 ce")).toEqual({
      raw: "NIFTY 25000 CE",
      rawPattern: "NIFTY 25000 CE",
      option: { underlyingPattern: "NIFTY", strike: "25000", optionType: "CE" },
    });
    expect(parseSearchTerms("banknifty put").option).toEqual({ underlyingPattern: "BANKNIFTY", optionType: "PE" });
    expect(parseSearchTerms("nifty 50").option).toEqual({ underlyingPattern: "NIFTY", strike: "50" });
    expect(parseSearchTerms("24000").option).toBeUndefined();
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
    expect(parseSearchTerms("m%").rawPattern).toBe("M\\%");
  });
});

describe("instrument mapper", () => {
  it("shows canonical decimals and dates", () => {
    expect(trimDecimal("25000.0000")).toBe("25000");
    expect(trimDecimal("0.0500")).toBe("0.05");
    expect(trimDecimal("12")).toBe("12");
    expect(toInstrument(RELIANCE).tickSize).toBe("0.05");
    expect(
      modelToInstrument({
        ...RELIANCE,
        segment: "OPT",
        expiry: new Date("2026-10-13T00:00:00.000Z"),
        strike: { toFixed: () => "25000.5" },
        optionType: "CE",
        tickSize: { toFixed: () => "0.05" },
      }),
    ).toMatchObject({ expiry: "2026-10-13", strike: "25000.5", tickSize: "0.05" });
    expect(symbolOf({ instrumentKey: "NSE_FO|NIFTY|2026-10-13" as InstrumentRow["instrumentKey"] })).toBe("NIFTY");
  });
});

function setupService(role: AuthIdentity["role"] = "ADMIN") {
  const repository = {
    search: vi.fn<InstrumentsRepository["search"]>().mockResolvedValue([RELIANCE]),
    findByKey: vi.fn<InstrumentsRepository["findByKey"]>((key) =>
      Promise.resolve(key === RELIANCE.key ? RELIANCE : null),
    ),
  };
  const lastSyncedAt = vi.fn<InstrumentMasterService["lastSyncedAt"]>().mockResolvedValue(null);
  const master = { syncableBrokers: () => ["UPSTOX", "DHAN"], lastSyncedAt } as unknown as InstrumentMasterService;
  const audit = { record: vi.fn<AuditService["record"]>().mockResolvedValue(1n) };
  const prisma = { db: { $transaction: (work: (tx: TenantTransaction) => unknown) => work({} as TenantTransaction) } };
  const queue = { add: vi.fn().mockResolvedValue({}) };
  const service = new InstrumentsService(
    repository as unknown as InstrumentsRepository,
    master,
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as Queue<InstrumentSyncJobData>,
    clock,
    logger,
  );
  const identity: AuthIdentity = { userId: "admin1", sessionId: "s", role };
  return { service, repository, audit, queue, identity, lastSyncedAt };
}

describe("InstrumentsService", () => {
  it("searches with parsed terms and filters", async () => {
    const { service, repository } = setupService();

    const result = await service.search({ q: "reli", limit: 5, exchange: "NSE" });

    expect(result).toEqual([toInstrument(RELIANCE)]);
    expect(repository.search).toHaveBeenCalledWith(
      { raw: "RELI", rawPattern: "RELI" },
      { exchange: "NSE", segment: undefined, limit: 5 },
    );
  });

  it("gets one instrument by its URL-encoded key, 400 for a bad key and 404 for an unknown one", async () => {
    const { service } = setupService();

    expect(await service.get("NSE_EQ%7CRELIANCE")).toEqual(toInstrument(RELIANCE));
    await expect(service.get("not-a-key")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.get("NSE_EQ|NOPE")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("queues one job per syncable broker for an admin, with a per-minute job id, and audits it", async () => {
    const { service, queue, audit, identity } = setupService();

    const result = await service.requestSync(identity, {}, REQUEST);

    const minute = String(Math.floor(NOW.getTime() / 60_000));
    expect(result.jobs).toEqual([
      { broker: "UPSTOX", jobId: `manual-UPSTOX-${minute}` },
      { broker: "DHAN", jobId: `manual-DHAN-${minute}` },
    ]);
    expect(queue.add).toHaveBeenCalledWith(
      "sync",
      { broker: "UPSTOX", requestedBy: "admin1" },
      { jobId: `manual-UPSTOX-${minute}` },
    );
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({ action: "instruments.sync", actor: { type: "admin" } });
  });

  it("queues the broker's master after an activation unless it synced in the last 20 hours", async () => {
    const { service, queue, lastSyncedAt } = setupService();
    const hour = String(Math.floor(NOW.getTime() / 3_600_000));

    expect(await service.queueIfStale("UPSTOX")).toBe(`activated-UPSTOX-${hour}`);
    expect(queue.add).toHaveBeenCalledWith("sync", { broker: "UPSTOX" }, { jobId: `activated-UPSTOX-${hour}` });

    lastSyncedAt.mockResolvedValueOnce(NOW.getTime() - 19 * 3_600_000);
    expect(await service.queueIfStale("DHAN")).toBeUndefined();
    lastSyncedAt.mockResolvedValueOnce(NOW.getTime() - 21 * 3_600_000);
    expect(await service.queueIfStale("DHAN")).toBe(`activated-DHAN-${hour}`);
  });

  it("listens to activations: ignores malformed payloads and brokers without a master, never throws", async () => {
    const { service, queue } = setupService();
    service.onBrokerAccountActivated({ nope: true });
    service.onBrokerAccountActivated({ userId: "u", accountId: "a", broker: "PAPER" });
    await Promise.resolve();
    expect(queue.add).not.toHaveBeenCalled();

    queue.add.mockRejectedValueOnce(new Error("redis down"));
    service.onBrokerAccountActivated({ userId: "u", accountId: "a", broker: "DHAN" });
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ broker: "DHAN" }),
        "could not queue the instrument master after an activation",
      );
    });
  });

  it("refuses non-admins and brokers without a master", async () => {
    const user = setupService("USER");
    await expect(user.service.requestSync(user.identity, {}, REQUEST)).rejects.toBeInstanceOf(ForbiddenError);
    expect(user.queue.add).not.toHaveBeenCalled();
    const admin = setupService();
    await expect(admin.service.requestSync(admin.identity, { broker: "PAPER" }, REQUEST)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("InstrumentMasterService", () => {
  function setupMaster(master: readonly InstrumentRow[], activeBefore = 0, failWith?: Error) {
    const { gateways } = buildGateways({
      UPSTOX: { authMode: "oauth", master, ...(failWith === undefined ? {} : { failWith }) },
      PAPER: { authMode: "none" },
    });
    const repository = {
      activeTokenCount: vi.fn().mockResolvedValue(activeBefore),
      upsertBatch: vi.fn().mockResolvedValue(undefined),
      deactivateMissing: vi.fn().mockResolvedValue(7),
      coveredKeys: vi.fn((_broker: string, keys: readonly string[]) => Promise.resolve(new Set(keys.slice(1)))),
    };
    const redis = fakeRedis();
    const events = { emit: vi.fn() };
    const service = new InstrumentMasterService(
      gateways,
      repository as unknown as InstrumentsRepository,
      clock,
      logger,
      redis.service,
      events as unknown as EventEmitter2,
    );
    return { service, repository, redis, events };
  }

  it("upserts in batches, then deactivates what the run didn't see", async () => {
    const rows = Array.from({ length: MASTER_BATCH_SIZE + 2 }, (_, index) => row(index));
    const { service, repository } = setupMaster(rows, 1_000);

    const summary = await service.sync("UPSTOX");

    expect(summary).toEqual({
      broker: "UPSTOX",
      rows: MASTER_BATCH_SIZE + 2,
      deactivated: 7,
      skippedDeactivation: false,
    });
    expect(repository.upsertBatch).toHaveBeenCalledTimes(2);
    expect(repository.upsertBatch.mock.calls[0]?.[2]).toBe(NOW);
    expect(repository.deactivateMissing).toHaveBeenCalledWith("UPSTOX", NOW);
    expect(service.syncableBrokers()).toEqual(["UPSTOX"]);
  });

  it("keeps the last row of a key and the first key of a token within one statement", async () => {
    const rows = [row(1), row(2), row(1, { name: "Renamed" }), row(3, { brokerToken: "tok-2" })];
    const { service, repository } = setupMaster(rows);

    expect(await service.sync("UPSTOX")).toMatchObject({ rows: 2 });
    const batch = repository.upsertBatch.mock.calls[0]?.[1] as InstrumentRow[];
    expect(batch.map((value) => [value.instrumentKey, value.name])).toEqual([
      ["NSE_EQ|SYM1", "Renamed"],
      ["NSE_EQ|SYM2", "Symbol 2"],
    ]);
  });

  it("deactivates nothing when the run looks incomplete", async () => {
    const { service, repository } = setupMaster([row(1)], 100);

    expect(await service.sync("UPSTOX")).toMatchObject({ rows: 1, deactivated: 0, skippedDeactivation: true });
    expect(repository.deactivateMissing).not.toHaveBeenCalled();
  });

  it("records the sync, tells the feed, and lists pinned keys without a token", async () => {
    const { service, redis, events } = setupMaster([row(1), row(2)], 0);

    await service.sync("UPSTOX");

    expect(redis.strings.get("instruments:synced:UPSTOX")).toBe(String(NOW.getTime()));
    const { set } = redis.client;
    expect(set).toHaveBeenCalledWith("instruments:synced:UPSTOX", String(NOW.getTime()), "EX", 604_800);
    expect(await service.lastSyncedAt("UPSTOX")).toBe(NOW.getTime());
    expect(await service.lastSyncedAt("DHAN")).toBeNull();
    expect(events.emit).toHaveBeenCalledWith("instruments.synced", { broker: "UPSTOX", rows: 2 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        broker: "UPSTOX",
        pinned: `${String(PINNED_KEYS.length - 1)}/${String(PINNED_KEYS.length)}`,
        missingPinned: [PINNED_KEYS[0]],
      }),
      "instrument master synced; some pinned keys have no token",
    );
  });

  it("records an incomplete run that stored rows, and survives a failing record or listener", async () => {
    const { service, repository, redis, events } = setupMaster([row(1)], 100);
    repository.coveredKeys.mockImplementation((_broker: string, keys: readonly string[]) =>
      Promise.resolve(new Set(keys)),
    );
    const { set } = redis.client;
    set.mockRejectedValueOnce(new Error("redis down"));
    events.emit.mockImplementationOnce(() => {
      throw new Error("listener failed");
    });

    expect(await service.sync("UPSTOX")).toMatchObject({ rows: 1, skippedDeactivation: true });
    expect(warn).toHaveBeenCalledWith(expect.anything(), "could not record the instrument master sync");
    expect(warn).toHaveBeenCalledWith(expect.anything(), "an instruments.synced listener failed");
  });

  it("maps a failed download to a broker problem", async () => {
    const { service, repository } = setupMaster([], 0, new BrokerUnavailableError("down"));

    await expect(service.sync("UPSTOX")).rejects.toMatchObject({ code: "BROKER_UNAVAILABLE" });
    expect(repository.deactivateMissing).not.toHaveBeenCalled();
  });
});
