/**
 * Connected accounts for other modules (candles backfill, the market feed, later orders): the decrypted credentials of
 * an ACTIVE account as a `BrokerAccountRef`, with the broker's shared gateway. Credentials stay Secret-wrapped; nothing
 * here returns or logs a plaintext token.
 *
 * - `accountRef(userId, id)`: one of the user's accounts (404 if not theirs; NEEDS_RELOGIN unless ACTIVE).
 * - `defaultAccountRef(userId)`: the user's default ACTIVE account, else their latest ACTIVE one, else null.
 * - `systemAccountRef(id)`: an account known only by id (MARKET_FEED_ACCOUNT_ID, plan P2), else null.
 * - `markNeedsRelogin(userId, id)`: after the broker refused the token (NeedsReloginError), audited as the system.
 */
import type { BrokerAccountRef, BrokerGateway } from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { NotFoundError } from "../../common/problem-json/domain-errors";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { VaultService } from "../../infra/vault/vault.service";
import { AuditService } from "../audit/audit.service";

import { BrokerDomainError } from "./broker-errors";
import { BrokerGateways } from "./broker-gateways";
import { BrokersRepository } from "./brokers.repository";
import type { BrokerAccountSecretRow } from "./brokers.repository";
import { dataKeyOf } from "./brokers.service";

/** An ACTIVE account, ready for gateway calls. */
export interface ConnectedAccount {
  readonly userId: string;
  readonly broker: BrokerCode;
  readonly ref: BrokerAccountRef;
  readonly gateway: BrokerGateway;
}

@Injectable()
export class BrokerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: BrokersRepository,
    private readonly vault: VaultService,
    private readonly gateways: BrokerGateways,
    private readonly audit: AuditService,
  ) {}

  /** @throws {NotFoundError} when the account isn't the user's; NEEDS_RELOGIN (409) when it isn't ACTIVE. */
  async accountRef(userId: string, id: string): Promise<ConnectedAccount> {
    const row = await this.accounts.findSecrets(userId, id);
    if (row === null) throw new NotFoundError("Broker account not found.");
    const connected = this.connected(userId, row);
    if (connected === null) throw new BrokerDomainError("NEEDS_RELOGIN", "Log in to your broker again to continue.");
    return connected;
  }

  async defaultAccountRef(userId: string): Promise<ConnectedAccount | null> {
    const row = await this.accounts.findDefaultActive(userId);
    return row === null ? null : this.connected(userId, row);
  }

  async systemAccountRef(id: string): Promise<ConnectedAccount | null> {
    const userId = await this.accounts.ownerOf(id);
    if (userId === null) return null;
    const row = await this.accounts.findSecrets(userId, id);
    return row === null ? null : this.connected(userId, row);
  }

  /** Flags an ACTIVE account whose token the broker refused; true when this call changed it. */
  async markNeedsRelogin(userId: string, id: string): Promise<boolean> {
    return this.prisma.db.$transaction(async (tx) => {
      const changed = await this.accounts.update(
        tx,
        userId,
        id,
        { status: "NEEDS_RELOGIN", lastError: "The broker session has ended. Log in again." },
        { status: "ACTIVE" },
      );
      if (changed) {
        await this.audit.record(tx, {
          action: "broker.expire",
          actor: { type: "system" },
          subjectUserId: userId,
          entity: { type: "BrokerAccount", id },
          data: { reason: "refused" },
        });
      }
      return changed;
    });
  }

  private connected(userId: string, row: BrokerAccountSecretRow): ConnectedAccount | null {
    if (row.status !== "ACTIVE" || row.encryptedCredentials === null || row.credentialsIv === null) return null;
    const creds = this.vault.openCredentials({ userId, brokerAccountId: row.id }, dataKeyOf(row), {
      ciphertext: row.encryptedCredentials,
      iv: row.credentialsIv,
    });
    return {
      userId,
      broker: row.broker,
      ref: { accountId: row.id, creds },
      gateway: this.gateways.gateway(row.broker),
    };
  }
}
