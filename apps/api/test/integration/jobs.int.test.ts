/**
 * The worker's jobs against the real database and Redis: WorkerModule boots (processors and schedules), the
 * broker-token-expiry run is idempotent, and the instrument-master sync imports a fake broker's master.
 */
import { Secret } from "@finlytics/broker-sdk";
import type { PrismaClient } from "@finlytics/database";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VaultService } from "../../src/infra/vault/vault.service";
import { QUEUE_NAMES } from "../../src/infra/queue/queue-names";
import { BrokerTokenExpiryService } from "../../src/jobs/broker-token-expiry.service";
import { WorkerModule } from "../../src/jobs/worker.module";
import { InstrumentMasterService } from "../../src/modules/instruments/instrument-master.service";

import { createBrokerTestApp, FAKE_SCRIPTS } from "./broker-app";
import type { BrokerTestApp } from "./broker-app";
import { createUser, fixturesClient, uniqueSuffix } from "./fixtures";

const TAG = `J${uniqueSuffix().toUpperCase()}`;
const DAY_MS = 86_400_000;

describe("jobs", () => {
  let testApp: BrokerTestApp;
  let fixtures: PrismaClient;

  beforeAll(async () => {
    testApp = await createBrokerTestApp(
      {
        ...FAKE_SCRIPTS,
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
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
  });

  /** An ACTIVE account written the way BrokersService writes it. */
  async function account(broker: "UPSTOX" | "DHAN", tokenExpiresAt: Date) {
    const user = await createUser(fixtures);
    const vault = testApp.app.get(VaultService);
    const id = `c${uniqueSuffix()}${uniqueSuffix()}`.slice(0, 25);
    const scope = { userId: user.id, brokerAccountId: id };
    const key = vault.createDataKey(scope);
    const creds = vault.sealCredentials(scope, key, { accessToken: Secret.of("tok") });
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

  it("registers the daily schedules", async () => {
    const queue = testApp.app.get<Queue>(getQueueToken(QUEUE_NAMES.brokerTokenExpiry));
    await expect
      .poll(async () => (await queue.getJobSchedulers()).map((scheduler) => scheduler.key))
      .toContain("broker-token-expiry:daily");
  });

  it("marks expired tokens NEEDS_RELOGIN and reminds Dhan users once, idempotently", async () => {
    const now = Date.now();
    const upstox = await account("UPSTOX", new Date(now - 5 * 3_600_000));
    const dhanSoon = await account("DHAN", new Date(now + 2 * DAY_MS));
    const dhanLater = await account("DHAN", new Date(now + 10 * DAY_MS));
    const service = testApp.app.get(BrokerTokenExpiryService);

    const first = await service.run();
    const second = await service.run();

    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(await fixtures.brokerAccount.findUnique({ where: { id: upstox.id }, select: { status: true } })).toEqual({
      status: "NEEDS_RELOGIN",
    });
    expect(await fixtures.brokerAccount.findUnique({ where: { id: dhanSoon.id }, select: { status: true } })).toEqual({
      status: "ACTIVE",
    });
    const notifications = await fixtures.notification.findMany({
      where: { userId: { in: [upstox.userId, dhanSoon.userId, dhanLater.userId] } },
      select: { userId: true, category: true, title: true },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications).toEqual(
      expect.arrayContaining([
        { userId: upstox.userId, category: "broker", title: "Log in to Upstox again" },
        { userId: dhanSoon.userId, category: "broker", title: "Dhan access token expires soon" },
      ]),
    );
    expect(second.expired + second.reminded).toBe(0);
    expect(
      await fixtures.auditLog.count({ where: { userId: upstox.userId, action: "broker.expire", actorType: "system" } }),
    ).toBe(1);
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
