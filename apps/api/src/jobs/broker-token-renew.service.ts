/**
 * The 30-minute Dhan token renewal (plan phase-1b "Portfolio, brokers, plans, tokens"; broker.md "Dhan specifics"):
 * every ACTIVE Dhan account whose 24-hour token expires within {@link RENEW_WINDOW_MS} is renewed through
 * BrokerTokenService (RenewToken, re-sealed by the vault, audited, `broker.account.*` events after the commit).
 *
 * Idempotent: a renewed account's expiry moves 24 hours ahead, so a re-run (or a BullMQ retry) doesn't pick it again,
 * and every write is conditional on the state it read. When the broker couldn't be reached for some account, the job
 * fails after trying all of them, so BullMQ retries it with backoff while the old tokens still work.
 */
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../common/clock";
import type { Clock } from "../common/clock";
import { BrokerTokenService } from "../modules/brokers/broker-token.service";
import type { RenewOutcome } from "../modules/brokers/broker-token.service";

import { BrokerTokenRenewRepository } from "./broker-token-renew.repository";

/** Tokens expiring within 3 hours are renewed: six 30-minute runs, so one outage doesn't cost the session. */
export const RENEW_WINDOW_MS = 3 * 3_600_000;

export type TokenRenewSummary = Readonly<Record<RenewOutcome, number>>;

/** The job's failure when some renewals couldn't reach the broker (BullMQ retries it). */
export class TokenRenewIncompleteError extends Error {
  override readonly name = "TokenRenewIncompleteError";

  constructor(readonly summary: TokenRenewSummary) {
    super(`Broker token renewal could not reach the broker for ${String(summary.failed)} account(s)`);
  }
}

@Injectable()
export class BrokerTokenRenewService {
  constructor(
    private readonly accounts: BrokerTokenRenewRepository,
    private readonly tokens: BrokerTokenService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(BrokerTokenRenewService.name);
  }

  /** @throws {TokenRenewIncompleteError} after the scan when any renewal couldn't reach the broker. */
  async run(): Promise<TokenRenewSummary> {
    const now = this.clock.now();
    const until = new Date(now.getTime() + RENEW_WINDOW_MS);
    const summary: Record<RenewOutcome, number> = { renewed: 0, relogin: 0, failed: 0, skipped: 0 };
    let afterId = "";
    for (;;) {
      const candidates = await this.accounts.dueForRenewal(until, afterId);
      for (const candidate of candidates) {
        summary[await this.renewOne(candidate.userId, candidate.id, now)] += 1;
      }
      const last = candidates.at(-1);
      if (last === undefined) break;
      afterId = last.id;
    }
    this.logger.info(summary, "broker token renewal done");
    if (summary.failed > 0) throw new TokenRenewIncompleteError(summary);
    return summary;
  }

  /** One account; an unexpected error (the database, the vault) counts as failed and doesn't stop the others. */
  private async renewOne(userId: string, id: string, now: Date): Promise<RenewOutcome> {
    try {
      return await this.tokens.renew(userId, id, now);
    } catch (error: unknown) {
      this.logger.error({ err: error, brokerAccountId: id }, "broker token renewal crashed");
      return "failed";
    }
  }
}
