import { SESSION_TOKEN_PATTERN } from "@finlytics/shared";
import type { Adapter } from "next-auth/adapters";
import { describe, expect, it } from "vitest";

import type { WebEnv } from "../../env";
import { buildAuthConfig, generateSessionToken, oauthProviders } from "../config";
import { parseAppSession, toSessionPayload } from "../session-payload";

const ENV: WebEnv = {
  mode: "development",
  authSecret: "s".repeat(44),
  authUrl: "http://localhost:3000",
  google: undefined,
  github: undefined,
  emailServer: "smtp://127.0.0.1:1025",
  emailFrom: "Finlytics <no-reply@finlytics.local>",
  apiInternalUrl: "http://127.0.0.1:4000",
  rtUrl: "http://localhost:4000",
};
const ADAPTER: Adapter = {};

describe("buildAuthConfig", () => {
  it("uses database sessions: 7 days rolling, extended daily, with long random tokens", () => {
    const { session } = buildAuthConfig(ENV, ADAPTER);
    expect(session).toMatchObject({ strategy: "database", maxAge: 7 * 86_400, updateAge: 86_400 });
    const token = session?.generateSessionToken?.() ?? "";
    expect(token).toMatch(SESSION_TOKEN_PATTERN);
    expect(token).toHaveLength(43);
  });

  it("names and scopes the session cookie per the contract in development", () => {
    const config = buildAuthConfig(ENV, ADAPTER);
    expect(config.useSecureCookies).toBe(false);
    expect(config.cookies?.sessionToken).toEqual({
      name: "authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    });
  });

  it("uses the __Host- cookie, Secure, in production", () => {
    const config = buildAuthConfig({ ...ENV, mode: "production", authUrl: "https://app.example.com" }, ADAPTER);
    expect(config.useSecureCookies).toBe(true);
    expect(config.cookies?.sessionToken).toEqual({
      name: "__Host-authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
    });
  });

  it("always offers email, and OAuth only when configured", () => {
    const ids = (env: WebEnv) =>
      buildAuthConfig(env, ADAPTER).providers.map((provider) =>
        typeof provider === "function" ? provider().id : provider.id,
      );
    expect(ids(ENV)).toEqual(["email"]);
    expect(
      ids({ ...ENV, google: { clientId: "g", clientSecret: "gs" }, github: { clientId: "h", clientSecret: "hs" } }),
    ).toEqual(["google", "github", "email"]);
    expect(oauthProviders({ google: undefined, github: { clientId: "h", clientSecret: "hs" } })).toHaveLength(1);
  });

  it("points Auth.js at our pages", () => {
    expect(buildAuthConfig(ENV, ADAPTER).pages).toEqual({
      signIn: "/login",
      verifyRequest: "/verify",
      error: "/login",
    });
  });
});

describe("generateSessionToken", () => {
  it("never repeats", () => {
    expect(new Set(Array.from({ length: 50 }, generateSessionToken)).size).toBe(50);
  });
});

describe("session payload", () => {
  const user = { id: "u1", email: "asha@example.com", emailVerified: null, name: null, theme: "dark" };

  it("exposes only the public user, the expiry and the theme", () => {
    const payload = toSessionPayload({ expires: new Date("2026-10-13T00:00:00.000Z"), user });
    expect(payload).toEqual({
      expires: "2026-10-13T00:00:00.000Z",
      user: { id: "u1", email: "asha@example.com", name: null, image: null },
      theme: "dark",
    });
    expect(parseAppSession(payload)).toEqual(payload);
  });

  it("falls back to the system theme and rejects anything that isn't a session", () => {
    expect(toSessionPayload({ expires: "x", user: { id: "u1", email: "e" } }).theme).toBe("system");
    expect(parseAppSession(null)).toBeNull();
    expect(parseAppSession({ user: { name: "x" }, expires: "y" })).toBeNull();
  });
});
