/**
 * The broker-token-expiry job's queries. Finding candidates spans users, so it is raw SQL (the tenancy guard can't
 * see it, and it reads ids only); every write is scoped by `{ id, userId }` and conditional on the state it changes,
 * so a re-run or a concurrent run changes nothing twice.
 */
import type { BrokerCode } from "@finlytics/database";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../infra/prisma/prisma.service";
import type { TenantTransaction } from "../infra/prisma/prisma.service";

export interface ExpiryCandidate {
  readonly id: string;
  readonly userId: string;
  readonly broker: BrokerCode;
  readonly label: string;
  readonly tokenExpiresAt: Date;
}

/** Candidates per query; the job loops until none are left. */
export const EXPIRY_SCAN_LIMIT = 500;

export interface NotificationInput {
  readonly title: string;
  readonly body: string;
  readonly severity: "info" | "warning";
  readonly data: { readonly brokerAccountId: string; readonly broker: BrokerCode };
}

@Injectable()
export class BrokerTokenExpiryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** ACTIVE accounts (not paper) whose token has expired by `now` (index: status, tokenExpiresAt). */
  expired(now: Date, afterId = ""): Promise<ExpiryCandidate[]> {
    return this.prisma.db.$queryRaw<ExpiryCandidate[]>`
      SELECT "id", "userId", "broker"::text AS "broker", "label", "tokenExpiresAt"
      FROM "BrokerAccount"
      WHERE "status" = 'ACTIVE' AND "broker" <> 'PAPER' AND "tokenExpiresAt" <= ${now}::timestamp(3) AND "id" > ${afterId}
      ORDER BY "id" LIMIT ${EXPIRY_SCAN_LIMIT}`;
  }

  /** ACTIVE Dhan accounts whose token expires in (now, until] and that haven't been reminded. */
  dueForReminder(now: Date, until: Date, afterId = ""): Promise<ExpiryCandidate[]> {
    return this.prisma.db.$queryRaw<ExpiryCandidate[]>`
      SELECT "id", "userId", "broker"::text AS "broker", "label", "tokenExpiresAt"
      FROM "BrokerAccount"
      WHERE "status" = 'ACTIVE' AND "broker" = 'DHAN' AND "expiryNotifiedAt" IS NULL
        AND "tokenExpiresAt" > ${now}::timestamp(3) AND "tokenExpiresAt" <= ${until}::timestamp(3) AND "id" > ${afterId}
      ORDER BY "id" LIMIT ${EXPIRY_SCAN_LIMIT}`;
  }

  /** ACTIVE → NEEDS_RELOGIN, only if the token is still expired and the account still ACTIVE. */
  async markExpired(tx: TenantTransaction, candidate: ExpiryCandidate, now: Date): Promise<boolean> {
    const result = await tx.brokerAccount.updateMany({
      where: { id: candidate.id, userId: candidate.userId, status: "ACTIVE", tokenExpiresAt: { lte: now } },
      data: {
        status: "NEEDS_RELOGIN",
        lastError: "The broker session has expired. Log in again.",
        expiryNotifiedAt: now,
      },
    });
    return result.count === 1;
  }

  /** Records the reminder, only if none was recorded for the current token. */
  async markReminded(tx: TenantTransaction, candidate: ExpiryCandidate, now: Date): Promise<boolean> {
    const result = await tx.brokerAccount.updateMany({
      where: { id: candidate.id, userId: candidate.userId, status: "ACTIVE", expiryNotifiedAt: null },
      data: { expiryNotifiedAt: now },
    });
    return result.count === 1;
  }

  /** An in-app notification (category `broker`, which users can't turn off: docs/04 §2). */
  async notify(tx: TenantTransaction, userId: string, input: NotificationInput): Promise<void> {
    await tx.notification.create({
      data: { userId, category: "broker", ...input, data: { ...input.data } },
      select: { id: true },
    });
  }
}
