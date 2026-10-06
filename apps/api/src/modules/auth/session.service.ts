/**
 * Session validation (plan D9, docs/06 "Session contract"). A session is valid when all of these hold:
 * - the row exists, looked up by `hashSessionToken(token)` from @finlytics/shared (lowercase hex SHA-256 of the
 *   token's UTF-8 bytes; Auth.js's adapter in apps/web stores the same), so the database never holds a usable token,
 * - `expires` is in the future (Auth.js's rolling expiry),
 * - `lastSeenAt` is less than 7 days old (idle limit),
 * - `createdAt` is less than 30 days old (absolute limit),
 * - the user isn't deleted.
 *
 * `User.lockedUntil` is deliberately not checked: lockout protects sign-in, and checking it here would let an attacker
 * sign a victim out by failing logins on purpose.
 *
 * The api writes only `lastSeenAt`, best effort and at most every 5 minutes. A database error propagates: the filter
 * maps an outage to 503, never 401 (the web app signs the user out on 401).
 */
import { hashSessionToken, SESSION_LIMITS, SESSION_TOKEN_PATTERN } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";

import type { AuthIdentity } from "./auth-identity";
import { SessionRepository } from "./session.repository";
import type { SessionRecord } from "./session.repository";

const DAY_MS = 86_400_000;
const IDLE_LIMIT_MS = SESSION_LIMITS.idleDays * DAY_MS;
const ABSOLUTE_LIMIT_MS = SESSION_LIMITS.absoluteDays * DAY_MS;
const LAST_SEEN_WRITE_INTERVAL_MS = SESSION_LIMITS.lastSeenWriteIntervalSec * 1_000;

export type SessionVerdict = "valid" | "expired" | "idle" | "over-age" | "user-deleted";

/** Applies the session rules to a row at `now`. */
export function evaluateSession(session: SessionRecord, now: Date): SessionVerdict {
  const at = now.getTime();
  if (session.user.deletedAt !== null) return "user-deleted";
  if (session.expires.getTime() <= at) return "expired";
  if (at - session.lastSeenAt.getTime() >= IDLE_LIMIT_MS) return "idle";
  if (at - session.createdAt.getTime() >= ABSOLUTE_LIMIT_MS) return "over-age";
  return "valid";
}

/** Whether `lastSeenAt` is old enough to be written again. */
export function isLastSeenStale(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(SessionService.name);
  }

  /**
   * The identity a session token stands for, or `null` when it stands for none (malformed, unknown, expired, idle,
   * over-age, deleted user).
   *
   * @throws whatever the database throws: an outage must surface as 503, never as "signed out".
   */
  async resolve(token: string): Promise<AuthIdentity | null> {
    if (!SESSION_TOKEN_PATTERN.test(token)) return null;
    const session = await this.sessions.findByTokenHash(await hashSessionToken(token));
    if (session === null) return null;

    const now = this.clock.now();
    const verdict = evaluateSession(session, now);
    if (verdict !== "valid") {
      this.logger.debug({ verdict }, "session rejected");
      return null;
    }
    if (isLastSeenStale(session.lastSeenAt, now)) await this.touch(session, now);
    return { userId: session.userId, sessionId: session.id, role: session.user.role };
  }

  /** Best effort: a failed write is logged, never fatal to the request. */
  private async touch(session: SessionRecord, now: Date): Promise<void> {
    try {
      await this.sessions.touch(session.id, session.userId, now, new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS));
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "could not update session lastSeenAt");
    }
  }
}
