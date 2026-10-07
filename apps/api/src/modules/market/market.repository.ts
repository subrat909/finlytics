/**
 * Reads behind `GET /v1/market/overview`: exchange holidays (`MarketHoliday`, primary key `(exchange, date)`), the
 * display names of the pinned instruments (`Instrument`, by key) and their `quote:*` hashes. All reference or market
 * data: nothing here is owned by a user.
 */
import type { MarketExchange } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";

import type { HolidayEntry } from "./market-sessions";

export interface InstrumentLabel {
  readonly symbol: string;
  readonly name: string;
}

@Injectable()
export class MarketRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Holidays of `exchanges` dated within `[from, to]` (UTC midnights of IST dates). */
  async holidays(exchanges: readonly MarketExchange[], from: Date, to: Date): Promise<HolidayEntry[]> {
    const rows = await this.prisma.db.marketHoliday.findMany({
      where: { exchange: { in: [...exchanges] }, date: { gte: from, lte: to } },
      select: { date: true, exchange: true, name: true, closure: true },
    });
    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      exchange: row.exchange,
      name: row.name,
      closure: row.closure,
    }));
  }

  /** Symbol and name of each key that names an instrument. */
  async labels(keys: readonly string[]): Promise<Map<string, InstrumentLabel>> {
    const rows = await this.prisma.db.instrument.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, symbol: true, name: true },
    });
    return new Map(rows.map((row) => [row.key, { symbol: row.symbol, name: row.name }]));
  }

  /** The `quote:<key>` hash of each key, in order (`{}` without one). A Redis error rejects. */
  async quotes(keys: readonly string[]): Promise<Record<string, string>[]> {
    if (keys.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const key of keys) pipeline.hgetall(redisKeys.quote(key));
    const replies = (await pipeline.exec()) ?? [];
    return replies.map(([error, value]) => {
      if (error !== null) throw error;
      return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
    });
  }
}
