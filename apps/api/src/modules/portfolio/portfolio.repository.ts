/**
 * What the portfolio reads besides the broker: the user's broker accounts (no secret columns; every query scoped by
 * `userId`), our instrument master, the `quote:<key>` hashes the shared feed writes, and its own 5-second view cache
 * (`portfolio:<userId>:<accountId>:<kind>`, infra/redis/keys.ts).
 */
import type { BrokerAccountStatus, BrokerCode, Prisma } from "@finlytics/database";
import { quoteFromHash } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";

import type { InstrumentInfo, QuotePrices } from "./portfolio.mapper";

/** A broker account as the portfolio needs it: which one, which broker, whether it works. */
export interface PortfolioAccountRow {
  readonly id: string;
  readonly broker: BrokerCode;
  readonly status: BrokerAccountStatus;
}

const ACCOUNT_SELECT = { id: true, broker: true, status: true } as const satisfies Prisma.BrokerAccountSelect;

const INSTRUMENT_SELECT = {
  key: true,
  exchange: true,
  segment: true,
  symbol: true,
  tradingSymbol: true,
  name: true,
  lotSize: true,
} as const satisfies Prisma.InstrumentSelect;

/** Statuses that a new login fixes: the account exists and worked before. */
const RELOGIN_STATUSES: BrokerAccountStatus[] = ["NEEDS_RELOGIN", "EXPIRED"];

@Injectable()
export class PortfolioRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** One of the user's accounts, whatever its status; null when it isn't theirs. */
  findAccount(userId: string, id: string): Promise<PortfolioAccountRow | null> {
    return this.prisma.db.brokerAccount.findFirst({ where: { id, userId }, select: ACCOUNT_SELECT });
  }

  /** The default ACTIVE account, else the most recently connected ACTIVE one (BrokersRepository.findDefaultActive). */
  findDefaultAccount(userId: string): Promise<PortfolioAccountRow | null> {
    return this.prisma.db.brokerAccount.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { lastLoginAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      select: ACCOUNT_SELECT,
    });
  }

  /** Whether the user has an account that only needs a new broker login (index: userId, status). */
  async needsLogin(userId: string): Promise<boolean> {
    return (await this.prisma.db.brokerAccount.count({ where: { userId, status: { in: RELOGIN_STATUSES } } })) > 0;
  }

  /** Our instrument master's rows for these keys (unknown keys are simply missing). */
  instruments(keys: readonly string[]): Promise<InstrumentInfo[]> {
    if (keys.length === 0) return Promise.resolve([]);
    return this.prisma.db.instrument.findMany({ where: { key: { in: [...keys] } }, select: INSTRUMENT_SELECT });
  }

  /** The cached last and previous-close prices of these keys, in one pipeline (keys without a valid quote are left out). */
  async quotes(keys: readonly string[]): Promise<Map<string, QuotePrices>> {
    const prices = new Map<string, QuotePrices>();
    if (keys.length === 0) return prices;
    const pipeline = this.redis.client.pipeline();
    for (const key of keys) pipeline.hmget(redisKeys.quote(key), "ltp", "close", "ts");
    const replies = (await pipeline.exec()) ?? [];
    replies.forEach(([error, value], index) => {
      if (error !== null) throw error;
      const key = keys[index];
      if (key === undefined || !Array.isArray(value)) return;
      const [ltp, close, ts] = value as (string | null)[];
      const quote = quoteFromHash({ ltp: ltp ?? undefined, close: close ?? undefined, ts: ts ?? undefined });
      if (quote !== undefined) prices.set(key, { ltp: quote.ltp, close: quote.close });
    });
    return prices;
  }

  /** A cached view (JSON), or null. */
  readCache(key: string): Promise<string | null> {
    return this.redis.client.get(key);
  }

  async writeCache(key: string, json: string, ttlMs: number): Promise<void> {
    await this.redis.client.set(key, json, "PX", ttlMs);
  }
}
