/**
 * The 08:30 IST broker-token check (phase 1 plan P7; broker.md "daily re-login prompt"): every ACTIVE account (Upstox
 * at 03:30 IST, Dhan when its 24-hour token ran out without a renewal) whose token has expired becomes NEEDS_RELOGIN,
 * with an in-app notification and a system audit row, and `broker.account.deactivated` after the commit. Dhan tokens
 * are renewed every 30 minutes by broker-token-renew, so there is no expiry reminder any more.
 * Idempotent: each change is conditional on the state it changes, in one transaction with its notification.
 */
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../common/clock";
import type { Clock } from "../common/clock";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AuditService } from "../modules/audit/audit.service";
import { BrokerEvents } from "../modules/brokers/broker-events";

import { BrokerTokenExpiryRepository } from "./broker-token-expiry.repository";
import type { ExpiryCandidate } from "./broker-token-expiry.repository";

const BROKER_NAMES: Readonly<Record<string, string>> = { UPSTOX: "Upstox", DHAN: "Dhan" };

export interface TokenExpirySummary {
  /** Accounts moved to NEEDS_RELOGIN. */
  readonly expired: number;
}

@Injectable()
export class BrokerTokenExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: BrokerTokenExpiryRepository,
    private readonly audit: AuditService,
    private readonly events: BrokerEvents,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(BrokerTokenExpiryService.name);
  }

  async run(): Promise<TokenExpirySummary> {
    const now = this.clock.now();
    let expired = 0;
    let afterId = "";
    for (;;) {
      const candidates = await this.accounts.expired(now, afterId);
      for (const candidate of candidates) if (await this.expire(candidate, now)) expired += 1;
      const last = candidates.at(-1);
      if (last === undefined) break;
      afterId = last.id;
    }
    this.logger.info({ expired }, "broker token check done");
    return { expired };
  }

  private async expire(candidate: ExpiryCandidate, now: Date): Promise<boolean> {
    const name = BROKER_NAMES[candidate.broker] ?? candidate.broker;
    const changed = await this.prisma.db.$transaction(async (tx) => {
      if (!(await this.accounts.markExpired(tx, candidate, now))) return false;
      await this.accounts.notify(tx, candidate.userId, {
        title: `Log in to ${name} again`,
        body:
          candidate.broker === "DHAN"
            ? `The access token of "${candidate.label}" has expired. Generate a new one on Dhan and connect again.`
            : `The ${name} session of "${candidate.label}" has ended. Log in again to keep trading and live data.`,
        severity: "warning",
        data: { brokerAccountId: candidate.id, broker: candidate.broker },
      });
      await this.audit.record(tx, {
        action: "broker.expire",
        actor: { type: "system" },
        subjectUserId: candidate.userId,
        entity: { type: "BrokerAccount", id: candidate.id },
        data: { broker: candidate.broker, reason: "expired" },
      });
      return true;
    });
    if (changed)
      this.events.deactivated({ userId: candidate.userId, accountId: candidate.id, broker: candidate.broker });
    return changed;
  }
}
