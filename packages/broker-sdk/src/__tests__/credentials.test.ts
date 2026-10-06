import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { credentialsFromJson, credentialsToJson, isSecret, Secret, secretValues } from "../credentials";

describe("Secret", () => {
  it("never prints its value, however it is turned into text", () => {
    const secret = Secret.of("super-secret-token");
    expect(String(secret)).toBe("[REDACTED]");
    expect(secret.toString()).toBe("[REDACTED]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(inspect({ secret })).not.toContain("super-secret-token");
    expect(secret.reveal()).toBe("super-secret-token");
    expect(isSecret(secret)).toBe(true);
    expect(isSecret("super-secret-token")).toBe(false);
  });

  it("refuses an empty value", () => {
    expect(() => Secret.of("")).toThrow(TypeError);
  });
});

describe("credentials JSON (the vault's plaintext)", () => {
  const json = {
    accessToken: "access-123456",
    refreshToken: "refresh-123456",
    expiresAt: "2025-10-07T22:00:00.000Z",
    clientId: "AB1234",
    extra: { apiKey: "key-123456" },
  };

  it("round-trips, wrapping every secret", () => {
    const creds = credentialsFromJson(json);
    expect(isSecret(creds.accessToken) && isSecret(creds.refreshToken) && isSecret(creds.extra?.apiKey)).toBe(true);
    expect(creds.expiresAt?.toISOString()).toBe(json.expiresAt);
    expect(credentialsToJson(creds)).toEqual(json);
    expect(secretValues(creds)).toEqual(["access-123456", "refresh-123456", "key-123456"]);
    expect(JSON.stringify(creds)).not.toMatch(/123456/);
  });

  it("accepts the minimum and names bad fields without their values", () => {
    expect(credentialsToJson(credentialsFromJson({ accessToken: "only-token" }))).toEqual({
      accessToken: "only-token",
    });
    expect(() => credentialsFromJson({ accessToken: "", stray: "leaked-value" })).toThrow(
      /accessToken.*\(root\)|\(root\).*accessToken/,
    );
    expect(() => credentialsFromJson({ accessToken: "", stray: "leaked-value" })).not.toThrow(/leaked-value/);
    expect(() => credentialsFromJson("nope")).toThrow("Invalid broker credentials: (root)");
    expect(secretValues(undefined)).toEqual([]);
  });
});
