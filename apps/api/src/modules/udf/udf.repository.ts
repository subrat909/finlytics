/**
 * Instrument reads for the UDF datafeed. Instrument is reference data (an unowned model): no user scoping applies.
 * Search uses the trigram GIN indexes on `name` and `symbol` (ILIKE) and returns the plain segments first.
 */
import type { Exchange, Segment } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

/** What symbol info and search need of an instrument. */
export interface UdfInstrumentRow {
  readonly key: string;
  readonly exchange: Exchange;
  readonly segment: Segment;
  readonly symbol: string;
  readonly name: string;
  readonly tickSize: { toFixed(): string };
}

const SELECT = { key: true, exchange: true, segment: true, symbol: true, name: true, tickSize: true } as const;

@Injectable()
export class UdfRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(key: string): Promise<UdfInstrumentRow | null> {
    return this.prisma.db.instrument.findFirst({ where: { key, isActive: true }, select: SELECT });
  }

  search(
    query: string,
    limit: number,
    filters: { readonly exchange?: Exchange | undefined; readonly segment?: Segment | undefined },
  ): Promise<UdfInstrumentRow[]> {
    const text = query.trim();
    return this.prisma.db.instrument.findMany({
      where: {
        isActive: true,
        ...(filters.exchange === undefined ? {} : { exchange: filters.exchange }),
        ...(filters.segment === undefined ? {} : { segment: filters.segment }),
        ...(text === ""
          ? {}
          : {
              OR: [
                { symbol: { startsWith: text, mode: "insensitive" as const } },
                { name: { contains: text, mode: "insensitive" as const } },
                { key: { contains: text, mode: "insensitive" as const } },
              ],
            }),
      },
      orderBy: [{ segment: "asc" }, { symbol: "asc" }, { key: "asc" }],
      take: limit,
      select: SELECT,
    });
  }
}
