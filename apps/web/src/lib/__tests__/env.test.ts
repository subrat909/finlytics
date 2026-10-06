import { describe, expect, it } from "vitest";

import { DEV_DEFAULTS, WebEnvError, isHttpOrigin, parseWebEnv, runtimeMode } from "../env";

const SECRET = "s".repeat(44);

function issuesOf(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseWebEnv(source);
  } catch (error) {
    if (error instanceof WebEnvError) return error.issues;
    throw error;
  }
  return [];
}

describe("parseWebEnv", () => {
  it("applies the development defaults when only AUTH_SECRET is set", () => {
    expect(parseWebEnv({ AUTH_SECRET: SECRET })).toEqual({
      mode: "development",
      authSecret: SECRET,
      authUrl: DEV_DEFAULTS.AUTH_URL,
      google: undefined,
      github: undefined,
      emailServer: DEV_DEFAULTS.EMAIL_SERVER,
      emailFrom: DEV_DEFAULTS.EMAIL_FROM,
      apiInternalUrl: DEV_DEFAULTS.API_INTERNAL_URL,
    });
  });

  it("requires AUTH_SECRET of at least 32 characters, without echoing the value", () => {
    expect(issuesOf({})).toEqual(["AUTH_SECRET: is required (generate one: openssl rand -base64 32)"]);
    const issues = issuesOf({ AUTH_SECRET: "short-secret-value" });
    expect(issues).toEqual(["AUTH_SECRET: must be at least 32 characters (openssl rand -base64 32)"]);
    expect(issues.join("")).not.toContain("short-secret-value");
  });

  it("enables an OAuth provider only when both its id and secret are set", () => {
    const env = parseWebEnv({ AUTH_SECRET: SECRET, AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret" });
    expect(env.github).toEqual({ clientId: "id", clientSecret: "secret" });
    expect(env.google).toBeUndefined();
    expect(issuesOf({ AUTH_SECRET: SECRET, AUTH_GOOGLE_ID: "id" })).toEqual([
      "AUTH_GOOGLE_SECRET: is required when AUTH_GOOGLE_ID is set (set both or neither)",
    ]);
  });

  it("treats blank values as unset", () => {
    expect(parseWebEnv({ AUTH_SECRET: SECRET, AUTH_URL: " ", AUTH_GOOGLE_ID: "" }).authUrl).toBe(DEV_DEFAULTS.AUTH_URL);
  });

  it("rejects malformed origins, SMTP URLs and sender headers", () => {
    expect(
      issuesOf({
        AUTH_SECRET: SECRET,
        AUTH_URL: "http://localhost:3000/app",
        API_INTERNAL_URL: "ftp://api",
        EMAIL_SERVER: "http://mail",
        EMAIL_FROM: "Finlytics <a@b.c>\r\nBcc: x@y.z",
      }),
    ).toEqual([
      "AUTH_URL: must be an http(s) origin (scheme://host[:port], no path)",
      "EMAIL_SERVER: must be an smtp:// or smtps:// URL",
      'EMAIL_FROM: must be an address, e.g. "Finlytics <no-reply@example.com>"',
      "API_INTERNAL_URL: must be an http(s) origin (scheme://host[:port], no path)",
    ]);
  });

  it("requires https and every mail variable in production, and drops the api default", () => {
    expect(issuesOf({ NODE_ENV: "production", AUTH_SECRET: SECRET, AUTH_URL: "http://app.example.com" })).toEqual([
      "EMAIL_SERVER: is required in production",
      "EMAIL_FROM: is required in production",
      "AUTH_URL: must use https:// in production",
    ]);
    const env = parseWebEnv({
      NODE_ENV: "production",
      AUTH_SECRET: SECRET,
      AUTH_URL: "https://app.example.com/",
      EMAIL_SERVER: "smtps://user:pass@smtp.example.com:465",
      EMAIL_FROM: "Finlytics <no-reply@example.com>",
    });
    expect(env.authUrl).toBe("https://app.example.com");
    expect(env.apiInternalUrl).toBeUndefined();
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(issuesOf({ NODE_ENV: "staging", AUTH_SECRET: SECRET })).toEqual([
      "NODE_ENV: must be development, test or production",
    ]);
  });
});

describe("isHttpOrigin", () => {
  it.each([
    ["http://localhost:3000", true],
    ["https://app.finlytics.in/", true],
    ["https://user:pass@app.finlytics.in", false],
    ["https://app.finlytics.in/path", false],
    ["https://app.finlytics.in?x=1", false],
    ["https://app.finlytics.in#x", false],
    ["ws://localhost", false],
    ["not a url", false],
  ])("%s → %s", (value, expected) => {
    expect(isHttpOrigin(value)).toBe(expected);
  });
});

describe("runtimeMode", () => {
  it("maps NODE_ENV to a mode, development by default", () => {
    expect(runtimeMode("production")).toBe("production");
    expect(runtimeMode("test")).toBe("test");
    expect(runtimeMode("")).toBe("development");
    expect(runtimeMode()).toBe("test"); // Vitest sets NODE_ENV=test
    expect(runtimeMode("staging")).toBe("development");
  });
});
