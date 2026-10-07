/**
 * The worker's jobs against the real database and Redis: WorkerModule boots (processors and schedules), the
 * broker-token-expiry and broker-token-renew runs are idempotent and emit the broker account events, and the
 * instrument-master sync imports a fake broker's master.
 */
import { NeedsReloginError, Secret } from "@finlytics/broker-sdk";
import type { PrismaClient } from "@finlytics/database";
import { getQueueToken } from "@nestjs/bullmq";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VaultService } from "../../src/infra/vault/vault.service";
import { QUEUE_NAMES } from "../../src/infra/queue/queue-names";
import { BrokerTokenExpiryService } from "../../src/jobs/broker-token-expiry.service";
import { BrokerTokenRenewService } from "../../src/jobs/broker-token-renew.service";
import { WorkerModule } from "../../src/jobs/worker.module";
import { BROKER_ACCOUNT_EVENTS } from "../../src/modules/brokers/broker-events";
import type { BrokerAccountEvent } from "../../src/modules/brokers/broker-events";
import { dataKeyOf } from "../../src/modules/brokers/brokers.service";
import { InstrumentMasterService } from "../../src/modules/instruments/instrument-master.service";

import { createBrokerTestApp, FAKE_SCRIPTS } from "./broker-app";
import type { BrokerTestApp } from "./broker-app";
import { createUser, fixturesClient, uniqueSuffix } from "./fixtures";

const TAG = `J${uniqueSuffix().toUpperCase()}`;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The token the fake Dhan hands out on RenewToken (refused for the token below). */
const RENEWED_TOKEN = "renewed-dhan-token-0123456789";
const REFUSED_TOKEN = "refused-dhan-token";

describe("jobs", () => {
  let testApp: BrokerTestApp;
  let fixtures: PrismaClient;
  const events: { name: string; event: BrokerAccountEvent }[] = [];

  beforeAll(async () => {
    testApp = await createBrokerTestApp(
      {
        ...FAKE_SCRIPTS,
        DHAN: {
          ...FAKE_SCRIPTS.DHAN,
          renew: { token: RENEWED_TOKEN, expiresAt: new Date(Date.now() + DAY_MS) },
        },
        UPSTOX: {
          ...FAKE_SCRIPTS.UPSTOX,
          master: [1, 2, 3].map((index) => ({
            instrumentKey: `NSE_EQ|${TAG}${String(index)}`,
            brokerToken: `${TAG}-${String(index)}`,
            exchange: "NSE",
            segment: "EQ",
            tradingSymbol: `${TAG}${String(index)}`,
            name: `Job ${String(index)}`,
            lotSize: 1,
            tickSize: "0.05",
          })) as never,
        },
      },
      [WorkerModule],
    );
    fixtures = fixturesClient();
    const emitter = testApp.app.get(EventEmitter2);
    for (const name of Object.values(BROKER_ACCOUNT_EVENTS)) {
      emitter.on(name, (event: BrokerAccountEvent) => events.push({ name, event }));
    }
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
  });

  /** An ACTIVE account written the way BrokersService writes it. */
  async function account(broker: "UPSTOX" | "DHAN", tokenExpiresAt: Date, token = "tok") {
    const user = await createUser(fixtures);
    const vault = testApp.app.get(VaultService);
    const id = `c${uniqueSuffix()}${uniqueSuffix()}`.slice(0, 25);
    const scope = { userId: user.id, brokerAccountId: id };
    const key = vault.createDataKey(scope);
    const creds = vault.sealCredentials(scope, key, { accessToken: Secret.of(token), clientId: "1100" });
    await fixtures.brokerAccount.create({
      data: {
        id,
        userId: user.id,
        broker,
        label: "Job",
        status: "ACTIVE",
        encKeyWrapped: key.wrapped,
        encKeyIv: key.iv,
        encryptedCredentials: creds.ciphertext,
        credentialsIv: creds.iv,
        tokenExpiresAt,
      },
    });
    return { userId: user.id, id };
  }

  const statusOf = async (id: string) =>
    (await fixtures.brokerAccount.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  it("registers the daily schedules and the 30-minute token renewal", async () => {
    const queue = testApp.app.get<Queue>(getQueueToken(QUEUE_NAMES.brokerTokenExpiry));
    await expect
      .poll(async () => (await queue.getJobSchedulers()).map((scheduler) => scheduler.key))
      .toContain("broker-token-expiry:daily");
    const renew = testApp.app.get<Queue>(getQueueToken(QUEUE_NAMES.brokerTokenRenew));
    await expect
      .poll(async () => (await renew.getJobSchedulers()).map((scheduler) => scheduler.key))
      .toContain("broker-token-renew:30m");
  });

  it("marks expired tokens NEEDS_RELOGIN once, with a notification and a deactivated event", async () => {
    const now = Date.now();
    const upstox = await account("UPSTOX", new Date(now - 5 * HOUR_MS));
    const dhanLater = await account("DHAN", new Date(now + 10 * DAY_MS));
    const service = testApp.app.get(BrokerTokenExpiryService);

    const first = await service.run();
    const second = await service.run();

    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(await statusOf(upstox.id)).toBe("NEEDS_RELOGIN");
    expect(await statusOf(dhanLater.id)).toBe("ACTIVE");
    const notifications = await fixtures.notification.findMany({
      where: { userId: { in: [upstox.userId, dhanLater.userId] } },
      select: { userId: true, category: true, title: true },
    });
    expect(notifications).toEqual([{ userId: upstox.userId, category: "broker", title: "Log in to Upstox again" }]);
    expect(second.expired).toBe(0);
    expect(
      await fixtures.auditLog.count({ where: { userId: upstox.userId, action: "broker.expire", actorType: "system" } }),
    ).toBe(1);
    expect(events.filter((entry) => entry.event.accountId === upstox.id)).toEqual([
      { name: "broker.account.deactivated", event: { userId: upstox.userId, accountId: upstox.id, broker: "UPSTOX" } },
    ]);
  });

  it("renews Dhan tokens that expire within 3 hours, re-sealed, audited and idempotent", async () => {
    const now = Date.now();
    const due = await account("DHAN", new Date(now + 2 * HOUR_MS), "old-dhan-token-0123");
    const later = await account("DHAN", new Date(now + 10 * HOUR_MS), "later-dhan-token-0123");
    const before = await fixtures.brokerAccount.findUniqueOrThrow({ where: { id: due.id } });
    const service = testApp.app.get(BrokerTokenRenewService);

    const first = await service.run();
    const second = await service.run();

    expect(first.renewed).toBeGreaterThanOrEqual(1);
    const row = await fixtures.brokerAccount.findUniqueOrThrow({ where: { id: due.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.tokenExpiresAt?.getTime()).toBeGreaterThan(now + 20 * HOUR_MS);
    expect(Buffer.from(row.credentialsIv ?? []).equals(Buffer.from(before.credentialsIv ?? []))).toBe(false);
    expect(Buffer.from(row.encryptedCredentials ?? []).toString("latin1")).not.toContain(RENEWED_TOKEN);
    const vault = testApp.app.get(VaultService);
    const creds = vault.openCredentials({ userId: due.userId, brokerAccountId: due.id }, dataKeyOf(row), {
      ciphertext: row.encryptedCredentials ?? new Uint8Array(),
      iv: row.credentialsIv ?? new Uint8Array(),
    });
    expect(creds.accessToken.reveal()).toBe(RENEWED_TOKEN);
    expect(creds.clientId).toBe("1100");
    expect(testApp.log.calls).toContainEqual({ method: "refreshToken", token: "old-dhan-token-0123" });
    expect(testApp.log.calls.some((call) => call.token === "later-dhan-token-0123")).toBe(false);
    expect(second.renewed).toBe(0);
    const audits = await fixtures.auditLog.findMany({
      where: { userId: due.userId, action: "broker.renew" },
      select: { actorType: true, data: true },
    });
    expect(audits).toEqual([
      { actorType: "system", data: { broker: "DHAN", tokenExpiresAt: row.tokenExpiresAt?.toISOString() } },
    ]);
    expect(JSON.stringify(audits)).not.toContain(RENEWED_TOKEN);
    expect(events.filter((entry) => entry.event.accountId === due.id)).toEqual([
      { name: "broker.account.activated", event: { userId: due.userId, accountId: due.id, broker: "DHAN" } },
    ]);
    expect(await statusOf(later.id)).toBe("ACTIVE");
  });

  it("asks for a new login when Dhan refuses the renewal, or the token has already expired", async () => {
    const refusing = await createBrokerTestApp(
      { DHAN: { ...FAKE_SCRIPTS.DHAN, renew: new NeedsReloginError("token refused") } },
      [WorkerModule],
    );
    try {
      const now = Date.now();
      const refused = await account("DHAN", new Date(now + HOUR_MS), REFUSED_TOKEN);
      const expired = await account("DHAN", new Date(now - HOUR_MS));

      const summary = await refusing.app.get(BrokerTokenRenewService).run();

      expect(summary.relogin).toBeGreaterThanOrEqual(2);
      for (const id of [refused.id, expired.id]) {
        const row = await fixtures.brokerAccount.findUniqueOrThrow({
          where: { id },
          select: { status: true, lastError: true },
        });
        expect(row.status).toBe("NEEDS_RELOGIN");
        expect(row.lastError).toMatch(/^The Dhan access token (could not be renewed|has expired)\. /);
      }
      expect(refusing.log.calls.filter((call) => call.method === "refreshToken")).toEqual([
        { method: "refreshToken", token: REFUSED_TOKEN },
      ]);
      expect(
        await fixtures.notification.count({
          where: { userId: { in: [refused.userId, expired.userId] }, title: "Log in to Dhan again" },
        }),
      ).toBe(2);
    } finally {
      await refusing.close();
    }
  });

  it("imports a broker's instrument master", async () => {
    const summary = await testApp.app.get(InstrumentMasterService).sync("UPSTOX");

    expect(summary).toMatchObject({ broker: "UPSTOX", rows: 3 });
    expect(await fixtures.instrument.count({ where: { key: { startsWith: `NSE_EQ|${TAG}` }, isActive: true } })).toBe(
      3,
    );
    expect(await fixtures.instrumentBrokerToken.count({ where: { token: { startsWith: `${TAG}-` } } })).toBe(3);
  });
});
