/**
 * Rows for the integration tests, written with their own Prisma client (not the app's). Every test makes its own users
 * with unique emails, so test files can share the database and run in parallel.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createPrismaClient } from "@finlytics/database";
import type { PrismaClient } from "@finlytics/database";
import { SESSION_COOKIE_NAME } from "@finlytics/shared";
import { inject } from "vitest";

const DAY_MS = 86_400_000;

/** A fixtures client for the run's database; `$disconnect()` it in afterAll. */
export function fixturesClient(url: string = inject("databaseUrl")): PrismaClient {
  return createPrismaClient({ url, poolMax: 2 });
}

/** A short random id for emails and names. */
export function uniqueSuffix(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

/** A session token in the shape Auth.js uses (base64url, 43 characters, matches SESSION_TOKEN_PATTERN). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface CreatedUser {
  readonly id: string;
  readonly email: string;
}

export async function createUser(
  prisma: PrismaClient,
  overrides: { name?: string | null; deletedAt?: Date | null } = {},
): Promise<CreatedUser> {
  const email = `user-${uniqueSuffix()}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      name: overrides.name === undefined ? "Test User" : overrides.name,
      deletedAt: overrides.deletedAt ?? null,
    },
    select: { id: true, email: true },
  });
  return user;
}

export interface SessionOptions {
  /** Defaults to 7 days from now. */
  readonly expires?: Date;
  /** Defaults to now. */
  readonly lastSeenAt?: Date;
  /** Defaults to now. */
  readonly createdAt?: Date;
  /** Store the raw token instead of its SHA-256 (the api must never match it). */
  readonly storeRawToken?: boolean;
}

export interface CreatedSession {
  readonly id: string;
  readonly token: string;
}

/** Inserts a session the way the 0.6 Auth.js adapter will: the row holds SHA-256(token). */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
  options: SessionOptions = {},
): Promise<CreatedSession> {
  const token = newSessionToken();
  const now = Date.now();
  const session = await prisma.session.create({
    data: {
      userId,
      sessionToken: options.storeRawToken === true ? token : sha256Hex(token),
      expires: options.expires ?? new Date(now + 7 * DAY_MS),
      lastSeenAt: options.lastSeenAt ?? new Date(now),
      createdAt: options.createdAt ?? new Date(now),
    },
    select: { id: true },
  });
  return { id: session.id, token };
}

/** `days` days ago (or ahead, for a negative value). */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/** The Cookie header for a session token (development/test cookie name, or production's `__Host-` one). */
export function sessionCookie(token: string, nodeEnv: "test" | "production" = "test"): string {
  return `${SESSION_COOKIE_NAME[nodeEnv]}=${token}`;
}

/** Extra memberships for a test app role, each of which the production role check must refuse. */
export type UnsafeGrant = "superuser-member" | "server-files";

/**
 * Creates a LOGIN role that is not a superuser and may read the tables (the app role 2.1's role split creates) and
 * returns `databaseUrl` rewritten to use it. Parameterised: the name and password reach PostgreSQL as bind
 * parameters (set_config), and format('%I', '%L') quotes them inside the DO block.
 *
 * `grants` adds unsafe memberships: `superuser-member` makes it a member of the connecting (superuser) role,
 * `server-files` of pg_write_server_files.
 */
export async function createAppRole(
  prisma: PrismaClient,
  databaseUrl: string,
  grants: readonly UnsafeGrant[] = [],
): Promise<string> {
  const role = `finlytics_app_${uniqueSuffix()}`;
  const password = `pw_${randomBytes(18).toString("hex")}`;
  const superuserMember = grants.includes("superuser-member") ? "on" : "off";
  const serverFiles = grants.includes("server-files") ? "on" : "off";
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('finlytics.test_role', ${role}, true), set_config('finlytics.test_password', ${password}, true), set_config('finlytics.test_superuser_member', ${superuserMember}, true), set_config('finlytics.test_server_files', ${serverFiles}, true)`;
    await tx.$executeRaw`DO $$
      DECLARE
        role_name text := current_setting('finlytics.test_role');
        role_password text := current_setting('finlytics.test_password');
      BEGIN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER', role_name, role_password);
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', role_name);
        IF current_setting('finlytics.test_superuser_member') = 'on' THEN
          EXECUTE format('GRANT %I TO %I', current_user, role_name);
        END IF;
        IF current_setting('finlytics.test_server_files') = 'on' THEN
          EXECUTE format('GRANT pg_write_server_files TO %I', role_name);
        END IF;
      END $$`;
  });
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  return url.href;
}
