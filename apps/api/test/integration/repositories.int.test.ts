/**
 * The 0.5i repositories against a real database: SettingsRepository's row lock and scoping, AuditRepository's append
 * through the tenancy-guarded transaction client, and the AuditLog CHECKs it relies on.
 */
import { createPrismaClient } from "@finlytics/database";
import type { PrismaClient } from "@finlytics/database";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { prismaErrorInfo } from "../../src/common/problem-json/known-errors";
import { withTenancyGuard } from "../../src/infra/prisma/prisma.service";
import type { PrismaService, TenantPrismaClient } from "../../src/infra/prisma/prisma.service";
import { AuditRepository } from "../../src/modules/audit/audit.repository";
import type { AuditRow } from "../../src/modules/audit/audit.repository";
import { SettingsRepository } from "../../src/modules/settings/settings.repository";

import { createUser, fixturesClient } from "./fixtures";
import type { CreatedUser } from "./fixtures";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("repositories", () => {
  let base: PrismaClient;
  let db: TenantPrismaClient;
  let fixtures: PrismaClient;
  let settings: SettingsRepository;
  let alice: CreatedUser;
  let bob: CreatedUser;

  beforeAll(async () => {
    base = createPrismaClient({ url: inject("databaseUrl"), poolMax: 4 });
    db = withTenancyGuard(base);
    fixtures = fixturesClient();
    settings = new SettingsRepository({ db, unscoped: base } as unknown as PrismaService);
    alice = await createUser(fixtures);
    bob = await createUser(fixtures);
    await fixtures.user.update({ where: { id: bob.id }, data: { settings: { appearance: { theme: "dark" } } } });
  });

  afterAll(async () => {
    await base.$disconnect();
    await fixtures.$disconnect();
  });

  describe("SettingsRepository", () => {
    it("reads one user's settings, never another's, and nothing for a deleted user", async () => {
      const deleted = await createUser(fixtures, { deletedAt: new Date() });

      expect(await settings.find(alice.id)).toEqual({ settings: {} });
      expect(await settings.find(bob.id)).toEqual({ settings: { appearance: { theme: "dark" } } });
      expect(await settings.find(deleted.id)).toBeNull();
      expect(await db.$transaction((tx) => settings.lockForUpdate(tx, deleted.id))).toBeNull();
    });

    it("holds the row lock until the transaction ends", async () => {
      const events: string[] = [];
      let firstLocked: () => void = () => undefined;
      const locked = new Promise<void>((resolve) => (firstLocked = resolve));
      const holder = db.$transaction(async (tx) => {
        await settings.lockForUpdate(tx, alice.id);
        events.push("first locked");
        firstLocked();
        await sleep(400);
        await settings.save(tx, alice.id, { appearance: { theme: "light", density: "comfortable" } });
        events.push("first saved");
      });
      // Start the second transaction only once the first one holds the lock.
      await locked;
      const waiter = db.$transaction(async (tx) => {
        const row = await settings.lockForUpdate(tx, alice.id);
        events.push("second locked");
        return row;
      });

      const [, seen] = await Promise.all([holder, waiter]);

      expect(events).toEqual(["first locked", "first saved", "second locked"]);
      // The waiter reads the committed value, not the one from before the first transaction.
      expect(seen).toEqual({ settings: { appearance: { theme: "light", density: "comfortable" } } });
    });
  });

  describe("AuditRepository", () => {
    const repository = new AuditRepository();
    const row = (overrides: Partial<AuditRow> = {}): AuditRow => ({
      userId: alice.id,
      actorType: "user",
      actorId: alice.id,
      action: "settings.update",
      entityType: "User",
      entityId: alice.id,
      ip: "203.0.113.7",
      userAgent: "repo-test",
      requestId: "req-repo-0001",
      data: { changed: ["appearance.theme"] },
      ...overrides,
    });

    it("appends a row through the guarded transaction client and returns its BigInt id", async () => {
      const id = await db.$transaction((tx) => repository.insert(tx, row()));

      expect(typeof id).toBe("bigint");
      expect(
        await fixtures.auditLog.findUniqueOrThrow({ where: { id }, select: { actorId: true, data: true } }),
      ).toEqual({ actorId: alice.id, data: { changed: ["appearance.theme"] } });
    });

    it("leaves no row when the transaction rolls back", async () => {
      const requestId = "req-repo-rollback";
      await expect(
        db.$transaction(async (tx) => {
          await repository.insert(tx, row({ requestId }));
          throw new Error("the mutation failed");
        }),
      ).rejects.toThrow("the mutation failed");

      expect(await fixtures.auditLog.count({ where: { requestId } })).toBe(0);
    });

    it("is refused by the database for a user actor without actorId (CHECK 23514)", async () => {
      const failure: unknown = await db
        .$transaction((tx) => repository.insert(tx, row({ actorId: null, requestId: "req-repo-check" })))
        .catch((error: unknown) => error);

      expect(prismaErrorInfo(failure)?.sqlState).toBe("23514");
      expect(await fixtures.auditLog.count({ where: { requestId: "req-repo-check" } })).toBe(0);
    });
  });
});
