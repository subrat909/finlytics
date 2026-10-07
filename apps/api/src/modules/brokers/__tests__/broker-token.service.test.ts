import { BrokerUnavailableError, NeedsReloginError, Secret } from "@finlytics/broker-sdk";
import { describe, expect, it, vi } from "vitest";

import type { FakeBrokerScript } from "../../../../test/support/fake-broker";
import type { PrismaService, TenantTransaction } from "../../../infra/prisma/prisma.service";
import type { AuditService } from "../../audit/audit.service";
import { BrokerTokenService } from "../broker-token.service";
import { dataKeyOf } from "../brokers.service";

import { MemoryAccounts } from "./memory-accounts";
import { events as buildEvents, gateways as buildGateways, logger, vault as buildVault } from "./support";

const NOW = new Date("2026-10-06T10:00:00.000Z");
const HOUR = 3_600_000;
const RENEWED_EXPIRY = new Date(NOW.getTime() + 24 * HOUR);

const DHAN: FakeBrokerScript = {
  authMode: "token",
  validToken: "dhan-token-0123456789",
  renew: { token: "renewed-token-9876543210", expiresAt: RENEWED_EXPIRY },
};

async function setup(
  options: { script?: FakeBrokerScript; broker?: "DHAN" | "UPSTOX"; expiresAt?: Date | null; status?: string } = {},
) {
  const accounts = new MemoryAccounts();
  const vault = buildVault();
  const broker = options.broker ?? "DHAN";
  const { gateways, log } = buildGateways({ [broker]: options.script ?? DHAN });
  const timeline: string[] = [];
  const audit = {
    record: vi.fn<AuditService["record"]>(() => {
      timeline.push("audit");
      return Promise.resolve(1n);
    }),
  };
  const prisma = {
    db: {
      $transaction: vi.fn(async (work: (tx: TenantTransaction) => Promise<unknown>) => {
        const result = await work({} as TenantTransaction);
        timeline.push("commit");
        return result;
      }),
    },
  };
  const recorded = buildEvents();
  recorded.recorder.activated.mockImplementation((event) => {
    recorded.emitted.push({ name: "activated", event });
    timeline.push("activated");
  });
  recorded.recorder.deactivated.mockImplementation((event) => {
    recorded.emitted.push({ name: "deactivated", event });
    timeline.push("deactivated");
  });
  const scope = { userId: "alice", brokerAccountId: "acct1" };
  const dataKey = vault.createDataKey(scope);
  const sealed = vault.sealCredentials(scope, dataKey, { accessToken: Secret.of("old-token-0123"), clientId: "1100" });
  await accounts.repository.create(
    {},
    {
      id: "acct1",
      userId: "alice",
      broker,
      label: "Dhan main",
      status: options.status ?? "ACTIVE",
      isDefault: true,
      encKeyWrapped: dataKey.wrapped,
      encKeyIv: dataKey.iv,
      encryptedCredentials: sealed.ciphertext,
      credentialsIv: sealed.iv,
      tokenExpiresAt: options.expiresAt === undefined ? new Date(NOW.getTime() + 2 * HOUR) : options.expiresAt,
      lastError: "stale",
    },
  );
  const service = new BrokerTokenService(
    prisma as unknown as PrismaService,
    accounts.asRepository(),
    vault,
    gateways,
    audit as unknown as AuditService,
    recorded.events,
    logger(),
  );
  const opened = () => {
    const row = accounts.must("acct1");
    return vault.openCredentials(scope, dataKeyOf(row), {
      ciphertext: row.encryptedCredentials ?? new Uint8Array(),
      iv: row.credentialsIv ?? new Uint8Array(),
    });
  };
  return { service, accounts, audit, emitted: recorded.emitted, timeline, log, opened, firstIv: sealed.iv };
}

describe("BrokerTokenService.renew", () => {
  it("renews the token with the broker, re-seals it with a fresh IV and audits it", async () => {
    const { service, accounts, audit, emitted, timeline, log, opened, firstIv } = await setup();

    expect(await service.renew("alice", "acct1", NOW)).toBe("renewed");

    expect(log.calls).toEqual([{ method: "refreshToken", token: "old-token-0123" }]);
    const creds = opened();
    expect(creds.accessToken.reveal()).toBe("renewed-token-9876543210");
    expect(creds.clientId).toBe("1100");
    const row = accounts.must("acct1");
    expect(Buffer.from(row.credentialsIv ?? []).equals(Buffer.from(firstIv))).toBe(false);
    expect(row).toMatchObject({
      status: "ACTIVE",
      tokenExpiresAt: RENEWED_EXPIRY,
      expiryNotifiedAt: null,
      lastError: null,
    });
    expect(audit.record.mock.calls[0]?.[1]).toEqual({
      action: "broker.renew",
      actor: { type: "system" },
      subjectUserId: "alice",
      entity: { type: "BrokerAccount", id: "acct1" },
      data: { broker: "DHAN", tokenExpiresAt: RENEWED_EXPIRY.toISOString() },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("renewed-token");
    expect(timeline).toEqual(["audit", "commit", "activated"]);
    expect(emitted).toEqual([{ name: "activated", event: { userId: "alice", accountId: "acct1", broker: "DHAN" } }]);
  });

  it("gives a renewed token 24 hours when the broker doesn't say when it expires", async () => {
    const { service, accounts } = await setup({ script: { ...DHAN, renew: { token: "opaque-renewed-token" } } });

    expect(await service.renew("alice", "acct1", NOW)).toBe("renewed");
    expect(accounts.must("acct1").tokenExpiresAt).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });

  it("asks for a new login when the broker refuses the renewal", async () => {
    const { service, accounts, audit, emitted, timeline, opened } = await setup({
      script: { ...DHAN, renew: new NeedsReloginError("token invalid") },
    });

    expect(await service.renew("alice", "acct1", NOW)).toBe("relogin");

    expect(accounts.must("acct1")).toMatchObject({
      status: "NEEDS_RELOGIN",
      lastError: "The Dhan access token could not be renewed. Generate a new one on Dhan and connect again.",
      expiryNotifiedAt: NOW,
    });
    expect(opened().accessToken.reveal()).toBe("old-token-0123");
    expect(accounts.notifications).toEqual([
      expect.objectContaining({
        userId: "alice",
        title: "Log in to Dhan again",
        severity: "warning",
        data: { brokerAccountId: "acct1", broker: "DHAN" },
      }),
    ]);
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      action: "broker.expire",
      actor: { type: "system" },
      data: { broker: "DHAN", reason: "renew_refused" },
    });
    expect(timeline).toEqual(["audit", "commit", "deactivated"]);
    expect(emitted).toEqual([{ name: "deactivated", event: { userId: "alice", accountId: "acct1", broker: "DHAN" } }]);
  });

  it("doesn't call the broker for a token that has already expired", async () => {
    const { service, accounts, audit, log } = await setup({ expiresAt: new Date(NOW.getTime() - HOUR) });

    expect(await service.renew("alice", "acct1", NOW)).toBe("relogin");

    expect(log.calls).toEqual([]);
    expect(accounts.must("acct1")).toMatchObject({
      status: "NEEDS_RELOGIN",
      lastError: "The Dhan access token has expired. Generate a new one on Dhan and connect again.",
    });
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({ data: { reason: "expired" } });
  });

  it("leaves the account alone when the broker can't be reached", async () => {
    const { service, accounts, audit, emitted, opened } = await setup({
      script: { ...DHAN, renew: new BrokerUnavailableError("down") },
    });

    expect(await service.renew("alice", "acct1", NOW)).toBe("failed");

    expect(accounts.must("acct1").status).toBe("ACTIVE");
    expect(opened().accessToken.reveal()).toBe("old-token-0123");
    expect(audit.record).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("skips accounts that are gone, someone else's, not ACTIVE or not renewable", async () => {
    expect(await (await setup()).service.renew("bob", "acct1", NOW)).toBe("skipped");
    expect(await (await setup()).service.renew("alice", "missing", NOW)).toBe("skipped");
    expect(await (await setup({ status: "NEEDS_RELOGIN" })).service.renew("alice", "acct1", NOW)).toBe("skipped");
    const upstox = await setup({ broker: "UPSTOX", script: { authMode: "oauth", validCode: "c" } });
    expect(await upstox.service.renew("alice", "acct1", NOW)).toBe("skipped");
    expect(upstox.log.calls).toEqual([]);
  });

  it("never overwrites an account that changed while the broker was asked", async () => {
    const { service, accounts, audit, emitted } = await setup();
    const findSecrets = accounts.repository.findSecrets;
    accounts.repository.findSecrets = async (userId: string, id: string) => {
      const row = await findSecrets(userId, id);
      // The user pastes a new token meanwhile: the stored expiry moves.
      accounts.rows.set(id, { ...accounts.must(id), tokenExpiresAt: new Date(NOW.getTime() + 20 * HOUR) });
      return row;
    };

    expect(await service.renew("alice", "acct1", NOW)).toBe("skipped");
    expect(accounts.must("acct1").tokenExpiresAt).toEqual(new Date(NOW.getTime() + 20 * HOUR));
    expect(audit.record).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("doesn't flag an account that changed before the refusal was recorded", async () => {
    const { service, accounts, emitted } = await setup({
      script: { ...DHAN, renew: new NeedsReloginError("token invalid") },
    });
    const findSecrets = accounts.repository.findSecrets;
    accounts.repository.findSecrets = async (userId: string, id: string) => {
      const row = await findSecrets(userId, id);
      accounts.rows.set(id, { ...accounts.must(id), tokenExpiresAt: new Date(NOW.getTime() + 20 * HOUR) });
      return row;
    };

    expect(await service.renew("alice", "acct1", NOW)).toBe("skipped");
    expect(accounts.must("acct1").status).toBe("ACTIVE");
    expect(accounts.notifications).toEqual([]);
    expect(emitted).toEqual([]);
  });
});
