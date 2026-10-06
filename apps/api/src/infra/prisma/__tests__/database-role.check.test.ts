import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../../config/env.schema";
import { ReadinessState } from "../../lifecycle/readiness.state";
import { DatabaseRoleCheck, isSafeDatabaseRole, UnsafeDatabaseRoleError } from "../database-role.check";
import type { DatabaseRoleFacts } from "../database-role.check";
import type { PrismaService } from "../prisma.service";

const config = (values: Partial<Record<keyof Env, unknown>>) =>
  ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

/** A safe role's facts, with `overrides`. */
const SAFE: DatabaseRoleFacts = Object.freeze({
  superuser: false,
  memberOfSuperuser: false,
  serverFileAccess: false,
  canSetReplicationRole: false,
  ownsAuditLog: false,
});

describe("DatabaseRoleCheck", () => {
  /** The query's row for these facts. */
  const row = (overrides: Partial<DatabaseRoleFacts> = {}) => {
    const all = { ...SAFE, ...overrides };
    return [
      {
        superuser: all.superuser,
        member_of_superuser: all.memberOfSuperuser,
        server_file_access: all.serverFileAccess,
        can_set_replication_role: all.canSetReplicationRole,
        owns_audit_log: all.ownsAuditLog,
      },
    ];
  };
  const facts = (superuser: boolean, canSet: boolean) => row({ superuser, canSetReplicationRole: canSet });

  function check(rows: () => Promise<unknown>, nodeEnv: Env["NODE_ENV"] = "production") {
    const prisma = { unscoped: { $queryRaw: vi.fn(rows) } };
    const readiness = new ReadinessState(config({ NODE_ENV: nodeEnv }));
    const log = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
    return {
      roleCheck: new DatabaseRoleCheck(prisma as unknown as PrismaService, readiness, log as unknown as PinoLogger),
      readiness,
      prisma,
      log,
    };
  }

  it("refuses a superuser, a member of one, server-file access and SET session_replication_role", () => {
    expect(isSafeDatabaseRole(SAFE)).toBe(true);
    for (const unsafe of ["superuser", "memberOfSuperuser", "serverFileAccess", "canSetReplicationRole"] as const) {
      expect(isSafeDatabaseRole({ ...SAFE, [unsafe]: true }), unsafe).toBe(false);
    }
    // Owning AuditLog is warned about, never refused (the app role may own what it migrated until 2.1).
    expect(isSafeDatabaseRole({ ...SAFE, ownsAuditLog: true })).toBe(true);
  });

  it("reads every fact from one query", async () => {
    const { roleCheck } = check(() => Promise.resolve(row({ memberOfSuperuser: true, ownsAuditLog: true })));

    await expect(roleCheck.inspect()).resolves.toEqual({ ...SAFE, memberOfSuperuser: true, ownsAuditLog: true });
  });

  it("refuses a role that is a member of a superuser role or may run server programs", async () => {
    for (const unsafe of [{ memberOfSuperuser: true }, { serverFileAccess: true }]) {
      const { roleCheck, readiness } = check(() => Promise.resolve(row(unsafe)));

      await expect(roleCheck.enforce({ retryForMs: 0 }), JSON.stringify(unsafe)).rejects.toBeInstanceOf(
        UnsafeDatabaseRoleError,
      );
      expect(readiness.isRoleCheckPending).toBe(true);
    }
  });

  it("warns, without refusing, when the role owns AuditLog", async () => {
    const production = check(() => Promise.resolve(row({ ownsAuditLog: true })));
    await production.roleCheck.enforce({ retryForMs: 0 });
    expect(production.readiness.isRoleCheckPending).toBe(false);
    expect(production.log.warn).toHaveBeenCalledWith(expect.stringContaining("owns AuditLog"));

    const development = check(() => Promise.resolve(row({ ownsAuditLog: true })), "development");
    await development.roleCheck.warnIfUnsafe();
    expect(development.log.warn).toHaveBeenCalledWith(expect.stringContaining("owns AuditLog"));
  });

  it("marks readiness when a safe role passes, and refuses an unsafe one at once", async () => {
    const safe = check(() => Promise.resolve(facts(false, false)));
    await safe.roleCheck.enforce();
    expect(safe.readiness.isRoleCheckPending).toBe(false);

    const unsafe = check(() => Promise.resolve(facts(true, true)));
    await expect(unsafe.roleCheck.enforce({ retryForMs: 10_000 })).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    expect(unsafe.prisma.unscoped.$queryRaw).toHaveBeenCalledOnce();
    expect(unsafe.readiness.isRoleCheckPending).toBe(true);
  });

  it("retries while the database is unreachable, then gives up", async () => {
    let calls = 0;
    const flaky = check(() =>
      ++calls < 3 ? Promise.reject(new Error("ECONNREFUSED")) : Promise.resolve(facts(false, false)),
    );
    await flaky.roleCheck.enforce({ retryForMs: 1_000, initialDelayMs: 1 });
    expect(calls).toBe(3);

    const down = check(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(down.roleCheck.enforce({ retryForMs: 20, initialDelayMs: 5 })).rejects.toThrow("ECONNREFUSED");
    await expect(check(() => Promise.resolve([])).roleCheck.inspect()).rejects.toThrow(/no row/);
  });

  it("only warns outside production", async () => {
    const unsafe = check(() => Promise.resolve(facts(true, true)), "development");
    await unsafe.roleCheck.warnIfUnsafe();
    expect(unsafe.log.warn).toHaveBeenCalledWith(
      { facts: { ...SAFE, superuser: true, canSetReplicationRole: true } },
      expect.stringContaining("production would refuse to start"),
    );

    const down = check(() => Promise.reject(new Error("down")), "development");
    await expect(down.roleCheck.warnIfUnsafe()).resolves.toBeUndefined();
    const safe = check(() => Promise.resolve(facts(false, false)), "development");
    await safe.roleCheck.warnIfUnsafe();
    expect(safe.log.warn).not.toHaveBeenCalled();
  });
});
