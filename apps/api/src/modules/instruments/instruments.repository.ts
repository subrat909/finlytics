/**
 * Instrument and InstrumentBrokerToken (reference data, no owner). Search and the master import use raw SQL with
 * tagged templates (bound parameters; trigram operators and `INSERT … SELECT FROM unnest(…)` batches that Prisma's
 * query API can't express).
 */
import type { InstrumentRow } from "@finlytics/broker-sdk";
import { Prisma } from "@finlytics/database";
import type { BrokerCode, Exchange, Segment } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

import { INSTRUMENT_SELECT, modelToInstrument } from "./instrument.mapper";
import type { InstrumentRecord } from "./instrument.mapper";
import type { SearchTerms } from "./search-terms";

export interface SearchFilters {
  readonly exchange?: Exchange | undefined;
  readonly segment?: Segment | undefined;
  readonly limit: number;
}

/** The columns every raw read returns, decimals and dates as canonical text. */
const RECORD_COLUMNS = Prisma.sql`
  "key", "exchange"::text AS "exchange", "segment"::text AS "segment", "symbol", "tradingSymbol", "name",
  to_char("expiry", 'YYYY-MM-DD') AS "expiry", trim_scale("strike")::text AS "strike",
  "optionType"::text AS "optionType", "lotSize", trim_scale("tickSize")::text AS "tickSize", "isActive"`;

@Injectable()
export class InstrumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active instruments matching `terms`: a prefix of the symbol or trading symbol, a substring of the name, trigram
   * similarity (pg_trgm `%`, GIN indexes on symbol, trading symbol and name), or the structured option terms. Ranked:
   * structured option match, symbol prefix, segment (index, equity, future, option), exact symbol, similarity, then
   * nearest expiry and strike.
   */
  search(terms: SearchTerms, filters: SearchFilters): Promise<InstrumentRecord[]> {
    const prefix = `${terms.rawPattern}%`;
    const infix = `%${terms.rawPattern}%`;
    const option = terms.option;
    const optionMatch =
      option === undefined
        ? Prisma.empty
        : Prisma.sql`("segment" = 'OPT' AND "symbol" ILIKE ${`${option.underlyingPattern}%`}
            ${option.strike === undefined ? Prisma.empty : Prisma.sql`AND "strike" = ${option.strike}::numeric`}
            ${option.optionType === undefined ? Prisma.empty : Prisma.sql`AND "optionType" = ${option.optionType}::"OptionType"`})`;
    return this.prisma.db.$queryRaw<InstrumentRecord[]>`
      SELECT ${RECORD_COLUMNS}
      FROM "Instrument"
      WHERE "isActive"
        ${filters.exchange === undefined ? Prisma.empty : Prisma.sql`AND "exchange" = ${filters.exchange}::"Exchange"`}
        ${filters.segment === undefined ? Prisma.empty : Prisma.sql`AND "segment" = ${filters.segment}::"Segment"`}
        AND (
          "symbol" ILIKE ${prefix} OR "tradingSymbol" ILIKE ${prefix} OR "name" ILIKE ${infix}
          OR "symbol" % ${terms.raw} OR "name" % ${terms.raw}
          ${option === undefined ? Prisma.empty : Prisma.sql`OR ${optionMatch}`}
        )
      ORDER BY
        ${option === undefined ? Prisma.empty : Prisma.sql`${optionMatch} DESC,`}
        ("symbol" ILIKE ${prefix} OR "tradingSymbol" ILIKE ${prefix}) DESC,
        CASE "segment" WHEN 'INDEX' THEN 0 WHEN 'EQ' THEN 1 WHEN 'FUT' THEN 2 ELSE 3 END,
        (upper("symbol") = ${terms.raw}) DESC,
        greatest(similarity("symbol", ${terms.raw}), similarity("name", ${terms.raw})) DESC,
        "expiry" ASC NULLS FIRST, "strike" ASC NULLS FIRST, "key" ASC
      LIMIT ${filters.limit}`;
  }

  async findByKey(key: string): Promise<InstrumentRecord | null> {
    const row = await this.prisma.db.instrument.findUnique({ where: { key }, select: INSTRUMENT_SELECT });
    return row === null ? null : { ...modelToInstrument(row) };
  }

  /** Active instruments among `keys` (watchlist adds check this). */
  async existingActive(keys: readonly string[]): Promise<Set<string>> {
    const rows = await this.prisma.db.instrument.findMany({
      where: { key: { in: [...keys] }, isActive: true },
      select: { key: true },
    });
    return new Set(rows.map((row) => row.key));
  }

  /** How many of `broker`'s tokens are active (the completeness check of a sync compares against it). */
  activeTokenCount(broker: BrokerCode): Promise<number> {
    return this.prisma.db.instrumentBrokerToken.count({ where: { broker, isActive: true } });
  }

  /**
   * Upserts one batch of master rows: the instruments (columns from the row, `brokerTokens[broker]` merged in, active)
   * and the reverse map (`seenAt` = the run's start, active). Rows must have distinct keys and distinct tokens.
   */
  async upsertBatch(broker: BrokerCode, rows: readonly InstrumentRow[], seenAt: Date): Promise<void> {
    if (rows.length === 0) return;
    const column = <T>(pick: (row: InstrumentRow) => T): T[] => rows.map(pick);
    await this.prisma.db.$transaction([
      this.prisma.db.$executeRaw`
        INSERT INTO "Instrument" ("key", "exchange", "segment", "symbol", "tradingSymbol", "name", "isin", "expiry",
          "strike", "optionType", "lotSize", "tickSize", "freezeQty", "brokerTokens", "isActive", "updatedAt")
        SELECT r.key, r.exchange::"Exchange", r.segment::"Segment", r.symbol, r.trading_symbol, r.name, r.isin,
          r.expiry::date, r.strike::numeric, r.option_type::"OptionType", r.lot_size, r.tick_size::numeric,
          r.freeze_qty, jsonb_build_object(${broker}::text, r.token), true, (now() AT TIME ZONE 'UTC')
        FROM unnest(
          ${column((row) => row.instrumentKey)}::text[], ${column((row) => row.exchange)}::text[],
          ${column((row) => row.segment)}::text[], ${column((row) => symbolOf(row))}::text[],
          ${column((row) => row.tradingSymbol)}::text[], ${column((row) => row.name)}::text[],
          ${column((row) => row.isin ?? null)}::text[], ${column((row) => row.expiry ?? null)}::text[],
          ${column((row) => row.strike ?? null)}::text[], ${column((row) => row.optionType ?? null)}::text[],
          ${column((row) => row.lotSize)}::int[], ${column((row) => row.tickSize)}::text[],
          ${column((row) => row.freezeQty ?? null)}::int[], ${column((row) => row.brokerToken)}::text[]
        ) AS r(key, exchange, segment, symbol, trading_symbol, name, isin, expiry, strike, option_type, lot_size,
          tick_size, freeze_qty, token)
        ON CONFLICT ("key") DO UPDATE SET
          "tradingSymbol" = EXCLUDED."tradingSymbol", "name" = EXCLUDED."name", "isin" = EXCLUDED."isin",
          "lotSize" = EXCLUDED."lotSize", "tickSize" = EXCLUDED."tickSize", "freezeQty" = EXCLUDED."freezeQty",
          "brokerTokens" = "Instrument"."brokerTokens" || EXCLUDED."brokerTokens", "isActive" = true,
          "updatedAt" = EXCLUDED."updatedAt"`,
      this.prisma.db.$executeRaw`
        INSERT INTO "InstrumentBrokerToken" ("broker", "token", "instrumentKey", "isActive", "seenAt")
        SELECT ${broker}::"BrokerCode", t.token, t.key, true, ${seenAt}::timestamp(3)
        FROM unnest(${column((row) => row.brokerToken)}::text[], ${column((row) => row.instrumentKey)}::text[])
          AS t(token, key)
        ON CONFLICT ("broker", "token") DO UPDATE SET
          "instrumentKey" = EXCLUDED."instrumentKey", "isActive" = true, "seenAt" = EXCLUDED."seenAt"`,
    ]);
  }

  /**
   * After a complete run of `broker`: its tokens not seen since `seenAt` become inactive, and so does every instrument
   * left without an active token of any broker. Nothing is deleted. Returns the instruments deactivated.
   */
  deactivateMissing(broker: BrokerCode, seenAt: Date): Promise<number> {
    return this.prisma.db.$executeRaw`
      WITH stale AS (
        UPDATE "InstrumentBrokerToken" SET "isActive" = false
        WHERE "broker" = ${broker}::"BrokerCode" AND "isActive" AND "seenAt" < ${seenAt}::timestamp(3)
        RETURNING "instrumentKey"
      )
      UPDATE "Instrument" AS i SET "isActive" = false, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM (SELECT DISTINCT "instrumentKey" FROM stale) AS s
      WHERE i."key" = s."instrumentKey" AND i."isActive"
        AND NOT EXISTS (
          SELECT 1 FROM "InstrumentBrokerToken" AS t
          WHERE t."instrumentKey" = i."key" AND t."isActive"
            AND NOT (t."broker" = ${broker}::"BrokerCode" AND t."seenAt" < ${seenAt}::timestamp(3))
        )`;
  }
}

/** `Instrument.symbol`: the key's second part (EQ/INDEX trading symbol, FUT/OPT underlying). */
export function symbolOf(row: Pick<InstrumentRow, "instrumentKey">): string {
  return row.instrumentKey.split("|")[1] ?? "";
}
