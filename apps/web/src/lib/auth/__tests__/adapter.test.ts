import type { PrismaClient } from "@finlytics/database";
import { hashSessionToken } from "@finlytics/shared";
import type { AdapterAccount, AdapterUser } from "next-auth/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthAdapter, isSessionAlive, toStoredAccount } from "../adapter";

const NOW = new Date("2026-10-06T10:00:00.000Z");
const DAY = 86_400_000;
const TOKEN = "Abc_def-0123456789abcdefghijklmnopqrstuvwxy"; // 43 characters, SESSION_TOKEN_PATTERN

const USER_ROW = {
  id: "user_1",
  email: "asha@example.com",
  emailVerified: null,
  name: "Asha",
  image: null,
  // Columns Auth.js must never see:
  passwordHash: "argon2id$...",
  totpSecretEnc: "enc",
  settings: {},
};

function fakePrisma() {
  return {
    user: {
      create: vi.fn().mockResolvedValue(USER_ROW),
      findUnique: vi.fn().mockResolvedValue(USER_ROW),
      update: vi.fn().mockResolvedValue(USER_ROW),
    },
    account: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ user: USER_ROW }),
    },
    session: {
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: { userId: string; expires: Date } }) =>
          Promise.resolve({ id: "s1", ...data }),
        ),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: { expires: Date } }) =>
          Promise.resolve({ id: "s1", userId: "user_1", ...data }),
        ),
      findUnique: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    verificationToken: {
      create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      delete: vi
        .fn()
        .mockImplementation(({ where }: { where: { identifier_token: unknown } }) =>
          Promise.resolve(where.identifier_token),
        ),
    },
  };
}

type FakePrisma = ReturnType<typeof fakePrisma>;

function sessionRow(overrides: Partial<{ createdAt: Date; lastSeenAt: Date; expires: Date; deletedAt: Date | null }>) {
  return {
    id: "s1",
    userId: "user_1",
    expires: overrides.expires ?? new Date(NOW.getTime() + 5 * DAY),
    createdAt: overrides.createdAt ?? new Date(NOW.getTime() - DAY),
    lastSeenAt: overrides.lastSeenAt ?? new Date(NOW.getTime() - 60_000),
    user: { ...USER_ROW, settings: { appearance: { theme: "dark" } }, deletedAt: overrides.deletedAt ?? null },
  };
}

let prisma: FakePrisma;
let adapter: ReturnType<typeof createAuthAdapter>;

beforeEach(() => {
  prisma = fakePrisma();
  adapter = createAuthAdapter(prisma as unknown as PrismaClient, { now: () => NOW });
});

describe("session tokens", () => {
  it("stores the SHA-256 of the token on create and hands the raw token back", async () => {
    const expires = new Date(NOW.getTime() + 7 * DAY);
    const session = await adapter.createSession?.({ sessionToken: TOKEN, userId: "user_1", expires });

    expect(prisma.session.create).toHaveBeenCalledWith({
      data: { sessionToken: await hashSessionToken(TOKEN), userId: "user_1", expires },
    });
    expect(session).toEqual({ sessionToken: TOKEN, userId: "user_1", expires });
  });

  it("looks a session up by the hash and returns the public user with the account's theme", async () => {
    prisma.session.findUnique.mockResolvedValue(sessionRow({}));
    const result = await adapter.getSessionAndUser?.(TOKEN);

    expect(prisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionToken: await hashSessionToken(TOKEN) } }),
    );
    expect(result?.session.sessionToken).toBe(TOKEN);
    expect(result?.user).toEqual({
      id: "user_1",
      email: "asha@example.com",
      emailVerified: null,
      name: "Asha",
      image: null,
      theme: "dark",
    });
  });

  it("treats a malformed cookie as no session, without a lookup", async () => {
    await expect(adapter.getSessionAndUser?.("not a token")).resolves.toBeNull();
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for an unknown token", async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(adapter.getSessionAndUser?.(TOKEN)).resolves.toBeNull();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ["older than 30 days", { createdAt: new Date(NOW.getTime() - 31 * DAY) }],
    ["idle for more than 7 days", { lastSeenAt: new Date(NOW.getTime() - 8 * DAY) }],
    ["expired", { expires: new Date(NOW.getTime() - 1) }],
    ["of a deleted user", { deletedAt: new Date(NOW.getTime() - DAY) }],
  ])("ends a session %s and deletes its row", async (_label, overrides) => {
    prisma.session.findUnique.mockResolvedValue(sessionRow(overrides));
    await expect(adapter.getSessionAndUser?.(TOKEN)).resolves.toBeNull();
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("hashes on update, moves lastSeenAt, and returns the raw token", async () => {
    const expires = new Date(NOW.getTime() + 7 * DAY);
    const updated = await adapter.updateSession?.({ sessionToken: TOKEN, expires });
    const hash = await hashSessionToken(TOKEN);

    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { sessionToken: hash },
      data: { sessionToken: hash, expires, lastSeenAt: NOW },
    });
    expect(updated).toEqual({ sessionToken: TOKEN, userId: "user_1", expires });
  });

  it("deletes by hash and tolerates a session that is already gone", async () => {
    prisma.session.deleteMany.mockResolvedValue({ count: 0 });
    await adapter.deleteSession?.(TOKEN);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { sessionToken: await hashSessionToken(TOKEN) } });
  });
});

describe("emails", () => {
  it("normalises the email when creating, finding and updating a user", async () => {
    const user: AdapterUser = { id: "x", email: "  Asha@Example.COM ", emailVerified: null };
    await adapter.createUser?.(user);
    await adapter.getUserByEmail?.("ASHA@example.com");
    await adapter.updateUser?.({ id: "user_1", email: "Asha@Example.com" });

    expect(prisma.user.create).toHaveBeenCalledWith({ data: { email: "asha@example.com", emailVerified: null } });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "asha@example.com" } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { email: "asha@example.com" } });
  });

  it("returns only public user fields", async () => {
    const created = await adapter.createUser?.({ id: "x", email: "asha@example.com", emailVerified: null });
    const found = await adapter.getUser?.("user_1");
    const byAccount = await adapter.getUserByAccount?.({ provider: "github", providerAccountId: "1" });
    for (const user of [created, found, byAccount]) {
      expect(Object.keys(user ?? {}).sort()).toEqual(["email", "emailVerified", "id", "image", "name"]);
    }
  });

  it("returns null when no user matches", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.account.findUnique.mockResolvedValue(null);
    await expect(adapter.getUser?.("missing")).resolves.toBeNull();
    await expect(adapter.getUserByEmail?.("missing@example.com")).resolves.toBeNull();
    await expect(adapter.getUserByAccount?.({ provider: "github", providerAccountId: "2" })).resolves.toBeNull();
  });

  it("normalises the magic-link identifier on create and use", async () => {
    const expires = new Date(NOW.getTime() + 600_000);
    await adapter.createVerificationToken?.({ identifier: "Asha@Example.com", token: "t", expires });
    await adapter.useVerificationToken?.({ identifier: " ASHA@example.com", token: "t" });

    expect(prisma.verificationToken.create).toHaveBeenCalledWith({
      data: { identifier: "asha@example.com", token: "t", expires },
    });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
      where: { identifier_token: { identifier: "asha@example.com", token: "t" } },
    });
  });
});

describe("linkAccount", () => {
  const account: AdapterAccount = {
    userId: "user_1",
    type: "oauth",
    provider: "google",
    providerAccountId: "g-1",
    access_token: "ya29.secret",
    refresh_token: "1//refresh",
    id_token: "eyJ.id.token",
    session_state: "state",
    expires_at: 1_790_000_000,
    token_type: "bearer",
    scope: "openid email profile",
    refresh_token_expires_in: 3600,
  };

  it("stores the allowlisted columns only: no provider tokens", async () => {
    await adapter.linkAccount?.(account);
    const [[{ data }]] = prisma.account.create.mock.calls as [[{ data: Record<string, unknown> }]];

    expect(data).toEqual({
      userId: "user_1",
      type: "oauth",
      provider: "google",
      providerAccountId: "g-1",
      expires_at: 1_790_000_000,
      token_type: "bearer",
      scope: "openid email profile",
    });
    for (const secret of ["access_token", "refresh_token", "id_token", "session_state"]) {
      expect(data).not.toHaveProperty(secret);
    }
  });

  it("stores nulls for optional columns the provider didn't send", () => {
    expect(toStoredAccount({ userId: "u", type: "email", provider: "email", providerAccountId: "a@b.c" })).toEqual({
      userId: "u",
      type: "email",
      provider: "email",
      providerAccountId: "a@b.c",
      expires_at: null,
      token_type: null,
      scope: null,
    });
  });
});

describe("isSessionAlive", () => {
  const alive = {
    expires: new Date(NOW.getTime() + DAY),
    createdAt: new Date(NOW.getTime() - DAY),
    lastSeenAt: new Date(NOW.getTime() - DAY),
    userDeletedAt: null,
  };

  it("accepts a session inside every limit and rejects one at each boundary", () => {
    expect(isSessionAlive(alive, NOW)).toBe(true);
    expect(isSessionAlive({ ...alive, createdAt: new Date(NOW.getTime() - 30 * DAY) }, NOW)).toBe(false);
    expect(isSessionAlive({ ...alive, lastSeenAt: new Date(NOW.getTime() - 7 * DAY) }, NOW)).toBe(false);
    expect(isSessionAlive({ ...alive, expires: NOW }, NOW)).toBe(false);
  });
});

describe("createAuthAdapter", () => {
  it("fails fast if the base adapter stops implementing a delegated method", async () => {
    vi.resetModules();
    vi.doMock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
    const { createAuthAdapter: create } = await import("../adapter");
    expect(() => create(prisma as unknown as PrismaClient)).toThrow(/no longer implements createUser/);
    vi.doUnmock("@auth/prisma-adapter");
  });
});
