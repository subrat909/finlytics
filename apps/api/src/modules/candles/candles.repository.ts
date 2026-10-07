/**
 * Timescale `Candle` rows. Candle is market data no user owns (an unowned model for the tenancy guard): reads and
 * writes are keyed by instrument and timeframe, never by user. Queries use the primary key
 * `(instrumentKey, timeframe, ts)`, which serves the range scans below.
 */
import type { Candle } from "@finlytics/broker-sdk";
import { toDecimalString } from "@finlytics/shared";
import type { CandleBar, CandleTimeframe, InstrumentKey } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

/** Rows per insert statement. */
const INSERT_CHUNK = 1_000;

@Injectable()
export class CandlesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Bars in `[from, to)`, ascending. */
  async findRange(key: InstrumentKey, timeframe: CandleTimeframe, from: Date, to: Date): Promise<CandleBar[]> {
    const rows = await this.prisma.db.candle.findMany({
      where: { instrumentKey: key, timeframe, ts: { gte: from, lt: to } },
      orderBy: { ts: "asc" },
      select: { ts: true, open: true, high: true, low: true, close: true, volume: true, oi: true },
    });
    return rows.map((row) => ({
      ts: row.ts.getTime(),
      open: toDecimalString(row.open),
      high: toDecimalString(row.high),
      low: toDecimalString(row.low),
      close: toDecimalString(row.close),
      volume: Number(row.volume),
      ...(row.oi === null ? {} : { oi: Number(row.oi) }),
    }));
  }

  /** Stores bars; bars already stored (same key, timeframe and start) are left as they are. Returns rows inserted. */
  async insertMany(key: InstrumentKey, timeframe: CandleTimeframe, candles: readonly Candle[]): Promise<number> {
    let inserted = 0;
    for (let index = 0; index < candles.length; index += INSERT_CHUNK) {
      const { count } = await this.prisma.db.candle.createMany({
        data: candles.slice(index, index + INSERT_CHUNK).map((candle) => ({
          instrumentKey: key,
          timeframe,
          ts: new Date(candle.ts),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: BigInt(candle.volume),
          oi: candle.oi === undefined ? null : BigInt(candle.oi),
        })),
        skipDuplicates: true,
      });
      inserted += count;
    }
    return inserted;
  }
}
