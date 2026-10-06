import { createHash, randomUUID } from "node:crypto";

import { hashSessionToken } from "@finlytics/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { SessionRecord, SessionRepository } from "../session.repository";
import { evaluateSession, isLastSeenStale, SessionService } from "../session.service";

const NOW = new Date("2026-10-06T10:00:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;
const TOKEN = "dGhpcyBpcyBhIHNlc3Npb24gdG9rZW4gZm9yIHRlc3Rz";

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    userId: "u1",
    expires: at(7 * DAY),
    lastSeenAt: at(-MINUTE),
    createdAt: at(-DAY),
    user: { role: "USER", deletedAt: null },
    ...overrides,
  };
}

function setup(record: SessionRecord | null) {
  const repository = {
    findByTokenHash: vi.fn<SessionRepository["findByTokenHash"]>().mockResolvedValue(record),
    touch: vi.fn<SessionRepository["touch"]>().mockResolvedValue(undefined),
  };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  const service = new SessionService(
    repository as unknown as SessionRepository,
    { now: () => NOW },
    logger as unknown as PinoLogger,
  );
  return { service, repository, logger };
}

describe("SessionService", () => {
  it("looks a session up by the lowercase hex SHA-256 of the token's UTF-8 bytes, never by the token", async () => {
    const { service, repository } = setup(session());

    await service.resolve(TOKEN);

    // Node's createHash is an independent oracle for the Web Crypto helper the api and Auth.js share.
    const hash = createHash("sha256").update(TOKEN, "utf8").digest("hex");
    expect(repository.findByTokenHash).toHaveBeenCalledWith(hash);
    expect(repository.findByTokenHash.mock.calls[0]?.[0]).not.toContain(TOKEN);
  });

  it("hashes an Auth.js randomUUID() token the way the web adapter stores it", async () => {
    const token = randomUUID(); // Auth.js's default generateSessionToken
    const { service, repository } = setup(session());

    await expect(service.resolve(token)).resolves.not.toBeNull();

    const stored = createHash("sha256").update(token, "utf8").digest("hex");
    expect(repository.findByTokenHash).toHaveBeenCalledWith(stored);
    await expect(hashSessionToken(token)).resolves.toBe(stored);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the identity of a valid session", async () => {
    const { service } = setup(session({ user: { role: "ADMIN", deletedAt: null } }));

    await expect(service.resolve(TOKEN)).resolves.toEqual({ userId: "u1", sessionId: "s1", role: "ADMIN" });
  });

  it("skips the lookup for a malformed token and treats an unknown one as no session", async () => {
    const malformed = setup(session());
    await expect(malformed.service.resolve("short")).resolves.toBeNull();
    expect(malformed.repository.findByTokenHash).not.toHaveBeenCalled();

    await expect(setup(null).service.resolve(TOKEN)).resolves.toBeNull();
  });

  it("rejects expired, idle and over-age sessions and deleted users", async () => {
    const rejected: [SessionRecord, string][] = [
      [session({ expires: at(-1) }), "expired"],
      [session({ expires: NOW }), "expired"],
      [session({ lastSeenAt: at(-7 * DAY) }), "idle"],
      [session({ createdAt: at(-30 * DAY), lastSeenAt: NOW }), "over-age"],
      [session({ user: { role: "USER", deletedAt: at(-DAY) } }), "user-deleted"],
    ];
    for (const [record, verdict] of rejected) {
      expect(evaluateSession(record, NOW)).toBe(verdict);
      const { service, logger } = setup(record);
      await expect(service.resolve(TOKEN), verdict).resolves.toBeNull();
      expect(logger.debug).toHaveBeenCalledWith({ verdict }, "session rejected");
    }
    expect(evaluateSession(session({ lastSeenAt: at(-7 * DAY + 1), createdAt: at(-30 * DAY + 1) }), NOW)).toBe("valid");
  });

  it("does not check lockedUntil", async () => {
    // A locked account (failed logins) keeps its existing sessions: lockout protects sign-in only.
    const record = { ...session(), user: { role: "USER" as const, deletedAt: null, lockedUntil: at(DAY) } };

    await expect(setup(record).service.resolve(TOKEN)).resolves.not.toBeNull();
  });

  it("writes lastSeenAt at most every 5 minutes", async () => {
    const fresh = setup(session({ lastSeenAt: at(-4 * MINUTE) }));
    await fresh.service.resolve(TOKEN);
    expect(fresh.repository.touch).not.toHaveBeenCalled();

    const stale = setup(session({ lastSeenAt: at(-5 * MINUTE) }));
    await stale.service.resolve(TOKEN);
    expect(stale.repository.touch).toHaveBeenCalledWith("s1", "u1", NOW, at(-5 * MINUTE));
    expect(isLastSeenStale(at(-5 * MINUTE + 1), NOW)).toBe(false);
  });

  it("keeps the request going when the lastSeenAt write fails", async () => {
    const { service, repository, logger } = setup(session({ lastSeenAt: at(-DAY) }));
    repository.touch.mockRejectedValue(new Error("write failed"));

    await expect(service.resolve(TOKEN)).resolves.not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown },
      "could not update session lastSeenAt",
    );
  });

  it("propagates a database error instead of treating it as signed out", async () => {
    const { service, repository } = setup(null);
    const outage = new Error("timeout exceeded when trying to connect");
    repository.findByTokenHash.mockRejectedValue(outage);

    await expect(service.resolve(TOKEN)).rejects.toBe(outage);
  });
});
