/**
 * BrokerAccount rows, through the tenancy-guarded client: every query is scoped by `userId` (`where: { id, userId }`).
 * Vault columns are read only by the methods that return them to the service, which hands them to VaultService.
 */
import type { BrokerAccountStatus, BrokerCode, Prisma } from "@finlytics/database";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import type { TenantPrismaClient, TenantTransaction } from "../../infra/prisma/prisma.service";

import type { BrokerAccountViewRow } from "./broker-account.mapper";

/** The columns a view shows. */
export const VIEW_SELECT = {
  id: true,
  broker: true,
  label: true,
  status: true,
  isDefault: true,
  tokenExpiresAt: true,
  lastLoginAt: true,
  lastError: true,
} as const satisfies Prisma.BrokerAccountSelect;

/** The view columns plus everything the vault needs. */
const SECRET_SELECT = {
  ...VIEW_SELECT,
  userId: true,
  encKeyWrapped: true,
  encKeyIv: true,
  encKeyVersion: true,
  encryptedCredentials: true,
  credentialsIv: true,
  brokerClientIdEnc: true,
  brokerClientIdIv: true,
  appCredentialsEnc: true,
  appCredentialsIv: true,
} as const satisfies Prisma.BrokerAccountSelect;

export type BrokerAccountSecretRow = Prisma.BrokerAccountGetPayload<{ select: typeof SECRET_SELECT }>;

/** Plan limits when a user has no plan, or the plan has gone: the free plan's defaults (schema.prisma `Plan`). */
export const DEFAULT_MAX_BROKER_ACCOUNTS = 1;

type Db = TenantPrismaClient | TenantTransaction;

@Injectable()
export class BrokersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's accounts, oldest first. */
  list(userId: string): Promise<BrokerAccountViewRow[]> {
    return this.prisma.db.brokerAccount.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: VIEW_SELECT,
    });
  }

  findView(userId: string, id: string, db: Db = this.prisma.db): Promise<BrokerAccountViewRow | null> {
    return db.brokerAccount.findFirst({ where: { id, userId }, select: VIEW_SELECT });
  }

  findSecrets(userId: string, id: string, db: Db = this.prisma.db): Promise<BrokerAccountSecretRow | null> {
    return db.brokerAccount.findFirst({ where: { id, userId }, select: SECRET_SELECT });
  }

  findByLabel(db: Db, userId: string, broker: BrokerCode, label: string): Promise<BrokerAccountSecretRow | null> {
    return db.brokerAccount.findFirst({ where: { userId, broker, label }, select: SECRET_SELECT });
  }

  /** The default ACTIVE account, else the most recently connected ACTIVE one. */
  findDefaultActive(userId: string): Promise<BrokerAccountSecretRow | null> {
    return this.prisma.db.brokerAccount.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { lastLoginAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      select: SECRET_SELECT,
    });
  }

  /** The owner of an account, for system callers that know only its id (the shared feed account). Raw: no user yet. */
  async ownerOf(id: string): Promise<string | null> {
    const rows = await this.prisma.db.$queryRaw<{ userId: string }[]>`
      SELECT "userId" FROM "BrokerAccount" WHERE "id" = ${id}`;
    return rows[0]?.userId ?? null;
  }

  /** Locks the user's row until `tx` ends, so limit checks and inserts for one user run one at a time. */
  async lockUser(tx: TenantTransaction, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }

  /** The user's plan limit on broker accounts. */
  async maxBrokerAccounts(db: Db, userId: string): Promise<number> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { plan: { select: { maxBrokerAccounts: true } } },
    });
    return user?.plan?.maxBrokerAccounts ?? DEFAULT_MAX_BROKER_ACCOUNTS;
  }

  /** How many accounts the user has of real brokers and of the paper broker. */
  async counts(db: Db, userId: string): Promise<{ brokers: number; paper: number }> {
    const [brokers, paper] = await Promise.all([
      db.brokerAccount.count({ where: { userId, broker: { not: "PAPER" } } }),
      db.brokerAccount.count({ where: { userId, broker: "PAPER" } }),
    ]);
    return { brokers, paper };
  }

  async hasDefault(db: Db, userId: string): Promise<boolean> {
    return (await db.brokerAccount.count({ where: { userId, isDefault: true } })) > 0;
  }

  async create(
    tx: TenantTransaction,
    data: Omit<Prisma.BrokerAccountUncheckedCreateInput, "userId"> & { userId: string; id: string },
  ): Promise<BrokerAccountViewRow> {
    return tx.brokerAccount.create({ data, select: VIEW_SELECT });
  }

  /** Updates one account of the user; false when it doesn't exist (or isn't theirs). */
  async update(
    db: Db,
    userId: string,
    id: string,
    data: Prisma.BrokerAccountUncheckedUpdateManyInput,
    where: { status?: BrokerAccountStatus } = {},
  ): Promise<boolean> {
    const result = await db.brokerAccount.updateMany({ where: { id, userId, ...where }, data });
    return result.count === 1;
  }

  async clearDefault(tx: TenantTransaction, userId: string): Promise<void> {
    await tx.brokerAccount.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }

  /** Deletes one account of the user (after clearing auto-trade's NO ACTION reference to it). */
  async delete(tx: TenantTransaction, userId: string, id: string): Promise<boolean> {
    await tx.autoTradeConfig.updateMany({ where: { userId, brokerAccountId: id }, data: { brokerAccountId: null } });
    const result = await tx.brokerAccount.deleteMany({ where: { id, userId } });
    return result.count === 1;
  }
}
