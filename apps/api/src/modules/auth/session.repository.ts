/**
 * Session rows (the Auth.js Prisma adapter's `Session` table, plan D9). The api reads a session by the SHA-256 of its
 * token and writes only `lastSeenAt`; Auth.js creates, extends and deletes sessions.
 */
import type { Role } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

/** What session validation needs, and nothing more. */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly expires: Date;
  readonly lastSeenAt: Date;
  readonly createdAt: Date;
  readonly user: { readonly role: Role; readonly deletedAt: Date | null };
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The session whose `sessionToken` column holds `tokenHash`: one unique-index lookup, no cache (a cached session
   * would outlive its revocation). Unscoped: the token is the only key the api has; the user is what it resolves.
   */
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.unscoped.session.findUnique({
      where: { sessionToken: tokenHash },
      select: {
        id: true,
        userId: true,
        expires: true,
        lastSeenAt: true,
        createdAt: true,
        user: { select: { role: true, deletedAt: true } },
      },
    });
  }

  /**
   * Sets `lastSeenAt` to `now` unless another request already did since `notSeenSince`: at most one write per session
   * per interval, whatever the concurrency. Scoped by `userId` (tenancy guard).
   */
  async touch(sessionId: string, userId: string, now: Date, notSeenSince: Date): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { id: sessionId, userId, lastSeenAt: { lt: notSeenSince } },
      data: { lastSeenAt: now },
    });
  }
}
