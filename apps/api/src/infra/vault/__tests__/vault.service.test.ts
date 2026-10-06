import { Secret } from "@finlytics/broker-sdk";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../../config/env.schema";
import { masterKeyFrom, vaultAad, VaultError, VaultService } from "../vault.service";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const ALICE = { userId: "alice", brokerAccountId: "acct1" };

/** `null`: MASTER_KEY unset. */
function vault(masterKey: string | null = KEY_A) {
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const config = { get: () => masterKey ?? undefined } as unknown as ConfigService<Env, true>;
  return { vault: new VaultService(config, logger as unknown as PinoLogger), logger };
}

describe("VaultService", () => {
  it("round-trips a field with a fresh 96-bit IV per ciphertext", () => {
    const { vault: v } = vault();
    const key = v.createDataKey(ALICE);

    const first = v.seal(ALICE, key, "clientId", "1100001");
    const second = v.seal(ALICE, key, "clientId", "1100001");

    expect(key.wrapped).toHaveLength(48);
    expect(key.iv).toHaveLength(12);
    expect(first.iv).toHaveLength(12);
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ciphertext).toString("utf8")).not.toContain("1100001");
    expect(v.open(ALICE, key, "clientId", first)).toBe("1100001");
  });

  it("binds every ciphertext to its user, account and field (AAD)", () => {
    const { vault: v } = vault();
    const key = v.createDataKey(ALICE);
    const sealed = v.seal(ALICE, key, "credentials", "secret");

    expect(() => v.open({ ...ALICE, userId: "bob" }, key, "credentials", sealed)).toThrow(VaultError);
    expect(() => v.open({ ...ALICE, brokerAccountId: "acct2" }, key, "credentials", sealed)).toThrow(VaultError);
    expect(() => v.open(ALICE, key, "clientId", sealed)).toThrow(VaultError);
  });

  it("fails closed on tampering, a wrong master key or an unknown key version", () => {
    const { vault: v } = vault();
    const key = v.createDataKey(ALICE);
    const sealed = v.seal(ALICE, key, "credentials", "secret");
    const flipped = new Uint8Array(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;

    expect(() => v.open(ALICE, key, "credentials", { ...sealed, ciphertext: flipped })).toThrow(VaultError);
    expect(() => v.open(ALICE, key, "credentials", { ...sealed, iv: new Uint8Array(8) })).toThrow(VaultError);
    expect(() => vault(KEY_B).vault.open(ALICE, key, "credentials", sealed)).toThrow("Vault decryption failed");
    expect(() => v.open(ALICE, { ...key, version: 2 }, "credentials", sealed)).toThrow("Unknown master key version");
  });

  it("stores broker credentials as Secrets and refuses malformed plaintext", () => {
    const { vault: v } = vault();
    const key = v.createDataKey(ALICE);
    const expiresAt = new Date("2026-10-07T22:00:00.000Z");

    const sealed = v.sealCredentials(ALICE, key, { accessToken: Secret.of("tok-1"), clientId: "C1", expiresAt });
    const creds = v.openCredentials(ALICE, key, sealed);

    expect(creds.accessToken.reveal()).toBe("tok-1");
    expect(creds).toMatchObject({ clientId: "C1", expiresAt });
    expect(JSON.stringify(creds)).not.toContain("tok-1");
    expect(() => v.openJson(ALICE, key, "credentials", v.seal(ALICE, key, "credentials", "{oops"))).toThrow("not JSON");
    expect(() => v.openCredentials(ALICE, key, v.sealJson(ALICE, key, "credentials", { token: 1 }))).toThrow(
      "malformed",
    );
  });

  it("derives distinct purpose keys from the master key", () => {
    const { vault: a } = vault();
    const { vault: b } = vault(KEY_B);

    expect(a.deriveKey("oauth-state")).toHaveLength(32);
    expect(a.deriveKey("oauth-state").equals(a.deriveKey("other"))).toBe(false);
    expect(a.deriveKey("oauth-state").equals(b.deriveKey("oauth-state"))).toBe(false);
    expect(() => a.deriveKey("Bad Purpose")).toThrow(TypeError);
  });

  it("uses a per-process key, with a warning, when MASTER_KEY is unset", () => {
    const { vault: v, logger } = vault(null);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("MASTER_KEY is not set"));
    const key = v.createDataKey(ALICE);
    expect(v.open(ALICE, key, "clientId", v.seal(ALICE, key, "clientId", "x"))).toBe("x");
    expect(masterKeyFrom(undefined).ephemeral).toBe(true);
    expect(() => masterKeyFrom(Buffer.alloc(16).toString("base64"))).toThrow("32 bytes");
  });

  it("refuses ids that could make two AADs equal", () => {
    expect(vaultAad(ALICE, "clientId").toString()).toBe("alice:acct1:clientId");
    expect(() => vaultAad({ userId: "a:b", brokerAccountId: "c" }, "clientId")).toThrow(TypeError);
    expect(() => vaultAad({ userId: "a", brokerAccountId: "" }, "clientId")).toThrow(TypeError);
  });
});
