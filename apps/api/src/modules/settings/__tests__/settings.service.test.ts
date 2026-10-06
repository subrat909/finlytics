import { DEFAULT_USER_SETTINGS, UserSettingsSchema } from "@finlytics/shared";
import type { UserSettings } from "@finlytics/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { RequestMetadata } from "../../../common/decorators/request-meta";
import { UnauthenticatedError } from "../../../common/problem-json/domain-errors";
import type { PrismaService, TenantTransaction } from "../../../infra/prisma/prisma.service";
import type { AuditService } from "../../audit/audit.service";
import type { SettingsRepository } from "../settings.repository";
import { changedPaths, mergeOverrides, SettingsService, storedOverrides } from "../settings.service";

const USER = "cm0user1";
const REQUEST: RequestMetadata = {
  requestId: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f",
  ip: "203.0.113.7",
  userAgent: "vitest",
};

function setup(stored: unknown = {}) {
  const tx = { tag: "the transaction" } as unknown as TenantTransaction;
  const calls: string[] = [];
  const repository = {
    find: vi.fn<SettingsRepository["find"]>().mockResolvedValue(stored === null ? null : { settings: stored }),
    lockForUpdate: vi.fn<SettingsRepository["lockForUpdate"]>(() => {
      calls.push("lock");
      return Promise.resolve(stored === null ? null : { settings: stored });
    }),
    save: vi.fn<SettingsRepository["save"]>(() => {
      calls.push("save");
      return Promise.resolve();
    }),
  };
  const audit = {
    record: vi.fn<AuditService["record"]>(() => {
      calls.push("audit");
      return Promise.resolve(1n);
    }),
  };
  const prisma = {
    db: {
      $transaction: vi.fn((work: (client: TenantTransaction) => Promise<unknown>) => {
        calls.push("begin");
        return work(tx).finally(() => calls.push("end"));
      }),
    },
  };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const service = new SettingsService(
    prisma as unknown as PrismaService,
    repository as unknown as SettingsRepository,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, repository, audit, prisma, logger, tx, calls };
}

describe("SettingsService.get", () => {
  it("returns defaults for an empty stored object", async () => {
    const { service, logger } = setup({});

    const settings = await service.get(USER);

    expect(settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(UserSettingsSchema.parse(settings)).toEqual(settings);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps stored values and fills the rest with defaults", async () => {
    const { service } = setup({ appearance: { theme: "dark" }, trading: { defaultQtyLots: 5 } });

    const settings = await service.get(USER);

    expect(settings.appearance).toEqual({ theme: "dark", density: "comfortable" });
    expect(settings.trading.defaultQtyLots).toBe(5);
    expect(settings.notifications).toEqual(DEFAULT_USER_SETTINGS.notifications);
  });

  it("logs the repaired paths", async () => {
    const { service, logger } = setup({ appearance: { theme: "neon" }, legacy: true });

    const settings = await service.get(USER);

    expect(settings.appearance.theme).toBe("system");
    expect(logger.warn).toHaveBeenCalledWith(
      {
        issues: [
          expect.stringMatching(/^appearance\.theme: /) as string,
          expect.stringMatching(/^\(root\): .*legacy/) as string,
        ],
        issueCount: 2,
      },
      "stored settings repaired with defaults",
    );
  });

  it("treats a user deleted since the session check like an ended session", async () => {
    const { service } = setup(null);

    await expect(service.get(USER)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("SettingsService.update", () => {
  it("merges inside one transaction under a row lock", async () => {
    const { service, repository, audit, tx, calls } = setup({ appearance: { theme: "dark" } });

    const result = await service.update(USER, { trading: { defaultQtyLots: 3 } }, REQUEST);

    expect(calls).toEqual(["begin", "lock", "save", "audit", "end"]);
    expect(repository.lockForUpdate).toHaveBeenCalledWith(tx, USER);
    const expected: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      appearance: { theme: "dark", density: "comfortable" },
      trading: { ...DEFAULT_USER_SETTINGS.trading, defaultQtyLots: 3 },
    };
    expect(result).toEqual(expected);
    expect(repository.save).toHaveBeenCalledWith(tx, USER, {
      appearance: { theme: "dark" },
      trading: { defaultQtyLots: 3 },
    });
    expect(audit.record.mock.calls[0]?.[0]).toBe(tx);
  });

  it("stores only the user's overrides, so defaults they never set can still change", async () => {
    const { service, repository } = setup({});

    const result = await service.update(USER, { notifications: { categories: { agent: { push: true } } } }, REQUEST);

    expect(result.notifications.categories.agent.push).toBe(true);
    expect(result.trading).toEqual(DEFAULT_USER_SETTINGS.trading);
    expect(repository.save).toHaveBeenCalledWith(expect.anything(), USER, {
      notifications: { categories: { agent: { push: true } } },
    });
  });

  it("keeps a value the user set to the current default, and audits it", async () => {
    const { service, repository, audit } = setup({});

    const result = await service.update(USER, { appearance: { theme: "system" } }, REQUEST);

    expect(result).toEqual(DEFAULT_USER_SETTINGS);
    expect(repository.save).toHaveBeenCalledWith(expect.anything(), USER, { appearance: { theme: "system" } });
    expect(audit.record.mock.calls[0]?.[1].data).toEqual({ changed: ["appearance.theme"] });
  });

  it("drops invalid and unknown stored fields when it writes, without auditing them", async () => {
    const { service, repository, audit } = setup({
      appearance: { theme: "neon", density: "compact" },
      trading: "oops",
      legacy: 1,
    });

    await service.update(USER, { trading: { defaultQtyLots: 2 } }, REQUEST);

    expect(repository.save).toHaveBeenCalledWith(expect.anything(), USER, {
      appearance: { density: "compact" },
      trading: { defaultQtyLots: 2 },
    });
    expect(audit.record.mock.calls[0]?.[1].data).toEqual({ changed: ["trading.defaultQtyLots"] });
  });

  it("audits the changed paths only", async () => {
    const { service, audit } = setup({ appearance: { theme: "dark" } });

    await service.update(
      USER,
      { appearance: { theme: "dark", density: "compact" }, notifications: { categories: { order: { push: false } } } },
      REQUEST,
    );

    expect(audit.record).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      action: "settings.update",
      actor: { type: "user", id: USER },
      subjectUserId: USER,
      entity: { type: "User", id: USER },
      request: REQUEST,
      data: { changed: ["appearance.density", "notifications.categories.order.push"] },
    });
  });

  it("writes nothing when the patch changes nothing", async () => {
    const { service, repository, audit } = setup({ appearance: { theme: "dark" } });

    const result = await service.update(USER, { appearance: { theme: "dark" } }, REQUEST);

    expect(result.appearance.theme).toBe("dark");
    expect(repository.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("refuses a deleted user without writing", async () => {
    const { service, repository, audit } = setup(null);

    await expect(service.update(USER, { appearance: { theme: "dark" } }, REQUEST)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("fails the whole patch when the audit row can't be written, so the transaction rolls back", async () => {
    const { service, audit } = setup({});
    const failure = new Error("audit insert failed");
    audit.record.mockRejectedValue(failure);

    await expect(service.update(USER, { appearance: { theme: "light" } }, REQUEST)).rejects.toBe(failure);
  });
});

describe("stored overrides", () => {
  it("keeps the stored fields the lenient read kept, and nothing else", () => {
    const stored = { appearance: { theme: "neon", density: "compact" }, notifications: { sound: false, x: 1 }, y: 2 };
    const settings = UserSettingsSchema.parse({
      ...DEFAULT_USER_SETTINGS,
      appearance: { theme: "system", density: "compact" },
      notifications: { ...DEFAULT_USER_SETTINGS.notifications, sound: false },
    });

    expect(storedOverrides(stored, settings)).toEqual({
      appearance: { density: "compact" },
      notifications: { sound: false },
    });
    for (const value of [{}, null, "oops", [1], { appearance: "flat" }]) {
      expect(storedOverrides(value, DEFAULT_USER_SETTINGS), JSON.stringify(value)).toEqual({});
    }
  });

  it("merges a patch into the overrides without empty sections or shared objects", () => {
    const overrides = { appearance: { theme: "dark" as const } };
    const merged = mergeOverrides(overrides, { appearance: { density: "compact" }, trading: {} });

    expect(merged).toEqual({ appearance: { theme: "dark", density: "compact" } });
    expect(overrides).toEqual({ appearance: { theme: "dark" } });
    expect(mergeOverrides({}, {})).toEqual({});
  });
});

describe("changedPaths", () => {
  it("lists the leaves that differ, as dot paths", () => {
    expect(changedPaths({ a: { b: 1, c: true } }, { a: { b: 2, c: true } })).toEqual(["a.b"]);
    expect(changedPaths({ a: 1 }, { a: 1 })).toEqual([]);
    expect(changedPaths({ a: { b: 1 } }, { a: { b: 1 }, d: "x" })).toEqual(["d"]);
    expect(changedPaths({ a: { b: 1 } }, { a: "flat" })).toEqual(["a"]);
    expect(changedPaths({}, { a: { b: 1, c: { d: true } } })).toEqual(["a.b", "a.c.d"]);
    expect(changedPaths({ a: { b: 1 } }, {})).toEqual(["a.b"]);
  });
});
