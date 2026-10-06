/**
 * The 08:30 IST broker-token check (plan P7; broker.md "daily re-login prompt", "renewal reminder 3 days before
 * expiry"):
 * - every ACTIVE account (Upstox at 03:30 IST, Dhan after 30 days) whose token has expired becomes NEEDS_RELOGIN, with
 *   an in-app notification and a system audit row;
 * - every ACTIVE Dhan account whose token expires within {@link DHAN_REMINDER_DAYS} days gets one reminder per token.
 * Idempotent: each change is conditional on the state it changes, in one transaction with its notification.
 */
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../common/clock";
import type { Clock } from "../common/clock";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AuditService } from "../modules/audit/audit.service";

import { BrokerTokenExpiryRepository } from "./broker-token-expiry.repository";
import type { ExpiryCandidate } from "./broker-token-expiry.repository";

export const DHAN_REMINDER_DAYS = 3;
const DAY_MS = 86_400_000;

const BROKER_NAMES: Readonly<Record<string, string>> = { UPSTOX: "Upstox", DHAN: "Dhan" };

export interface TokenExpirySummary {
  /** Accounts moved to NEEDS_RELOGIN. */
  readonly expired: number;
  /** Dhan renewal reminders written. */
  readonly reminded: number;
}

/** The IST date of an instant, `06 Oct 2026`. */
export function istDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

@Injectable()
export class BrokerTokenExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: BrokerTokenExpiryRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(BrokerTokenExpiryService.name);
  }

  async run(): Promise<TokenExpirySummary> {
    const now = this.clock.now();
    const expired = await this.each(
      (afterId) => this.accounts.expired(now, afterId),
      (candidate) => this.expire(candidate, now),
    );
    const until = new Date(now.getTime() + DHAN_REMINDER_DAYS * DAY_MS);
    const reminded = await this.each(
      (afterId) => this.accounts.dueForReminder(now, until, afterId),
      (candidate) => this.remind(candidate, now),
    );
    this.logger.info({ expired, reminded }, "broker token check done");
    return { expired, reminded };
  }

  /** Pages through candidates by id and counts the ones `handle` changed. */
  private async each(
    page: (afterId: string) => Promise<ExpiryCandidate[]>,
    handle: (candidate: ExpiryCandidate) => Promise<boolean>,
  ): Promise<number> {
    let changed = 0;
    let afterId = "";
    for (;;) {
      const candidates = await page(afterId);
      for (const candidate of candidates) if (await handle(candidate)) changed += 1;
      const last = candidates.at(-1);
      if (last === undefined) return changed;
      afterId = last.id;
    }
  }

  private expire(candidate: ExpiryCandidate, now: Date): Promise<boolean> {
    const name = BROKER_NAMES[candidate.broker] ?? candidate.broker;
    return this.prisma.db.$transaction(async (tx) => {
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
  }

  private remind(candidate: ExpiryCandidate, now: Date): Promise<boolean> {
    return this.prisma.db.$transaction(async (tx) => {
      if (!(await this.accounts.markReminded(tx, candidate, now))) return false;
      await this.accounts.notify(tx, candidate.userId, {
        title: "Dhan access token expires soon",
        body: `The access token of "${candidate.label}" expires on ${istDate(candidate.tokenExpiresAt)}. Generate a new one on Dhan and connect again before then.`,
        severity: "info",
        data: { brokerAccountId: candidate.id, broker: candidate.broker },
      });
      return true;
    });
  }
}
