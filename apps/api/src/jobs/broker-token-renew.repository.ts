/**
 * The broker-token-renew job's candidate scan. It spans users, so it is raw SQL (the tenancy guard can't see it) and
 * reads ids only; the renewal itself (BrokerTokenService) reads and writes each account scoped by `{ id, userId }`.
 */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../infra/prisma/prisma.service";

export interface RenewCandidate {
  readonly id: string;
  readonly userId: string;
}

/** Candidates per query; the job pages by id until none are left. */
export const RENEW_SCAN_LIMIT = 500;

@Injectable()
export class BrokerTokenRenewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** ACTIVE Dhan accounts whose token expires by `until` (expired ones too), after `afterId` (index: status, tokenExpiresAt). */
  dueForRenewal(until: Date, afterId = ""): Promise<RenewCandidate[]> {
    return this.prisma.db.$queryRaw<RenewCandidate[]>`
      SELECT "id", "userId"
      FROM "BrokerAccount"
      WHERE "status" = 'ACTIVE' AND "broker" = 'DHAN' AND "tokenExpiresAt" <= ${until}::timestamp(3) AND "id" > ${afterId}
      ORDER BY "id" LIMIT ${RENEW_SCAN_LIMIT}`;
  }
}
