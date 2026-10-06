import { beforeAll, describe, expect, it } from "vitest";

import type { Prisma, PrismaClient } from "../../src/index";
import { connect, createMigratedDatabase, databaseError, sharedDatabaseUrl, uniqueSuffix, withClient } from "./harness";

/** SQLSTATE check_violation. */
const CHECK_VIOLATION = "23514";

/**
 * Runs `work` in a transaction with session_replication_role = replica, the mode in which triggers that are not
 * ENABLE ALWAYS do not fire. SET LOCAL ends with the transaction, so the setting never leaks into the connection pool.
 * Before `work`, it appends the role the transaction actually sees to `roles`, so a test can prove the mode was in
 * effect. Rejects with whatever `work` throws. Needs a superuser, which the container's user is.
 */
async function inReplicaMode(
  prisma: PrismaClient,
  roles: string[],
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    const rows = await tx.$queryRaw<{ role: string }[]>`SELECT current_setting('session_replication_role') AS role`;
    roles.push(rows[0]?.role ?? "(no row)");
    await work(tx);
  });
}

describe("database guards (migrations/<timestamp>_db_guards and <timestamp>_kill_switch_and_audit_guards)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = connect(sharedDatabaseUrl());
    return async () => {
      await prisma.$disconnect();
    };
  });

  it("rejects UPDATE, DELETE and TRUNCATE on AuditLog", async () => {
    const entry = await prisma.auditLog.create({
      data: { actorType: "system", action: `test.guard.${uniqueSuffix()}`, data: { note: "append-only check" } },
    });

    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow(
      "AuditLog is append-only (UPDATE rejected)",
    );
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      "AuditLog is append-only (DELETE rejected)",
    );
    await expect(prisma.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(
      "AuditLog is append-only (TRUNCATE rejected)",
    );
    expect(await prisma.auditLog.findUnique({ where: { id: entry.id } })).toEqual(entry);
  });

  it("rejects UPDATE, DELETE and TRUNCATE on AuditLog even with session_replication_role = replica", async () => {
    const entry = await prisma.auditLog.create({
      data: { actorType: "system", action: `test.guard.${uniqueSuffix()}`, data: { note: "replica-mode check" } },
    });
    const roles: string[] = [];

    await expect(
      inReplicaMode(prisma, roles, (tx) =>
        tx.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } }),
      ),
    ).rejects.toThrow("AuditLog is append-only (UPDATE rejected)");
    await expect(inReplicaMode(prisma, roles, (tx) => tx.auditLog.delete({ where: { id: entry.id } }))).rejects.toThrow(
      "AuditLog is append-only (DELETE rejected)",
    );
    await expect(inReplicaMode(prisma, roles, (tx) => tx.$executeRaw`TRUNCATE "AuditLog"`)).rejects.toThrow(
      "AuditLog is append-only (TRUNCATE rejected)",
    );

    // Every attempt ran in replica mode, which skips the triggers unless they are ENABLE ALWAYS.
    expect(roles).toEqual(["replica", "replica", "replica"]);
    expect(await prisma.auditLog.findUnique({ where: { id: entry.id } })).toEqual(entry);
  });

  it("deletes a user who has audit rows and keeps their userId", async () => {
    const user = await prisma.user.create({ data: { email: `audited-${uniqueSuffix()}@example.test` } });
    await prisma.auditLog.create({
      data: { userId: user.id, actorType: "user", actorId: user.id, action: "test.signin" },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(
      await prisma.auditLog.findMany({ where: { userId: user.id }, select: { userId: true, action: true } }),
    ).toEqual([{ userId: user.id, action: "test.signin" }]);
  });

  it("rejects an audit row whose actorType is unknown", async () => {
    const action = `test.actor.${uniqueSuffix()}`;
    const attempts = ["service", "User", "", "system "].map((actorType) =>
      prisma.auditLog
        .create({ data: { actorType, actorId: "actor-1", action } })
        .then(() => undefined)
        .catch(databaseError),
    );

    const failures = await Promise.all(attempts);

    expect(failures).toHaveLength(4);
    for (const failure of failures) {
      expect(failure).toMatchObject({
        sqlState: CHECK_VIOLATION,
        message: 'new row for relation "AuditLog" violates check constraint "AuditLog_actorType_check"',
      });
    }
    expect(await prisma.auditLog.count({ where: { action } })).toBe(0);
  });

  it("requires actorId unless actorType is system", async () => {
    const action = `test.actor.${uniqueSuffix()}`;

    const unnamed = await Promise.all(
      ["user", "admin", "agent"].map((actorType) =>
        prisma.auditLog
          .create({ data: { actorType, action } })
          .then(() => undefined)
          .catch(databaseError),
      ),
    );
    // Every kind of actor is accepted once it is named; the system needs no name.
    for (const actorType of ["user", "admin", "agent"]) {
      await prisma.auditLog.create({ data: { actorType, actorId: `${actorType}-1`, action } });
    }
    await prisma.auditLog.create({ data: { actorType: "system", action } });

    expect(unnamed.map((failure) => failure?.message)).toEqual(
      Array.from(
        { length: 3 },
        () => 'new row for relation "AuditLog" violates check constraint "AuditLog_actorId_check"',
      ),
    );
    expect(
      await prisma.auditLog.findMany({
        where: { action },
        select: { actorType: true, actorId: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual([
      { actorType: "user", actorId: "user-1" },
      { actorType: "admin", actorId: "admin-1" },
      { actorType: "agent", actorId: "agent-1" },
      { actorType: "system", actorId: null },
    ]);
  });

  it("keeps the actor checks with session_replication_role = replica", async () => {
    // Replica mode skips triggers that are not ENABLE ALWAYS, and foreign keys, but never CHECK constraints.
    const action = `test.actor.${uniqueSuffix()}`;
    const roles: string[] = [];

    await expect(
      inReplicaMode(prisma, roles, (tx) =>
        tx.auditLog.create({ data: { actorType: "service", actorId: "x", action } }),
      ),
    ).rejects.toThrow("AuditLog_actorType_check");
    await expect(
      inReplicaMode(prisma, roles, (tx) => tx.auditLog.create({ data: { actorType: "agent", action } })),
    ).rejects.toThrow("AuditLog_actorId_check");

    expect(roles).toEqual(["replica", "replica"]);
    expect(await prisma.auditLog.count({ where: { action } })).toBe(0);
  });

  it("stores emails and verification identifiers only in lowercase, also in replica mode", async () => {
    const local = `case-${uniqueSuffix()}`;
    const roles: string[] = [];
    const lowercaseViolation = (table: string, constraint: string) => ({
      sqlState: CHECK_VIOLATION,
      message: `new row for relation "${table}" violates check constraint "${constraint}"`,
    });

    const mixed: unknown = await prisma.user
      .create({ data: { email: `${local}@Example.test` } })
      .catch((error: unknown) => error);
    const user = await prisma.user.create({ data: { email: `${local}@example.test` }, select: { id: true } });
    const renamed: unknown = await prisma.user
      .update({ where: { id: user.id }, data: { email: `${local.toUpperCase()}@example.test` } })
      .catch((error: unknown) => error);
    const identifier: unknown = await prisma.verificationToken
      .create({ data: { identifier: `${local}@EXAMPLE.test`, token: `t-${local}`, expires: new Date() } })
      .catch((error: unknown) => error);
    await prisma.verificationToken.create({
      data: { identifier: `${local}@example.test`, token: `t2-${local}`, expires: new Date() },
    });

    expect(databaseError(mixed)).toMatchObject(lowercaseViolation("User", "User_email_lowercase_check"));
    expect(databaseError(renamed)).toMatchObject(lowercaseViolation("User", "User_email_lowercase_check"));
    expect(databaseError(identifier)).toMatchObject(
      lowercaseViolation("VerificationToken", "VerificationToken_identifier_lowercase_check"),
    );
    // CHECK constraints hold in replica mode, unlike triggers and foreign keys.
    await expect(
      inReplicaMode(prisma, roles, (tx) => tx.user.create({ data: { email: `${local}-replica@Example.test` } })),
    ).rejects.toThrow("User_email_lowercase_check");
    expect(roles).toEqual(["replica"]);
    expect(await prisma.user.findMany({ where: { email: { startsWith: local } }, select: { email: true } })).toEqual([
      { email: `${local}@example.test` },
    ]);
    expect(await prisma.verificationToken.count({ where: { identifier: { startsWith: local } } })).toBe(1);
  });

  it("rejects a second GlobalControl row", async () => {
    // Create-only, as the seed does: whatever state row 1 is in stays untouched.
    await prisma.globalControl.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

    const failure: unknown = await prisma.globalControl.create({ data: { id: 2 } }).catch((error: unknown) => error);

    expect(databaseError(failure)).toMatchObject({
      sqlState: CHECK_VIOLATION,
      message: 'new row for relation "GlobalControl" violates check constraint "GlobalControl_singleton"',
    });
    expect(await prisma.globalControl.findMany({ select: { id: true } })).toEqual([{ id: 1 }]);
  });

  it("rejects deleting or truncating the GlobalControl row, but allows toggling the kill switch", async () => {
    // A database of its own: TRUNCATE "User" CASCADE below would empty every user-owned table of the shared one.
    const database = await createMigratedDatabase("global_control");

    await withClient(database.url, async (db) => {
      // The row as the seed creates it, plus a user for the cascading truncate to remove.
      await db.globalControl.create({ data: { id: 1 } });
      await db.user.create({ data: { email: `kill-switch-${uniqueSuffix()}@example.test` } });
      const roles: string[] = [];

      await expect(db.globalControl.delete({ where: { id: 1 } })).rejects.toThrow(
        "GlobalControl is permanent (DELETE rejected)",
      );
      await expect(db.$executeRaw`TRUNCATE "GlobalControl"`).rejects.toThrow(
        "GlobalControl is permanent (TRUNCATE rejected)",
      );
      await expect(inReplicaMode(db, roles, (tx) => tx.globalControl.deleteMany())).rejects.toThrow(
        "GlobalControl is permanent (DELETE rejected)",
      );
      await expect(inReplicaMode(db, roles, (tx) => tx.$executeRaw`TRUNCATE "GlobalControl"`)).rejects.toThrow(
        "GlobalControl is permanent (TRUNCATE rejected)",
      );
      // No foreign key touches GlobalControl, so a cascading truncate never reaches it (or its TRUNCATE trigger, which
      // would fail the whole statement).
      await db.$executeRaw`TRUNCATE "User" CASCADE`;
      const engaged = await db.globalControl.update({
        where: { id: 1 },
        data: { killSwitch: true, reason: "engaged by an operator during an incident" },
      });
      const released = await db.globalControl.update({ where: { id: 1 }, data: { killSwitch: false, reason: null } });

      expect(roles).toEqual(["replica", "replica"]);
      expect(await db.user.count()).toBe(0);
      expect(engaged).toMatchObject({ id: 1, killSwitch: true, reason: "engaged by an operator during an incident" });
      expect(released).toMatchObject({ id: 1, killSwitch: false, reason: null });
      expect(await db.globalControl.findMany()).toEqual([released]);
    });
  });
});
