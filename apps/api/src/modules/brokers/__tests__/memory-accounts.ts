/** An in-memory BrokersRepository for service unit tests: the same scoping (every method takes userId). */
import type { BrokerCode } from "@finlytics/shared";

import type { BrokerAccountViewRow } from "../broker-account.mapper";
import type {
  AccountCondition,
  BrokerAccountSecretRow,
  BrokerNotification,
  BrokersRepository,
} from "../brokers.repository";

type Row = BrokerAccountSecretRow & { createdAt: number; expiryNotifiedAt: Date | null };

function view(row: Row): BrokerAccountViewRow {
  return {
    id: row.id,
    broker: row.broker,
    label: row.label,
    status: row.status,
    isDefault: row.isDefault,
    tokenExpiresAt: row.tokenExpiresAt,
    lastLoginAt: row.lastLoginAt,
    lastError: row.lastError,
  };
}

export class MemoryAccounts {
  readonly rows = new Map<string, Row>();
  readonly notifications: (BrokerNotification & { userId: string })[] = [];
  maxAccounts = 1;
  locks = 0;
  #clock = 0;

  get(id: string): Row | undefined {
    return this.rows.get(id);
  }

  /** The row, or a failed test. */
  must(id: string): Row {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`no account ${id}`);
    return row;
  }

  private mine(userId: string): Row[] {
    return [...this.rows.values()].filter((row) => row.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  }

  private find(userId: string, id: string): Row | undefined {
    const row = this.rows.get(id);
    return row?.userId === userId ? row : undefined;
  }

  readonly repository = {
    list: (userId: string) => Promise.resolve(this.mine(userId).map(view)),
    findView: (userId: string, id: string) => {
      const row = this.find(userId, id);
      return Promise.resolve(row === undefined ? null : view(row));
    },
    findSecrets: (userId: string, id: string) => Promise.resolve(this.find(userId, id) ?? null),
    findByLabel: (_db: unknown, userId: string, broker: BrokerCode, label: string) =>
      Promise.resolve(this.mine(userId).find((row) => row.broker === broker && row.label === label) ?? null),
    findDefaultActive: (userId: string) => {
      const active = this.mine(userId).filter((row) => row.status === "ACTIVE");
      return Promise.resolve(active.find((row) => row.isDefault) ?? active.at(-1) ?? null);
    },
    ownerOf: (id: string) => Promise.resolve(this.rows.get(id)?.userId ?? null),
    lockUser: () => {
      this.locks += 1;
      return Promise.resolve();
    },
    maxBrokerAccounts: () => Promise.resolve(this.maxAccounts),
    counts: (_db: unknown, userId: string) => {
      const rows = this.mine(userId);
      return Promise.resolve({
        brokers: rows.filter((row) => row.broker !== "PAPER").length,
        paper: rows.filter((row) => row.broker === "PAPER").length,
      });
    },
    hasDefault: (_db: unknown, userId: string) => Promise.resolve(this.mine(userId).some((row) => row.isDefault)),
    create: (_tx: unknown, data: Record<string, unknown>) => {
      this.#clock += 1;
      const row = {
        status: "PENDING",
        isDefault: false,
        tokenExpiresAt: null,
        lastLoginAt: null,
        lastError: null,
        encryptedCredentials: null,
        credentialsIv: null,
        brokerClientIdEnc: null,
        brokerClientIdIv: null,
        appCredentialsEnc: null,
        appCredentialsIv: null,
        expiryNotifiedAt: null,
        encKeyVersion: 1,
        ...data,
        createdAt: this.#clock,
      } as Row;
      this.rows.set(row.id, row);
      return Promise.resolve(view(row));
    },
    update: (_db: unknown, userId: string, id: string, data: Record<string, unknown>, where: AccountCondition = {}) => {
      const row = this.find(userId, id);
      if (
        row === undefined ||
        (where.status !== undefined && row.status !== where.status) ||
        (where.tokenExpiresAt !== undefined && row.tokenExpiresAt?.getTime() !== where.tokenExpiresAt?.getTime())
      ) {
        return Promise.resolve(false);
      }
      this.rows.set(id, { ...row, ...data });
      return Promise.resolve(true);
    },
    notify: (_tx: unknown, userId: string, input: BrokerNotification) => {
      this.notifications.push({ ...input, userId });
      return Promise.resolve();
    },
    clearDefault: (_tx: unknown, userId: string) => {
      for (const row of this.mine(userId)) this.rows.set(row.id, { ...row, isDefault: false });
      return Promise.resolve();
    },
    delete: (_tx: unknown, userId: string, id: string) =>
      Promise.resolve(this.find(userId, id) !== undefined && this.rows.delete(id)),
  };

  asRepository(): BrokersRepository {
    return this.repository as unknown as BrokersRepository;
  }
}
