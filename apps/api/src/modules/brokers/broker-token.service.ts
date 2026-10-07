/**
 * Renewing broker tokens (plan phase-1b "Portfolio, brokers, plans, tokens"; broker.md "Dhan specifics"). DhanHQ
 * tokens last 24 hours, and `refreshToken` (Dhan's `GET /RenewToken`) swaps a live token for a new 24-hour one while
 * the old one stops working. The broker-token-renew job calls {@link BrokerTokenService.renew} for every ACTIVE Dhan
 * account whose token expires within 3 hours.
 *
 * - Success: the new credentials are sealed again by VaultService (the row's data key, a fresh IV, the same
 *   `userId:brokerAccountId:credentials` AAD), the expiry is updated, the renewal is audited (`broker.renew`, system)
 *   and `broker.account.activated` is emitted after the commit.
 * - The broker refused (NEEDS_RELOGIN or BROKER_REJECTED), or the token has already expired: the account becomes
 *   NEEDS_RELOGIN with our own `lastError`, an in-app notification and a `broker.expire` audit row, and
 *   `broker.account.deactivated` is emitted after the commit.
 * - The broker is unreachable or rate-limited: nothing changes (`failed`); the next run tries again.
 * - Every write is conditional on the account still being ACTIVE with the token expiry read before the broker call, so
 *   a concurrent re-connect, renewal or deletion is never overwritten (`skipped`).
 * Nothing here logs or returns a token: credentials stay Secret-wrapped until VaultService seals them.
 */
import type { BrokerCredentials } from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { PrismaService } from "../../infra/prisma/prisma.service";
import { VaultService } from "../../infra/vault/vault.service";
import type { VaultScope } from "../../infra/vault/vault.service";
import { AuditService } from "../audit/audit.service";

import { brokerProblem } from "./broker-errors";
import { BrokerEvents } from "./broker-events";
import { BrokerGateways } from "./broker-gateways";
import { BrokersRepository } from "./brokers.repository";
import type { BrokerAccountSecretRow } from "./brokers.repository";
import { dataKeyOf } from "./brokers.service";
import { dhanExpiry } from "./token-expiry";

/** What a renewal did. */
export type RenewOutcome =
  /** New credentials stored. */
  | "renewed"
  /** The account now needs the user to connect again. */
  | "relogin"
  /** The broker couldn't be reached (or asked us to wait): unchanged, try again later. */
  | "failed"
  /** Nothing to do: gone, not ACTIVE, not renewable, or changed while the broker was asked. */
  | "skipped";

const BROKER_NAMES: Readonly<Partial<Record<BrokerCode, string>>> = { UPSTOX: "Upstox", DHAN: "Dhan", PAPER: "Paper" };

/** Why an account needs a new login after a renewal attempt. */
type ReloginReason = "expired" | "renew_refused";

@Injectable()
export class BrokerTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: BrokersRepository,
    private readonly vault: VaultService,
    private readonly gateways: BrokerGateways,
    private readonly audit: AuditService,
    private readonly events: BrokerEvents,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(BrokerTokenService.name);
  }

  /** Renews the token of one of the user's ACTIVE accounts. Never throws for a broker failure: see {@link RenewOutcome}. */
  async renew(userId: string, id: string, now: Date): Promise<RenewOutcome> {
    const row = await this.accounts.findSecrets(userId, id);
    if (row?.status !== "ACTIVE" || row.encryptedCredentials === null || row.credentialsIv === null) return "skipped";
    if (row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() <= now.getTime()) {
      // An expired token can't be renewed (the broker would refuse it): no broker call.
      return this.requireLogin(userId, row, "expired", now);
    }
    const gateway = this.gateways.gateway(row.broker);
    if (!gateway.capabilities.refreshable) return "skipped";
    const scope: VaultScope = { userId, brokerAccountId: id };
    const dataKey = dataKeyOf(row);
    const creds = this.vault.openCredentials(scope, dataKey, {
      ciphertext: row.encryptedCredentials,
      iv: row.credentialsIv,
    });
    let renewed: BrokerCredentials;
    try {
      renewed = await gateway.refreshToken({ accountId: id, creds });
    } catch (error: unknown) {
      const problem = brokerProblem(error, "call");
      if (problem.code === "NEEDS_RELOGIN" || problem.code === "BROKER_REJECTED") {
        return this.requireLogin(userId, row, "renew_refused", now);
      }
      this.logger.warn({ brokerAccountId: id, broker: row.broker, code: problem.code }, "broker token renewal failed");
      return "failed";
    }
    const sealed = this.vault.sealCredentials(scope, dataKey, {
      ...renewed,
      clientId: renewed.clientId ?? creds.clientId,
    });
    const tokenExpiresAt = renewed.expiresAt ?? dhanExpiry(undefined, renewed.accessToken.reveal(), now);
    const stored = await this.prisma.db.$transaction(async (tx) => {
      const changed = await this.accounts.update(
        tx,
        userId,
        id,
        {
          encryptedCredentials: sealed.ciphertext,
          credentialsIv: sealed.iv,
          tokenExpiresAt,
          expiryNotifiedAt: null,
          lastError: null,
        },
        { status: "ACTIVE", tokenExpiresAt: row.tokenExpiresAt },
      );
      if (changed) {
        await this.audit.record(tx, {
          action: "broker.renew",
          actor: { type: "system" },
          subjectUserId: userId,
          entity: { type: "BrokerAccount", id },
          data: { broker: row.broker, tokenExpiresAt: tokenExpiresAt.toISOString() },
        });
      }
      return changed;
    });
    if (!stored) {
      this.logger.warn({ brokerAccountId: id, broker: row.broker }, "account changed during token renewal");
      return "skipped";
    }
    this.events.activated({ userId, accountId: id, broker: row.broker });
    return "renewed";
  }

  /** ACTIVE → NEEDS_RELOGIN with a notification and an audit row, unless the account changed meanwhile. */
  private async requireLogin(
    userId: string,
    row: BrokerAccountSecretRow,
    reason: ReloginReason,
    now: Date,
  ): Promise<RenewOutcome> {
    const name = BROKER_NAMES[row.broker] ?? row.broker;
    const what = reason === "expired" ? "has expired" : "could not be renewed";
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const updated = await this.accounts.update(
        tx,
        userId,
        row.id,
        {
          status: "NEEDS_RELOGIN",
          lastError: `The ${name} access token ${what}. Generate a new one on ${name} and connect again.`,
          expiryNotifiedAt: now,
        },
        { status: "ACTIVE", tokenExpiresAt: row.tokenExpiresAt },
      );
      if (!updated) return false;
      await this.accounts.notify(tx, userId, {
        title: `Log in to ${name} again`,
        body: `The access token of "${row.label}" ${what}. Generate a new one on ${name} and connect again.`,
        severity: "warning",
        data: { brokerAccountId: row.id, broker: row.broker },
      });
      await this.audit.record(tx, {
        action: "broker.expire",
        actor: { type: "system" },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id: row.id },
        data: { broker: row.broker, reason },
      });
      return true;
    });
    if (!changed) return "skipped";
    this.events.deactivated({ userId, accountId: row.id, broker: row.broker });
    return "relogin";
  }
}
