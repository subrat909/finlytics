import type { Exchange, Instrument, OptionType, Segment } from "@finlytics/shared";

/** An instrument as the repository reads it (decimals and the expiry already as canonical text). */
export interface InstrumentRecord {
  readonly key: string;
  readonly exchange: Exchange;
  readonly segment: Segment;
  readonly symbol: string;
  readonly tradingSymbol: string | null;
  readonly name: string;
  readonly expiry: string | null;
  readonly strike: string | null;
  readonly optionType: OptionType | null;
  readonly lotSize: number;
  readonly tickSize: string;
  readonly isActive: boolean;
}

/** A Prisma-read instrument (Decimal and Date columns). */
export interface InstrumentModelRow {
  readonly key: string;
  readonly exchange: Exchange;
  readonly segment: Segment;
  readonly symbol: string;
  readonly tradingSymbol: string | null;
  readonly name: string;
  readonly expiry: Date | null;
  readonly strike: { toFixed(): string } | null;
  readonly optionType: OptionType | null;
  readonly lotSize: number;
  readonly tickSize: { toFixed(): string };
  readonly isActive: boolean;
}

/** The Prisma `select` for {@link InstrumentModelRow}. */
export const INSTRUMENT_SELECT = {
  key: true,
  exchange: true,
  segment: true,
  symbol: true,
  tradingSymbol: true,
  name: true,
  expiry: true,
  strike: true,
  optionType: true,
  lotSize: true,
  tickSize: true,
  isActive: true,
} as const;

/** A decimal without trailing zeros: `"25000.0000"` → `"25000"`, `"0.0500"` → `"0.05"`. */
export function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

export function toInstrument(row: InstrumentRecord): Instrument {
  return {
    key: row.key,
    exchange: row.exchange,
    segment: row.segment,
    symbol: row.symbol,
    tradingSymbol: row.tradingSymbol,
    name: row.name,
    expiry: row.expiry,
    strike: row.strike === null ? null : trimDecimal(row.strike),
    optionType: row.optionType,
    lotSize: row.lotSize,
    tickSize: trimDecimal(row.tickSize),
    isActive: row.isActive,
  };
}

/** A Prisma-read instrument as the api shows it. */
export function modelToInstrument(row: InstrumentModelRow): Instrument {
  return toInstrument({
    ...row,
    expiry: row.expiry?.toISOString().slice(0, 10) ?? null,
    strike: row.strike?.toFixed() ?? null,
    tickSize: row.tickSize.toFixed(),
  });
}
