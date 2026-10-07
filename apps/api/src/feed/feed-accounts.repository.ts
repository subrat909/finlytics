/**
 * The broker accounts `auto` may drive the feed from (phase-1b "Feed source"). The lookup spans users, so it is raw SQL
 * (the tenancy guard can't see it) and reads ids and brokers only; the credentials are opened by the broker vault
 * (FeedAccountAccess), which scopes by the account's owner. `auto` is development only (production names the account
 * in MARKET_FEED_ACCOUNT_ID). BrokerAccount is small; `(status, tokenExpiresAt)` narrows to ACTIVE rows.
 */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../infra/prisma/prisma.service";

import type { FeedAccountCandidate, FeedAccountDirectory } from "./feed-selector";
import { isLiveFeedBroker } from "./feed-source";
import type { LiveFeedBroker } from "./feed-source";

interface AccountRow {
  readonly id: string;
  readonly broker: string;
}

function candidatesOf(rows: readonly AccountRow[]): FeedAccountCandidate[] {
  return rows.flatMap((row) => (isLiveFeedBroker(row.broker) ? [{ accountId: row.id, broker: row.broker }] : []));
}

@Injectable()
export class FeedAccountsRepository implements FeedAccountDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async active(accountId: string): Promise<FeedAccountCandidate | null> {
    const rows = await this.prisma.db.$queryRaw<AccountRow[]>`
      SELECT "id", "broker"::text AS "broker" FROM "BrokerAccount"
      WHERE "id" = ${accountId} AND "status" = 'ACTIVE' AND "broker" IN ('UPSTOX', 'DHAN')`;
    return candidatesOf(rows)[0] ?? null;
  }

  async candidates(limit: number): Promise<FeedAccountCandidate[]> {
    const rows = await this.prisma.db.$queryRaw<AccountRow[]>`
      SELECT c."id", c."broker" FROM (
        (SELECT "id", "broker"::text AS "broker", "lastLoginAt" FROM "BrokerAccount"
          WHERE "status" = 'ACTIVE' AND "broker" = 'UPSTOX'
          ORDER BY "lastLoginAt" DESC NULLS LAST, "id" LIMIT ${limit})
        UNION ALL
        (SELECT "id", "broker"::text AS "broker", "lastLoginAt" FROM "BrokerAccount"
          WHERE "status" = 'ACTIVE' AND "broker" = 'DHAN'
          ORDER BY "lastLoginAt" DESC NULLS LAST, "id" LIMIT ${limit})
      ) AS c
      ORDER BY CASE c."broker" WHEN 'UPSTOX' THEN 0 ELSE 1 END, c."lastLoginAt" DESC NULLS LAST, c."id"`;
    return candidatesOf(rows);
  }

  async lapsed(): Promise<LiveFeedBroker | null> {
    const rows = await this.prisma.db.$queryRaw<AccountRow[]>`
      SELECT "id", "broker"::text AS "broker" FROM "BrokerAccount"
      WHERE "status" IN ('NEEDS_RELOGIN', 'EXPIRED') AND "broker" IN ('UPSTOX', 'DHAN')
      ORDER BY "lastLoginAt" DESC NULLS LAST, "id" LIMIT 1`;
    return candidatesOf(rows)[0]?.broker ?? null;
  }

  async hasInstruments(broker: LiveFeedBroker): Promise<boolean> {
    const row = await this.prisma.db.instrumentBrokerToken.findFirst({
      where: { broker, isActive: true },
      select: { token: true },
    });
    return row !== null;
  }
}
