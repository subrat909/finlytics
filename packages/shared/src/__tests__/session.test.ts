import { describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME, SESSION_LIMITS, SESSION_TOKEN_PATTERN } from "../schemas/session";

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

describe("SESSION_LIMITS", () => {
  it("ends sessions after 7 idle days or 30 days in all, and throttles lastSeenAt writes to every 5 minutes", () => {
    expect(SESSION_LIMITS).toEqual({ idleDays: 7, absoluteDays: 30, lastSeenWriteIntervalSec: 300 });
    expect(SESSION_LIMITS.idleDays).toBeLessThan(SESSION_LIMITS.absoluteDays);
    expect(Object.isFrozen(SESSION_LIMITS)).toBe(true);
  });
});
