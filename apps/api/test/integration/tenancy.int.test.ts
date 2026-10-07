/**
 * The tenancy guard against a real database (plan D14): scoped queries see one user's rows; unscoped ones never run;
 * the scoped forms the guard requires for child rows and the audit log are queries Prisma accepts.
 */
import { createPrismaClient } from "@finlytics/database";
import type { PrismaClient } from "@finlytics/database";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { TenancyViolationError } from "../../src/infra/prisma/tenancy.extension";
import { withTenancyGuard } from "../../src/infra/prisma/prisma.service";
import type { TenantPrismaClient } from "../../src/infra/prisma/prisma.service";
import { SessionRepository } from "../../src/modules/auth/session.repository";
import type { PrismaService } from "../../src/infra/prisma/prisma.service";

import { createSession, createUser, daysAgo, fixturesClient, uniqueSuffix } from "./fixtures";
import type { CreatedUser } from "./fixtures";

describe("tenancy guard", () => {
  let base: PrismaClient;
  let db: TenantPrismaClient;
  let fixtures: PrismaClient;
  let alice: CreatedUser;
  let bob: CreatedUser;

  beforeAll(async () => {
    base = createPrismaClient({ url: inject("databaseUrl"), poolMax: 2 });
    db = withTenancyGuard(base);
    fixtures = fixturesClient();
    alice = await createUser(fixtures);
    bob = await createUser(fixtures);
    await createSession(fixtures, alice.id);
    // Expired: a deleteMany of expired sessions that got past the guard would change the count below.
    await createSession(fixtures, alice.id, { expires: daysAgo(1) });
    await createSession(fixtures, bob.id);
  });

  afterAll(async () => {
    await base.$disconnect();
    await fixtures.$disconnect();
  });

  it("a scoped query never reads another user's rows", async () => {
    const rows = await db.session.findMany({ where: { userId: alice.id }, select: { userId: true } });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set([alice.id]));
    expect(await db.user.findUnique({ where: { id: bob.id }, select: { id: true } })).toEqual({ id: bob.id });
  });

  it("refuses unscoped reads, updates and deletes before they reach the database", async () => {
    await expect(db.session.findMany()).rejects.toBeInstanceOf(TenancyViolationError);
    // Prisma reads `undefined` as "no filter": the guard must not.
    await expect(db.session.count({ where: { userId: undefined as unknown as string } })).rejects.toBeInstanceOf(
      TenancyViolationError,
    );
    await expect(db.session.deleteMany({ where: { expires: { lt: new Date() } } })).rejects.toBeInstanceOf(
      TenancyViolationError,
    );
    await expect(db.user.findFirst({ where: { email: alice.email } })).rejects.toBeInstanceOf(TenancyViolationError);
    // Nothing was deleted.
    expect(await fixtures.session.count({ where: { userId: { in: [alice.id, bob.id] } } })).toBe(3);
  });

  it("scopes child rows through their parent, and the database refuses a parent of another user", async () => {
    const instrument = await fixtures.instrument.create({
      data: {
        key: `NSE_EQ|TENANCY${uniqueSuffix().toUpperCase()}`,
        exchange: "NSE",
        segment: "EQ",
        symbol: "TENANCY",
        name: "Tenancy Test Ltd",
        brokerTokens: {},
      },
      select: { key: true },
    });
    const alices = await fixtures.watchlist.create({ data: { userId: alice.id, name: `a-${uniqueSuffix()}` } });
    const bobs = await fixtures.watchlist.create({ data: { userId: bob.id, name: `b-${uniqueSuffix()}` } });
    await fixtures.watchlistItem.create({ data: { watchlistId: bobs.id, instrumentKey: instrument.key, position: 0 } });

    // The forms the guard requires are valid Prisma: a create connecting a parent by id and userId, a scoped read.
    await db.watchlistItem.create({
      data: {
        watchlist: { connect: { id: alices.id, userId: alice.id } },
        instrument: { connect: { key: instrument.key } },
        position: 0,
      },
    });
    const items = await db.watchlistItem.findMany({
      where: { watchlist: { userId: alice.id } },
      select: { watchlistId: true },
    });
    expect(items).toEqual([{ watchlistId: alices.id }]);

    // Bob's watchlist, claimed as Alice's: no parent matches, so nothing is created.
    await expect(
      db.watchlistItem.create({
        data: {
          watchlist: { connect: { id: bobs.id, userId: alice.id } },
          instrument: { connect: { key: instrument.key } },
          position: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2025" });
    await expect(db.watchlistItem.findMany({ where: { watchlistId: bobs.id } })).rejects.toBeInstanceOf(
      TenancyViolationError,
    );
    await expect(
      db.instrument.findUnique({ where: { key: instrument.key }, include: { watchlistItems: true } }),
    ).rejects.toBeInstanceOf(TenancyViolationError);
    expect(await fixtures.watchlistItem.count({ where: { watchlistId: bobs.id } })).toBe(1);
  });

  it("reads the audit log only by subject or actor", async () => {
    await fixtures.auditLog.create({
      data: { userId: alice.id, actorType: "user", actorId: alice.id, action: "settings.update" },
    });

    expect(await db.auditLog.count({ where: { actorId: alice.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: alice.id } })).toBe(1);
    await expect(db.auditLog.findMany({ where: { action: "settings.update" } })).rejects.toBeInstanceOf(
      TenancyViolationError,
    );
  });

  it("a scoped repository write can't touch another user's session", async () => {
    const repository = new SessionRepository({ db, unscoped: base } as unknown as PrismaService);
    const stale = daysAgo(1);
    const bobs = await createSession(fixtures, bob.id, { lastSeenAt: stale });

    // Alice's user id with Bob's session id: the userId filter matches nothing.
    await repository.touch(bobs.id, alice.id, new Date(), new Date());

    const row = await fixtures.session.findUniqueOrThrow({ where: { id: bobs.id }, select: { lastSeenAt: true } });
    expect(row.lastSeenAt).toEqual(stale);
  });
});
