/**
 * The session contract between Auth.js (apps/web, 0.6) and the api (plan D9, docs/06). Auth.js creates, extends and
 * deletes sessions and is the only one that sets the cookie; the api only validates a session and writes its
 * `lastSeenAt`. Both sides read the constants below, so they can't drift apart.
 */

/**
 * The session cookie's name per `NODE_ENV`. Production uses the `__Host-` prefix, which browsers accept only with
 * `Secure`, `Path=/` and no `Domain`: the cookie can never be set by, or sent to, another host. That is why the web app
 * and the api share one origin in production (plan A1). Development and test run on plain http, where browsers reject
 * `__Host-` cookies.
 */
export const SESSION_COOKIE_NAME = Object.freeze({
  development: "authjs.session-token",
  test: "authjs.session-token",
  production: "__Host-authjs.session-token",
} as const);
export type SessionCookieName = (typeof SESSION_COOKIE_NAME)[keyof typeof SESSION_COOKIE_NAME];

/**
 * An opaque session token as the cookie carries it: 32–128 characters from `[A-Za-z0-9_-]`. Auth.js's default token,
 * `crypto.randomUUID()`, matches. The database stores only `hashSessionToken(token)`, so a database read can't be
 * replayed as a session; a cookie that doesn't match is treated as no session, without a lookup.
 */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const UTF8 = new TextEncoder();

/**
 * What `Session.sessionToken` stores for a cookie token: the SHA-256 of the token's UTF-8 bytes, as 64 lowercase hex
 * characters. Auth.js's adapter (apps/web) hashes before every write and lookup, and the api hashes the cookie before
 * its lookup, both through this one function, so the two can't disagree on the encoding.
 *
 * Web Crypto (`crypto.subtle`), so it runs in Node, the Edge runtime and browsers alike; in a browser, only in a secure
 * context (https or localhost). Hashing is pure: validate the token against `SESSION_TOKEN_PATTERN` first, where a
 * malformed token should mean "no session".
 */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", UTF8.encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Session lifetimes, enforced by the api (and mirrored by Auth.js in 0.6):
 * - `idleDays`: a session not seen for 7 days has ended (`Session.lastSeenAt`).
 * - `absoluteDays`: a session ends 30 days after it was created, however active (`Session.createdAt`).
 * - `lastSeenWriteIntervalSec`: the api updates `lastSeenAt` at most once every 5 minutes per session.
 */
export const SESSION_LIMITS = Object.freeze({
  idleDays: 7,
  absoluteDays: 30,
  lastSeenWriteIntervalSec: 300,
} as const);
