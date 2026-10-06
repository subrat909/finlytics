/**
 * The Auth.js configuration (plan W3–W6), built from the validated environment. Pure apart from the adapter it's
 * given, so tests can inspect it.
 */
import { SESSION_COOKIE_NAME, SESSION_LIMITS } from "@finlytics/shared";
import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import type { WebEnv } from "@/lib/env";

import { emailProvider } from "./email";
import { toSessionPayload } from "./session-payload";

const DAY_SEC = 86_400;

/** 32 random bytes as base64url: 43 characters, matching SESSION_TOKEN_PATTERN (256 bits; Auth.js's UUID has 122). */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** The OAuth providers whose ID and secret are both set, in display order. */
export function oauthProviders(env: Pick<WebEnv, "google" | "github">): NonNullable<NextAuthConfig["providers"]> {
  return [
    ...(env.google ? [Google({ clientId: env.google.clientId, clientSecret: env.google.clientSecret })] : []),
    ...(env.github ? [GitHub({ clientId: env.github.clientId, clientSecret: env.github.clientSecret })] : []),
  ];
}

export function buildAuthConfig(env: WebEnv, adapter: Adapter): NextAuthConfig {
  const production = env.mode === "production";
  return {
    secret: env.authSecret,
    adapter,
    providers: [...oauthProviders(env), emailProvider({ server: env.emailServer, from: env.emailFrom })],
    session: {
      strategy: "database",
      // Rolling 7 days (the api's idle limit), extended at most once a day; the 30-day absolute limit is enforced in
      // the adapter's getSessionAndUser (and by the api).
      maxAge: SESSION_LIMITS.idleDays * DAY_SEC,
      updateAge: DAY_SEC,
      generateSessionToken,
    },
    useSecureCookies: production,
    cookies: {
      sessionToken: {
        name: SESSION_COOKIE_NAME[env.mode],
        // __Host- in production: Secure, Path=/, no Domain (docs/06 session contract).
        options: { httpOnly: true, sameSite: "lax", path: "/", secure: production },
      },
    },
    pages: { signIn: "/login", verifyRequest: "/verify", error: "/login" },
    callbacks: {
      // Database sessions: `user` is what the adapter's getSessionAndUser returned. Only public fields leave here.
      session({ session, user }) {
        return toSessionPayload({ expires: session.expires, user });
      },
    },
  };
}
