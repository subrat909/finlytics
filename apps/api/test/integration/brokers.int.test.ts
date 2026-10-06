/**
 * `/v1/brokers` end to end with fake adapters behind the real registry → gateway path: the vault round trip and AAD
 * binding, ownership (IDOR), the plan limit, the Upstox OAuth callback (state replay, another session) and audit rows.
 */
import type { PrismaClient } from "@finlytics/database";
import { BrokerAccountListSchema, BrokerAccountViewSchema, ProblemDetailsSchema } from "@finlytics/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BrokerAccessService } from "../../src/modules/brokers/broker-access.service";
import { dataKeyOf } from "../../src/modules/brokers/brokers.service";
import { VaultError, VaultService } from "../../src/infra/vault/vault.service";

import { json } from "./app";
import { createBrokerTestApp } from "./broker-app";
import type { BrokerTestApp } from "./broker-app";
import { createSession, createUser, fixturesClient, sessionCookie } from "./fixtures";
import type { CreatedUser } from "./fixtures";

interface SignedIn {
  readonly user: CreatedUser;
  readonly cookie: string;
}

describe("brokers", () => {
  let testApp: BrokerTestApp;
  let fixtures: PrismaClient;

  beforeAll(async () => {
    testApp = await createBrokerTestApp();
    fixtures = fixturesClient();
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
  });

  const signedIn = async (): Promise<SignedIn> => {
    const user = await createUser(fixtures);
    return { user, cookie: sessionCookie((await createSession(fixtures, user.id)).token) };
  };

  const post = (cookie: string, url: string, body: unknown) =>
    testApp.request({
      method: "POST",
      url,
      headers: { cookie, "content-type": "application/json" },
      payload: JSON.stringify(body),
    });

  const callback = (query: string, cookie?: string) =>
    testApp.request({
      method: "GET",
      url: `/v1/brokers/upstox/callback?${query}`,
      headers: cookie === undefined ? {} : { cookie },
    });

  const startUpstox = async (who: SignedIn, label = "Main") => {
    const response = await post(who.cookie, "/v1/brokers/upstox", {
      label,
      apiKey: "app-key-1",
      apiSecret: "app-secret-1",
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = json(response) as { account: { id: string }; authUrl: string };
    const state = new URL(body.authUrl).searchParams.get("state") ?? "";
    return { id: body.account.id, state, authUrl: body.authUrl };
  };

  it("connects Upstox through the OAuth callback and never shows credentials", async () => {
    const alice = await signedIn();
    const { id, state, authUrl } = await startUpstox(alice);
    expect(new URL(authUrl).searchParams.get("redirect_uri")).toBe("http://localhost:3000/v1/brokers/upstox/callback");

    const response = await callback(`code=good-code&state=${encodeURIComponent(state)}`, alice.cookie);

    expect(response.statusCode, response.body).toBe(302);
    expect(response.headers.location).toBe(`http://localhost:3000/brokers?connected=${id}`);
    const list = await testApp.request({ method: "GET", url: "/v1/brokers", headers: { cookie: alice.cookie } });
    const accounts = BrokerAccountListSchema.parse(list.json());
    expect(accounts).toEqual([
      expect.objectContaining({ id, broker: "UPSTOX", status: "ACTIVE", isDefault: true, lastError: null }),
    ]);
    for (const secret of ["token-good-code", "UPX42", "app-secret-1", "app-key-1"]) {
      expect(list.body).not.toContain(secret);
    }
    const audits = await fixtures.auditLog.findMany({
      where: { userId: alice.user.id, action: "broker.connect" },
      orderBy: { id: "asc" },
      select: { data: true, entityId: true },
    });
    expect(audits.map((row) => row.data)).toEqual([
      { broker: "UPSTOX", status: "PENDING", reconnect: false },
      { broker: "UPSTOX", status: "ACTIVE", reconnect: false },
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/token-good-code|app-secret-1/);
  });

  it("refuses a replayed state, a callback from another session and one without a session", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    const first = await startUpstox(alice);
    const fromBob = await callback(`code=good-code&state=${encodeURIComponent(first.state)}`, bob.cookie);
    expect(fromBob.headers.location).toContain("error=session_mismatch");
    // The refused attempt consumed the state: the real user's replay of it is refused too.
    const replay = await callback(`code=good-code&state=${encodeURIComponent(first.state)}`, alice.cookie);
    expect(replay.headers.location).toContain("error=state_invalid");

    const second = await startUpstox(alice);
    expect((await callback(`code=good-code&state=${encodeURIComponent(second.state)}`)).headers.location).toContain(
      "error=session_mismatch",
    );
    const third = await startUpstox(alice);
    const ok = await callback(`code=good-code&state=${encodeURIComponent(third.state)}`, alice.cookie);
    expect(ok.headers.location).toContain("connected=");
    const again = await callback(`code=good-code&state=${encodeURIComponent(third.state)}`, alice.cookie);
    expect(again.headers.location).toContain("error=state_invalid");
    expect((await callback("state=forged.state", alice.cookie)).headers.location).toContain("error=invalid_request");
  });

  it("marks the account ERROR when the broker rejects the code", async () => {
    const alice = await signedIn();
    const { id, state } = await startUpstox(alice);

    const response = await callback(`code=wrong&state=${encodeURIComponent(state)}`, alice.cookie);

    expect(response.headers.location).toBe(`http://localhost:3000/brokers?error=broker_rejected&account=${id}`);
    expect(await fixtures.brokerAccount.findUnique({ where: { id }, select: { status: true } })).toEqual({
      status: "ERROR",
    });
  });

  it("enforces the plan's broker limit (free: one account)", async () => {
    const alice = await signedIn();
    await startUpstox(alice, "One");

    const response = await post(alice.cookie, "/v1/brokers/upstox", {
      label: "Two",
      apiKey: "app-key-2",
      apiSecret: "app-secret-2",
    });

    expect(response.statusCode).toBe(403);
    expect(ProblemDetailsSchema.parse(json(response))).toMatchObject({ code: "FORBIDDEN" });
  });

  it("connects Dhan after checking the token, and refuses a bad one with 422", async () => {
    const alice = await signedIn();

    const bad = await post(alice.cookie, "/v1/brokers/dhan", {
      label: "D",
      clientId: "1100",
      accessToken: "not-the-right-token",
    });
    expect(bad.statusCode).toBe(422);
    expect(json(bad)).toMatchObject({ code: "BROKER_REJECTED" });

    const good = await post(alice.cookie, "/v1/brokers/dhan", {
      label: "D",
      clientId: "1100",
      accessToken: "dhan-token-0123456789",
    });
    expect(good.statusCode, good.body).toBe(201);
    expect(BrokerAccountViewSchema.parse(json(good))).toMatchObject({ broker: "DHAN", status: "ACTIVE" });
    expect(good.body).not.toContain("dhan-token-0123456789");
    expect(good.body).not.toContain("1100");

    const relogin = await post(alice.cookie, `/v1/brokers/${(json(good) as { id: string }).id}/relogin`, {});
    expect(relogin.statusCode).toBe(422);
  });

  it("encrypts with a per-row data key, a fresh IV per field and the userId:accountId:field AAD", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    const created = await post(alice.cookie, "/v1/brokers/dhan", {
      label: "Vault",
      clientId: "1100",
      accessToken: "dhan-token-0123456789",
    });
    const aliceId = (json(created) as { id: string }).id;
    const paper = await post(bob.cookie, "/v1/brokers/paper", { label: "Bob" });
    const bobId = (json(paper) as { id: string }).id;
    const vault = testApp.app.get(VaultService);
    const access = testApp.app.get(BrokerAccessService);

    const row = await fixtures.brokerAccount.findUniqueOrThrow({ where: { id: aliceId } });
    expect(row.credentialsIv).toHaveLength(12);
    expect(row.brokerClientIdIv).toHaveLength(12);
    expect(Buffer.from(row.credentialsIv ?? []).equals(Buffer.from(row.brokerClientIdIv ?? []))).toBe(false);
    expect(Buffer.from(row.encryptedCredentials ?? []).toString("latin1")).not.toContain("dhan-token");
    const scope = { userId: alice.user.id, brokerAccountId: aliceId };
    const sealed = {
      ciphertext: row.brokerClientIdEnc ?? new Uint8Array(),
      iv: row.brokerClientIdIv ?? new Uint8Array(),
    };
    expect(vault.open(scope, dataKeyOf(row), "clientId", sealed)).toBe("1100");
    expect(() => vault.open({ ...scope, userId: bob.user.id }, dataKeyOf(row), "clientId", sealed)).toThrow(VaultError);
    expect(() => vault.open(scope, dataKeyOf(row), "credentials", sealed)).toThrow(VaultError);
    expect((await access.accountRef(alice.user.id, aliceId)).ref.creds.accessToken.reveal()).toBe(
      "dhan-token-0123456789",
    );

    // Alice's ciphertexts copied into Bob's row don't decrypt there (other user and account in the AAD).
    await fixtures.brokerAccount.update({
      where: { id: bobId },
      data: {
        encKeyWrapped: row.encKeyWrapped,
        encKeyIv: row.encKeyIv,
        encryptedCredentials: row.encryptedCredentials,
        credentialsIv: row.credentialsIv,
      },
    });
    await expect(access.accountRef(bob.user.id, bobId)).rejects.toBeInstanceOf(VaultError);
  });

  it("keeps every account to its owner: another user's id is a 404", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    const created = await post(alice.cookie, "/v1/brokers/paper", { label: "Mine" });
    const id = (json(created) as { id: string }).id;

    const patch = await testApp.request({
      method: "PATCH",
      url: `/v1/brokers/${id}`,
      headers: { cookie: bob.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ label: "Stolen" }),
    });
    const remove = await testApp.request({
      method: "DELETE",
      url: `/v1/brokers/${id}`,
      headers: { cookie: bob.cookie },
    });
    const relogin = await post(bob.cookie, `/v1/brokers/${id}/relogin`, {});

    expect([patch.statusCode, remove.statusCode, relogin.statusCode]).toEqual([404, 404, 404]);
    const bobsList = await testApp.request({ method: "GET", url: "/v1/brokers", headers: { cookie: bob.cookie } });
    expect(bobsList.json()).toEqual([]);
    expect(await fixtures.brokerAccount.findUnique({ where: { id }, select: { label: true } })).toEqual({
      label: "Mine",
    });
  });

  it("renames, sets the default and deletes, with audit rows", async () => {
    const alice = await signedIn();
    const a = json(await post(alice.cookie, "/v1/brokers/paper", { label: "A" })) as { id: string };
    const b = json(await post(alice.cookie, "/v1/brokers/paper", { label: "B" })) as { id: string };

    const patched = await testApp.request({
      method: "PATCH",
      url: `/v1/brokers/${b.id}`,
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ label: "Bee", isDefault: true }),
    });
    expect(json(patched)).toMatchObject({ label: "Bee", isDefault: true });
    const duplicate = await testApp.request({
      method: "PATCH",
      url: `/v1/brokers/${a.id}`,
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ label: "Bee" }),
    });
    expect(duplicate.statusCode).toBe(409);

    const removed = await testApp.request({
      method: "DELETE",
      url: `/v1/brokers/${a.id}`,
      headers: { cookie: alice.cookie },
    });
    expect(removed.statusCode).toBe(204);
    const actions = await fixtures.auditLog.findMany({
      where: { userId: alice.user.id, action: { in: ["broker.update", "broker.delete"] } },
      select: { action: true },
      orderBy: { id: "asc" },
    });
    expect(actions.map((row) => row.action)).toEqual(["broker.update", "broker.delete"]);
  });

  it("requires a session and validates bodies", async () => {
    expect((await testApp.request({ method: "GET", url: "/v1/brokers" })).statusCode).toBe(401);
    const alice = await signedIn();
    const invalid = await post(alice.cookie, "/v1/brokers/dhan", { label: "<b>", clientId: "x", accessToken: "y" });
    expect(invalid.statusCode).toBe(400);
  });
});
