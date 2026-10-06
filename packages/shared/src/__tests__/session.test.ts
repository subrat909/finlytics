import { describe, expect, it } from "vitest";

import { hashSessionToken, SESSION_COOKIE_NAME, SESSION_LIMITS, SESSION_TOKEN_PATTERN } from "../schemas/session";

describe("SESSION_COOKIE_NAME", () => {
  it("uses the __Host- session cookie only in production", () => {
    expect(SESSION_COOKIE_NAME.production).toBe("__Host-authjs.session-token");
    expect(SESSION_COOKIE_NAME.development).toBe("authjs.session-token");
    expect(SESSION_COOKIE_NAME.test).toBe("authjs.session-token");
    const prefixed = Object.entries(SESSION_COOKIE_NAME)
      .filter(([, name]) => name.startsWith("__Host-"))
      .map(([environment]) => environment);
    expect(prefixed).toEqual(["production"]);
    expect(Object.isFrozen(SESSION_COOKIE_NAME)).toBe(true);
  });

  it("names a cookie the same way in every environment apart from the prefix", () => {
    for (const name of Object.values(SESSION_COOKIE_NAME)) {
      expect(name.replace(/^__Host-/, "")).toBe("authjs.session-token");
    }
  });
});

describe("SESSION_TOKEN_PATTERN", () => {
  it("accepts Auth.js UUID session tokens", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const token = crypto.randomUUID(); // Auth.js's default generateSessionToken
      expect(SESSION_TOKEN_PATTERN.test(token), token).toBe(true);
    }
  });

  it("accepts 32 to 128 URL-safe characters and nothing else", () => {
    expect(SESSION_TOKEN_PATTERN.test("a".repeat(32))).toBe(true);
    expect(SESSION_TOKEN_PATTERN.test("Ab9_-".repeat(25) + "xyz")).toBe(true); // 128 characters
    for (const token of [
      "a".repeat(31),
      "a".repeat(129),
      "",
      `${"a".repeat(32)};`,
      `${"a".repeat(16)} ${"a".repeat(16)}`,
      `${"a".repeat(31)}=`, // base64 padding
      `${"a".repeat(31)}+`,
      `${"a".repeat(31)}\n`,
    ]) {
      expect(SESSION_TOKEN_PATTERN.test(token), JSON.stringify(token)).toBe(false);
    }
  });
});

describe("hashSessionToken", () => {
  it("returns the lowercase hex SHA-256 of the token's UTF-8 bytes", async () => {
    // Vectors from Node's createHash("sha256").update(token, "utf8").digest("hex"), what the database rows hold.
    const vectors: [string, string][] = [
      ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
      ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
      ["6f1b8c3e-2d4a-4b7f-9e0c-1a2b3c4d5e6f", "ba24866162e22c904310cb929c96fd3880e277c184db67a6369693a302899d90"],
      ["Ab9_-".repeat(25) + "xyz", "5d33e697c6acee40d011ce00cf8d297e3f86bd836484de62dce96721344ee718"],
      ["é", "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c"], // two UTF-8 bytes, not one
    ];
    for (const [token, hash] of vectors) {
      await expect(hashSessionToken(token), JSON.stringify(token)).resolves.toBe(hash);
    }
  });

  it("hashes an Auth.js UUID token to 64 lowercase hex characters that never contain the token", async () => {
    const token = crypto.randomUUID();

    const hash = await hashSessionToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    await expect(hashSessionToken(token)).resolves.toBe(hash);
    await expect(hashSessionToken(token.toUpperCase())).resolves.not.toBe(hash);
  });
});

describe("SESSION_LIMITS", () => {
  it("ends sessions after 7 idle days or 30 days in all, and throttles lastSeenAt writes to every 5 minutes", () => {
    expect(SESSION_LIMITS).toEqual({ idleDays: 7, absoluteDays: 30, lastSeenWriteIntervalSec: 300 });
    expect(SESSION_LIMITS.idleDays).toBeLessThan(SESSION_LIMITS.absoluteDays);
    expect(Object.isFrozen(SESSION_LIMITS)).toBe(true);
  });
});
