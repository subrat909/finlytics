/**
 * The Auth.js adapter (plan W3, W4): a thin wrapper around `@auth/prisma-adapter` that keeps the session contract the
 * api enforces (docs/06 "Session contract", api plan §10.1).
 *
 * - `Session.sessionToken` stores `hashSessionToken(token)` (SHA-256, lowercase hex). Every session method hashes the
 *   raw token it gets and hands the raw token back, so Auth.js and the cookie never see the hash and the database never
 *   sees the token.
 * - Emails are stored and looked up as `normalizeEmail(email)` (trimmed, lowercased; the database CHECKs it).
 * - `linkAccount` stores an allowlist of columns, so provider tokens (`access_token`, `refresh_token`, `id_token`,
 *   `session_state`) never reach the database.
 * - `getSessionAndUser` applies the api's validity rules (30 days absolute, 7 days idle, user not deleted) and returns
 *   only the public user fields plus the theme setting.
 */
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@finlytics/database";
import {
  hashSessionToken,
  normalizeEmail,
  parseUserSettings,
  SESSION_LIMITS,
  SESSION_TOKEN_PATTERN,
} from "@finlytics/shared";
import type { ThemePreference } from "@finlytics/ui/lib/theme";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser, VerificationToken } from "next-auth/adapters";

const DAY_MS = 86_400_000;

/** A user as Auth.js sees it: public fields only, plus the account's theme for the no-flash first paint. */
export interface AppAdapterUser extends AdapterUser {
  theme: ThemePreference;
}

/** The Account columns Finlytics stores (W3). Anything else the provider returned is dropped. */
export interface StoredAccount {
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  expires_at: number | null;
  token_type: string | null;
  scope: string | null;
}

export function toStoredAccount(account: AdapterAccount): StoredAccount {
  return {
    userId: account.userId,
    type: account.type,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    expires_at: typeof account.expires_at === "number" ? account.expires_at : null,
    token_type: typeof account.token_type === "string" ? account.token_type : null,
    scope: typeof account.scope === "string" ? account.scope : null,
  };
}

interface UserRow {
  id: string;
  email: string;
  emailVerified: Date | null;
  name?: string | null | undefined;
  image?: string | null | undefined;
}

/** Only the fields Auth.js needs; never the password hash, 2FA secrets, lockout state or settings. */
function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name ?? null,
    image: row.image ?? null,
  };
}

function toAdapterSession(rawToken: string, row: { userId: string; expires: Date }): AdapterSession {
  return { sessionToken: rawToken, userId: row.userId, expires: row.expires };
}

export interface SessionLifetimeInput {
  expires: Date;
  createdAt: Date;
  lastSeenAt: Date;
  userDeletedAt: Date | null;
}

/** The api's rule (docs/06): not expired, under 30 days old, seen in the last 7 days, and the user not deleted. */
export function isSessionAlive(session: SessionLifetimeInput, now: Date): boolean {
  const nowMs = now.getTime();
  return (
    session.userDeletedAt === null &&
    session.expires.getTime() > nowMs &&
    session.createdAt.getTime() > nowMs - SESSION_LIMITS.absoluteDays * DAY_MS &&
    session.lastSeenAt.getTime() > nowMs - SESSION_LIMITS.idleDays * DAY_MS
  );
}

/** The base adapter methods this wrapper delegates to. */
const DELEGATED = [
  "createUser",
  "getUser",
  "getUserByEmail",
  "getUserByAccount",
  "updateUser",
  "linkAccount",
  "createSession",
  "updateSession",
  "createVerificationToken",
  "useVerificationToken",
] as const;

type BaseAdapter = Adapter & Required<Pick<Adapter, (typeof DELEGATED)[number]>>;

function assertDelegates(adapter: Adapter): asserts adapter is BaseAdapter {
  for (const name of DELEGATED) {
    if (typeof adapter[name] !== "function") throw new TypeError(`@auth/prisma-adapter no longer implements ${name}`);
  }
}

export interface AuthAdapterOptions {
  /** The clock (tests). */
  now?: () => Date;
}

export function createAuthAdapter(prisma: PrismaClient, options: AuthAdapterOptions = {}): Adapter {
  const now = options.now ?? (() => new Date());
  const base = PrismaAdapter(prisma);
  assertDelegates(base);

  return {
    async createUser(user) {
      return toAdapterUser(await base.createUser({ ...user, email: normalizeEmail(user.email) }));
    },
    async getUser(id) {
      const user = await base.getUser(id);
      return user ? toAdapterUser(user) : null;
    },
    async getUserByEmail(email) {
      const user = await base.getUserByEmail(normalizeEmail(email));
      return user ? toAdapterUser(user) : null;
    },
    async getUserByAccount(providerAccount) {
      const user = await base.getUserByAccount(providerAccount);
      return user ? toAdapterUser(user) : null;
    },
    async updateUser(user) {
      const updated = await base.updateUser(
        user.email === undefined ? user : { ...user, email: normalizeEmail(user.email) },
      );
      return toAdapterUser(updated);
    },
    async linkAccount(account) {
      // The stored columns only; the cast is safe because StoredAccount is a subset AdapterAccount's writer accepts.
      await base.linkAccount(toStoredAccount(account) as AdapterAccount);
    },

    async createSession(session) {
      const row = await base.createSession({ ...session, sessionToken: await hashSessionToken(session.sessionToken) });
      return toAdapterSession(session.sessionToken, row);
    },
    async getSessionAndUser(sessionToken) {
      // A malformed cookie is no session, without a lookup (the api does the same).
      if (!SESSION_TOKEN_PATTERN.test(sessionToken)) return null;
      const row = await prisma.session.findUnique({
        where: { sessionToken: await hashSessionToken(sessionToken) },
        select: {
          id: true,
          userId: true,
          expires: true,
          createdAt: true,
          lastSeenAt: true,
          user: {
            select: {
              id: true,
              email: true,
              emailVerified: true,
              name: true,
              image: true,
              settings: true,
              deletedAt: true,
            },
          },
        },
      });
      if (row === null) return null;
      if (!isSessionAlive({ ...row, userDeletedAt: row.user.deletedAt }, now())) {
        // Never valid again; Auth.js clears the cookie when this returns null.
        await prisma.session.deleteMany({ where: { id: row.id } });
        return null;
      }
      const user: AppAdapterUser = {
        ...toAdapterUser(row.user),
        theme: parseUserSettings(row.user.settings).appearance.theme,
      };
      return { session: toAdapterSession(sessionToken, row), user };
    },
    async updateSession(session) {
      // Auth.js calls this when it extends `expires` (at most once per updateAge). The extension is activity, so it
      // also moves lastSeenAt, the api's idle clock, which the api otherwise moves only on /v1 calls.
      const update: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken"> & { lastSeenAt: Date } = {
        ...session,
        sessionToken: await hashSessionToken(session.sessionToken),
        lastSeenAt: now(),
      };
      const row = await base.updateSession(update);
      return row ? toAdapterSession(session.sessionToken, row) : null;
    },
    async deleteSession(sessionToken) {
      // Idempotent: signing out twice (two tabs) or after expiry isn't an error.
      await prisma.session.deleteMany({ where: { sessionToken: await hashSessionToken(sessionToken) } });
    },

    async createVerificationToken(token: VerificationToken) {
      return base.createVerificationToken({ ...token, identifier: normalizeEmail(token.identifier) });
    },
    async useVerificationToken(params) {
      return base.useVerificationToken({ ...params, identifier: normalizeEmail(params.identifier) });
    },
  };
}
