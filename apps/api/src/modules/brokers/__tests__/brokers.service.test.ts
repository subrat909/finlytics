import { BrokerUnavailableError } from "@finlytics/broker-sdk";
import { BrokerAccountViewSchema } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../common/clock";
import { ForbiddenError, NotFoundError } from "../../../common/problem-json/domain-errors";
import type { PrismaService, TenantTransaction } from "../../../infra/prisma/prisma.service";
import type { AuthIdentity } from "../../auth/auth-identity";
import type { AuditService } from "../../audit/audit.service";
import { BrokerDomainError } from "../broker-errors";
import {
  BrokersService,
  MAX_PAPER_ACCOUNTS,
  newBrokerAccountId,
  paperLimitDetail,
  planLimitDetail,
} from "../brokers.service";
import type { OAuthStateRecord, OAuthStateService } from "../oauth-state.service";

import { MemoryAccounts } from "./memory-accounts";
import {
  config,
  events as buildEvents,
  gateways as buildGateways,
  logger,
  REQUEST,
  SCRIPTS,
  vault as buildVault,
} from "./support";

const ALICE: AuthIdentity = { userId: "user_alice", sessionId: "sess_alice", role: "USER" };
const BOB: AuthIdentity = { userId: "user_bob", sessionId: "sess_bob", role: "USER" };
const NOW = new Date("2026-10-06T10:00:00.000Z"); // 15:30 IST
const STATE = `${"n".repeat(43)}.${"s".repeat(43)}`;

/** A Dhan-style JWT with `exp`. */
function jwt(exp: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS512" })}.${part({ exp, dhanClientId: "1100" })}.signature`;
}

function setup(scripts: Parameters<typeof buildGateways>[0] = SCRIPTS) {
  const accounts = new MemoryAccounts();
  const vault = buildVault();
  const { gateways, log } = buildGateways(scripts);
  const states = new Map<string, OAuthStateRecord>();
  const oauth = {
    issue: vi.fn((record: OAuthStateRecord) => {
      states.set(STATE, record);
      return Promise.resolve(STATE);
    }),
    consume: vi.fn((state: string) => {
      const record = states.get(state) ?? null;
      states.delete(state);
      return Promise.resolve(record);
    }),
  };
  const audit = { record: vi.fn<AuditService["record"]>().mockResolvedValue(1n) };
  const tx = {} as TenantTransaction;
  /** Commits and emitted events, in order: an event must come after the commit of its change. */
  const timeline: string[] = [];
  const prisma = {
    db: {
      $transaction: vi.fn(async (work: (client: TenantTransaction) => Promise<unknown>) => {
        const result = await work(tx);
        timeline.push("commit");
        return result;
      }),
    },
  };
  const recorded = buildEvents();
  recorded.recorder.activated.mockImplementation((event) => {
    recorded.emitted.push({ name: "activated", event });
    timeline.push(`activated:${event.accountId}`);
  });
  recorded.recorder.deactivated.mockImplementation((event) => {
    recorded.emitted.push({ name: "deactivated", event });
    timeline.push(`deactivated:${event.accountId}`);
  });
  const clock: Clock = { now: () => NOW };
  const service = new BrokersService(
    prisma as unknown as PrismaService,
    accounts.asRepository(),
    vault,
    gateways,
    oauth as unknown as OAuthStateService,
    audit as unknown as AuditService,
    recorded.events,
    clock,
    config(),
    logger(),
  );
  return { service, accounts, vault, log, oauth, audit, states, emitted: recorded.emitted, timeline };
}

const upstoxBody = { label: "Main", apiKey: "app-key-1", apiSecret: "app-secret-1" };

describe("BrokersService: Upstox", () => {
  it("creates a PENDING account with the app encrypted, and returns the login URL with a signed state", async () => {
    const { service, accounts, vault, oauth, audit } = setup();

    const result = await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    expect(BrokerAccountViewSchema.parse(result.account)).toMatchObject({ status: "PENDING", broker: "UPSTOX" });
    const url = new URL(result.authUrl);
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("client_id")).toBe("app-key-1");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/v1/brokers/upstox/callback");
    expect(oauth.issue).toHaveBeenCalledWith({
      userId: ALICE.userId,
      sessionId: ALICE.sessionId,
      brokerAccountId: result.account.id,
      broker: "UPSTOX",
    });
    const row = accounts.get(result.account.id);
    expect(Buffer.from(row?.appCredentialsEnc ?? []).toString("utf8")).not.toContain("app-secret-1");
    const scope = { userId: ALICE.userId, brokerAccountId: result.account.id };
    const opened = vault.openJson(
      scope,
      { wrapped: row?.encKeyWrapped ?? new Uint8Array(), iv: row?.encKeyIv ?? new Uint8Array(), version: 1 },
      "appCredentials",
      { ciphertext: row?.appCredentialsEnc ?? new Uint8Array(), iv: row?.appCredentialsIv ?? new Uint8Array() },
    );
    expect(opened).toEqual({ apiKey: "app-key-1", apiSecret: "app-secret-1" });
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      action: "broker.connect",
      data: { broker: "UPSTOX", status: "PENDING", reconnect: false },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("app-secret-1");
  });

  it("restarts the login of an existing label without counting it against the plan", async () => {
    const { service, accounts } = setup();
    const first = await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    const second = await service.connectUpstox(ALICE, { ...upstoxBody, apiSecret: "rotated-secret" }, REQUEST);

    expect(second.account.id).toBe(first.account.id);
    expect(accounts.rows.size).toBe(1);
  });

  it("refuses a new account beyond the plan's limit, saying what the plan allows", async () => {
    const { service } = setup();
    await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    const refused = service.connectUpstox(ALICE, { ...upstoxBody, label: "Second" }, REQUEST);

    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    await expect(refused).rejects.toMatchObject({
      detail: "Your plan allows 1 broker account. Remove one or upgrade your plan to connect another.",
    });
  });

  it("allows as many broker accounts as the plan says (two on the free plan)", async () => {
    const { service, accounts } = setup();
    accounts.maxAccounts = 2;
    await service.connectUpstox(ALICE, upstoxBody, REQUEST);
    const dhan = await service.connectDhan(
      ALICE.userId,
      { label: "Dhan", clientId: "1100", accessToken: SCRIPTS.DHAN.validToken },
      REQUEST,
    );

    expect(dhan.status).toBe("ACTIVE");
    await expect(
      service.connectDhan(
        ALICE.userId,
        { label: "Dhan 2", clientId: "1100", accessToken: SCRIPTS.DHAN.validToken },
        REQUEST,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", detail: planLimitDetail(2) });
    expect(planLimitDetail(2)).toBe(
      "Your plan allows 2 broker accounts. Remove one or upgrade your plan to connect another.",
    );
  });

  it("is unavailable when no Upstox adapter is registered", async () => {
    const { service } = setup({ DHAN: SCRIPTS.DHAN });

    await expect(service.connectUpstox(ALICE, upstoxBody, REQUEST)).rejects.toMatchObject({
      code: "BROKER_UNAVAILABLE",
    });
  });

  it("activates the account on the callback, with the 03:30 IST expiry and as the default", async () => {
    const { service, accounts, vault, audit, timeline } = setup();
    const { account } = await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    const outcome = await service.upstoxCallback({ code: "good-code", state: STATE }, ALICE, REQUEST);

    expect(outcome.url).toBe(`http://localhost:3000/brokers?connected=${account.id}`);
    const row = accounts.get(account.id);
    expect(row).toMatchObject({ status: "ACTIVE", isDefault: true, lastError: null, lastLoginAt: NOW });
    expect(row?.tokenExpiresAt).toEqual(new Date("2026-10-06T22:00:00.000Z"));
    const scope = { userId: ALICE.userId, brokerAccountId: account.id };
    const dataKey = {
      wrapped: row?.encKeyWrapped ?? new Uint8Array(),
      iv: row?.encKeyIv ?? new Uint8Array(),
      version: 1,
    };
    const creds = vault.openCredentials(scope, dataKey, {
      ciphertext: row?.encryptedCredentials ?? new Uint8Array(),
      iv: row?.credentialsIv ?? new Uint8Array(),
    });
    expect(creds.accessToken.reveal()).toBe("token-good-code");
    expect(creds.clientId).toBe("UPX42");
    expect(
      vault.open(scope, dataKey, "clientId", {
        ciphertext: row?.brokerClientIdEnc ?? new Uint8Array(),
        iv: row?.brokerClientIdIv ?? new Uint8Array(),
      }),
    ).toBe("UPX42");
    expect(audit.record.mock.calls.at(-1)?.[1]).toMatchObject({ data: { status: "ACTIVE", reconnect: false } });
    expect(timeline.slice(-2)).toEqual(["commit", `activated:${account.id}`]);
  });

  it("rejects a malformed callback, an unknown or replayed state, and another session", async () => {
    const { service } = setup();
    await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    expect((await service.upstoxCallback({ state: STATE }, ALICE, REQUEST)).url).toContain("error=invalid_request");
    expect((await service.upstoxCallback({ code: "good-code", state: STATE }, BOB, REQUEST)).url).toContain(
      "error=session_mismatch",
    );
    // The state was consumed by the refused attempt: a replay finds nothing.
    expect((await service.upstoxCallback({ code: "good-code", state: STATE }, ALICE, REQUEST)).url).toContain(
      "error=state_invalid",
    );
  });

  it("refuses a callback without a session", async () => {
    const { service } = setup();
    await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    expect((await service.upstoxCallback({ code: "good-code", state: STATE }, null, REQUEST)).url).toContain(
      "error=session_mismatch",
    );
  });

  it("marks the account ERROR when Upstox rejects the code", async () => {
    const { service, accounts, emitted } = setup();
    const { account } = await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    const outcome = await service.upstoxCallback({ code: "bad-code", state: STATE }, ALICE, REQUEST);

    expect(emitted).toEqual([]);
    expect(outcome.url).toBe(`http://localhost:3000/brokers?error=broker_rejected&account=${account.id}`);
    expect(accounts.get(account.id)).toMatchObject({
      status: "ERROR",
      lastError: expect.stringContaining("did not accept") as unknown,
    });
  });

  it("reports an outage without activating", async () => {
    const { service, accounts } = setup({
      UPSTOX: { ...SCRIPTS.UPSTOX, failWith: new BrokerUnavailableError("down") },
    });
    const { account } = await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    const outcome = await service.upstoxCallback({ code: "good-code", state: STATE }, ALICE, REQUEST);

    expect(outcome.url).toContain("error=broker_unavailable");
    expect(accounts.get(account.id)?.status).toBe("ERROR");
  });

  it("treats a state whose account is gone as invalid", async () => {
    const { service, accounts } = setup();
    const { account } = await service.connectUpstox(ALICE, upstoxBody, REQUEST);
    accounts.rows.delete(account.id);

    expect((await service.upstoxCallback({ code: "good-code", state: STATE }, ALICE, REQUEST)).url).toContain(
      "error=state_invalid",
    );
  });

  it("gives a fresh login URL on relogin and audits it", async () => {
    const { service, audit } = setup();
    const { account } = await service.connectUpstox(ALICE, upstoxBody, REQUEST);

    const result = await service.relogin(ALICE, account.id, REQUEST);

    expect(new URL(result.authUrl).searchParams.get("state")).toBe(STATE);
    expect(audit.record.mock.calls.at(-1)?.[1]).toMatchObject({ action: "broker.relogin" });
    await expect(service.relogin(BOB, account.id, REQUEST)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("BrokersService: Dhan and paper", () => {
  const dhanBody = { label: "Dhan", clientId: "1100", accessToken: SCRIPTS.DHAN.validToken };

  it("validates the pasted token with the broker and stores it ACTIVE with the JWT's expiry", async () => {
    const exp = Math.floor(NOW.getTime() / 1_000) + 86_400;
    const token = jwt(exp);
    const { service, accounts, timeline, emitted } = setup({ DHAN: { authMode: "token", validToken: token } });

    const view = await service.connectDhan(ALICE.userId, { ...dhanBody, accessToken: token }, REQUEST);

    expect(view).toMatchObject({ broker: "DHAN", status: "ACTIVE", isDefault: true });
    expect(view.tokenExpiresAt).toBe(new Date(exp * 1_000).toISOString());
    expect(JSON.stringify(view)).not.toContain(token);
    expect(accounts.get(view.id)?.lastLoginAt).toEqual(NOW);
    expect(timeline).toEqual(["commit", `activated:${view.id}`]);
    expect(emitted).toEqual([
      { name: "activated", event: { userId: ALICE.userId, accountId: view.id, broker: "DHAN" } },
    ]);
    expect(JSON.stringify(emitted)).not.toContain(token);
  });

  it("defaults the expiry to 24 hours when the token doesn't carry one", async () => {
    const { service } = setup();

    const view = await service.connectDhan(ALICE.userId, dhanBody, REQUEST);

    expect(view.tokenExpiresAt).toBe(new Date(NOW.getTime() + 86_400_000).toISOString());
  });

  it("refuses a token Dhan rejects, and stores nothing", async () => {
    const { service, accounts, emitted } = setup();

    await expect(
      service.connectDhan(ALICE.userId, { ...dhanBody, accessToken: "wrong-token-000000" }, REQUEST),
    ).rejects.toMatchObject({ code: "BROKER_REJECTED" });
    expect(accounts.rows.size).toBe(0);
    expect(emitted).toEqual([]);
  });

  it("refuses a token that belongs to another client id", async () => {
    const { service } = setup({ DHAN: { ...SCRIPTS.DHAN, clientId: "9999" } });

    await expect(service.connectDhan(ALICE.userId, dhanBody, REQUEST)).rejects.toMatchObject({
      code: "BROKER_REJECTED",
      detail: expect.stringContaining("another Dhan client id") as unknown,
    });
  });

  it("connects without a typed client id, storing the one the profile names", async () => {
    const { service, accounts, vault, log } = setup({ DHAN: { ...SCRIPTS.DHAN, clientId: "1100777" } });

    const view = await service.connectDhan(
      ALICE.userId,
      { label: "Dhan", clientId: "", accessToken: SCRIPTS.DHAN.validToken },
      REQUEST,
    );

    expect(view.status).toBe("ACTIVE");
    expect(log.exchanges.at(-1)?.fields).toEqual({ accessToken: SCRIPTS.DHAN.validToken });
    const row = accounts.must(view.id);
    const scope = { userId: ALICE.userId, brokerAccountId: view.id };
    const dataKey = { wrapped: row.encKeyWrapped, iv: row.encKeyIv, version: row.encKeyVersion };
    expect(
      vault.open(scope, dataKey, "clientId", {
        ciphertext: row.brokerClientIdEnc ?? new Uint8Array(),
        iv: row.brokerClientIdIv ?? new Uint8Array(),
      }),
    ).toBe("1100777");
    expect(
      vault.openCredentials(scope, dataKey, {
        ciphertext: row.encryptedCredentials ?? new Uint8Array(),
        iv: row.credentialsIv ?? new Uint8Array(),
      }).clientId,
    ).toBe("1100777");
  });

  it("replaces the token of the same label (Dhan's re-login) and clears its error", async () => {
    const { service, accounts } = setup();
    const first = await service.connectDhan(ALICE.userId, dhanBody, REQUEST);
    accounts.rows.set(first.id, { ...accounts.must(first.id), status: "NEEDS_RELOGIN", lastError: "expired" });

    const second = await service.connectDhan(ALICE.userId, dhanBody, REQUEST);

    expect(second).toMatchObject({ id: first.id, status: "ACTIVE", lastError: null });
    expect(accounts.rows.size).toBe(1);
  });

  it("answers 422 to a Dhan or paper relogin", async () => {
    const { service } = setup();
    const dhan = await service.connectDhan(ALICE.userId, dhanBody, REQUEST);
    const paper = await service.connectPaper(ALICE.userId, { label: "Paper" }, REQUEST);

    await expect(service.relogin(ALICE, dhan.id, REQUEST)).rejects.toMatchObject({ code: "BROKER_REJECTED" });
    await expect(service.relogin(ALICE, paper.id, REQUEST)).rejects.toBeInstanceOf(BrokerDomainError);
  });

  it("connects paper accounts outside the broker limit, up to their own cap", async () => {
    const { service } = setup();
    await service.connectDhan(ALICE.userId, dhanBody, REQUEST);

    for (let index = 0; index < MAX_PAPER_ACCOUNTS; index += 1) {
      const view = await service.connectPaper(ALICE.userId, { label: `Paper ${String(index)}` }, REQUEST);
      expect(view).toMatchObject({ broker: "PAPER", status: "ACTIVE", tokenExpiresAt: null, isDefault: false });
    }
    await expect(service.connectPaper(ALICE.userId, { label: "One more" }, REQUEST)).rejects.toMatchObject({
      code: "FORBIDDEN",
      detail: paperLimitDetail(MAX_PAPER_ACCOUNTS),
    });
  });

  it("reports the plan's limits and the accounts that count against them", async () => {
    const { service, accounts } = setup();
    accounts.maxAccounts = 2;
    await service.connectDhan(ALICE.userId, dhanBody, REQUEST);
    await service.connectPaper(ALICE.userId, { label: "Paper" }, REQUEST);
    await service.connectPaper(BOB.userId, { label: "Not Alice's" }, REQUEST);

    expect(await service.limits(ALICE.userId)).toEqual({
      maxBrokerAccounts: 2,
      brokerAccounts: 1,
      maxPaperAccounts: MAX_PAPER_ACCOUNTS,
      paperAccounts: 1,
    });
  });

  it("emits nothing when the change doesn't commit", async () => {
    const { service, audit, emitted } = setup();
    audit.record.mockRejectedValueOnce(new Error("database down"));

    await expect(service.connectPaper(ALICE.userId, { label: "Paper" }, REQUEST)).rejects.toThrow("database down");
    expect(emitted).toEqual([]);
  });
});

describe("BrokersService: management", () => {
  it("lists only the user's own accounts", async () => {
    const { service } = setup();
    await service.connectPaper(ALICE.userId, { label: "A" }, REQUEST);
    await service.connectPaper(BOB.userId, { label: "B" }, REQUEST);

    expect((await service.list(ALICE.userId)).map((view) => view.label)).toEqual(["A"]);
  });

  it("renames and moves the default, auditing what changed", async () => {
    const { service, audit } = setup();
    const a = await service.connectPaper(ALICE.userId, { label: "A" }, REQUEST);
    const b = await service.connectPaper(ALICE.userId, { label: "B" }, REQUEST);

    const updated = await service.update(ALICE.userId, b.id, { label: "Bee", isDefault: true }, REQUEST);

    expect(updated).toMatchObject({ label: "Bee", isDefault: true });
    expect((await service.list(ALICE.userId)).find((view) => view.id === a.id)?.isDefault).toBe(false);
    expect(audit.record.mock.calls.at(-1)?.[1]).toMatchObject({
      action: "broker.update",
      data: { changed: ["label", "isDefault"] },
    });
  });

  it("writes nothing for a patch that changes nothing, and 404s for someone else's account", async () => {
    const { service, audit } = setup();
    const a = await service.connectPaper(ALICE.userId, { label: "A" }, REQUEST);
    const audits = audit.record.mock.calls.length;

    expect(await service.update(ALICE.userId, a.id, { label: "A" }, REQUEST)).toMatchObject({ label: "A" });
    expect(audit.record.mock.calls).toHaveLength(audits);
    await expect(service.update(BOB.userId, a.id, { label: "Mine" }, REQUEST)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes an account with an audit row and a deactivated event, and 404s for someone else's", async () => {
    const { service, accounts, audit, timeline, emitted } = setup();
    const a = await service.connectPaper(ALICE.userId, { label: "A" }, REQUEST);

    await expect(service.remove(BOB.userId, a.id, REQUEST)).rejects.toBeInstanceOf(NotFoundError);
    await service.remove(ALICE.userId, a.id, REQUEST);

    expect(accounts.rows.size).toBe(0);
    expect(audit.record.mock.calls.at(-1)?.[1]).toMatchObject({ action: "broker.delete", data: { broker: "PAPER" } });
    expect(timeline.slice(-2)).toEqual(["commit", `deactivated:${a.id}`]);
    expect(emitted.filter((entry) => entry.name === "deactivated")).toEqual([
      { name: "deactivated", event: { userId: ALICE.userId, accountId: a.id, broker: "PAPER" } },
    ]);
  });

  it("generates cuid-shaped ids", () => {
    expect(newBrokerAccountId()).toMatch(/^c[0-9a-f]{24}$/);
  });
});
