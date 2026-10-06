/**
 * Dhan instruments: the scrip-master CSV → canonical {@link InstrumentRow}s, and the two-way map between our
 * `instrumentKey` and Dhan's `(exchangeSegment, securityId)` pair that orders, positions and both feeds need.
 *
 * - `brokerToken` is `<exchangeSegment>:<securityId>` (`NSE_FNO:52175`): Dhan's security ids are unique only within a
 *   segment (`IDX_I:13` is NIFTY, `NSE_EQ:13` is a stock), so the segment is part of the token.
 * - The CSV is parsed as it streams (no full-file buffer): a small RFC 4180 state machine (quotes, `""`, CRLF, fields
 *   split across chunks), columns looked up by header name, so the detailed and compact files both work.
 * - Indices take the names the rest of the platform uses (`NSE_INDEX|NIFTY 50`), see {@link DHAN_INDEX_ALIASES}.
 *   F&O keys use the underlying symbol (`NSE_FO|NIFTY|2025-10-30|24000|CE`).
 * - Quirks: `TICK_SIZE` is in paise in Dhan's file (5 = ₹0.05) unless `tickSizeUnit: "rupee"`; there is no freeze
 *   quantity column, so `freezeQuantities` (by underlying) supplies it; the first row for a key wins.
 */
import {
  canonicalStrike,
  formatInstrumentKey,
  parseInstrumentKey,
  toDecimal,
  toDecimalString,
} from "@finlytics/shared";
import type { InstrumentKey, OptionType, ParsedInstrumentKey, SegmentToken } from "@finlytics/shared";

import type { InstrumentRow } from "../../models";

import { DHAN_EXCHANGE_SEGMENT_CODES } from "./types";
import type { DhanExchangeSegment, DhanInstrument } from "./types";

/** Where an instrument lives at Dhan. */
export interface DhanInstrumentRef {
  readonly exchangeSegment: DhanExchangeSegment;
  readonly securityId: string;
  /** Annexure "Instrument"; needed by the chart APIs. */
  readonly instrument: DhanInstrument;
}

/** Dhan index symbols → the platform's canonical index names. Others keep Dhan's symbol. */
export const DHAN_INDEX_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FIN SERVICE",
  MIDCPNIFTY: "NIFTY MID SELECT",
  NIFTYNXT50: "NIFTY NEXT 50",
});

/** Index underlyings of F&O contracts (FUTIDX/OPTIDX rather than FUTSTK/OPTSTK) when the master didn't say. */
const INDEX_UNDERLYINGS = new Set([
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "MIDCPNIFTY",
  "NIFTYNXT50",
  "SENSEX",
  "BANKEX",
  "SENSEX50",
]);

const SEGMENT_BY_CODE = new Map<number, DhanExchangeSegment>(
  Object.entries(DHAN_EXCHANGE_SEGMENT_CODES).map(([segment, code]) => [code, segment as DhanExchangeSegment]),
);

/** The segment attribute for a feed packet's numeric segment byte. */
export function segmentFromCode(code: number): DhanExchangeSegment | undefined {
  return SEGMENT_BY_CODE.get(code);
}

/** Our segment token → Dhan's exchange segment (BSE currency has no canonical token, so it never appears). */
const DHAN_SEGMENT_BY_TOKEN: Readonly<Record<SegmentToken, DhanExchangeSegment>> = Object.freeze({
  NSE_EQ: "NSE_EQ",
  NSE_INDEX: "IDX_I",
  NSE_FO: "NSE_FNO",
  NSE_CD: "NSE_CURRENCY",
  BSE_EQ: "BSE_EQ",
  BSE_INDEX: "IDX_I",
  BSE_FO: "BSE_FNO",
  MCX_FO: "MCX_COMM",
});

/** Dhan's exchange segment → our token, for the segments whose keys can be derived without the map. */
const TOKEN_BY_DHAN_SEGMENT: Readonly<Partial<Record<DhanExchangeSegment, SegmentToken>>> = Object.freeze({
  NSE_EQ: "NSE_EQ",
  NSE_FNO: "NSE_FO",
  NSE_CURRENCY: "NSE_CD",
  BSE_EQ: "BSE_EQ",
  BSE_FNO: "BSE_FO",
  MCX_COMM: "MCX_FO",
});

export function dhanSegmentForToken(token: SegmentToken): DhanExchangeSegment {
  return DHAN_SEGMENT_BY_TOKEN[token];
}

export function tokenForDhanSegment(segment: string): SegmentToken | undefined {
  return TOKEN_BY_DHAN_SEGMENT[segment as DhanExchangeSegment];
}

/** The annexure instrument for a key when the master didn't record it (keys loaded from the api's reverse map). */
export function dhanInstrumentFor(key: ParsedInstrumentKey): DhanInstrument {
  if (key.segment === "INDEX") return "INDEX";
  if (key.segment === "EQ") return "EQUITY";
  const future = key.segment === "FUT";
  if (key.token === "MCX_FO") return future ? "FUTCOM" : "OPTFUT";
  if (key.token === "NSE_CD") return future ? "FUTCUR" : "OPTCUR";
  const index = INDEX_UNDERLYINGS.has(key.symbol);
  if (future) return index ? "FUTIDX" : "FUTSTK";
  return index ? "OPTIDX" : "OPTSTK";
}

/** `<exchangeSegment>:<securityId>`, the `brokerToken` of a Dhan instrument row. */
export function dhanBrokerToken(segment: DhanExchangeSegment, securityId: string): string {
  return `${segment}:${securityId}`;
}

/**
 * Both directions of the instrument mapping, in memory. `downloadInstrumentMaster` fills it as it streams; the api can
 * also {@link DhanInstrumentMap.load} it from its `InstrumentBrokerToken` table at startup. Lookups are synchronous
 * (the feed resolves every packet through it).
 */
export class DhanInstrumentMap {
  readonly #byKey = new Map<InstrumentKey, DhanInstrumentRef>();
  readonly #bySecurity = new Map<string, InstrumentKey>();

  get size(): number {
    return this.#byKey.size;
  }

  set(key: InstrumentKey, ref: DhanInstrumentRef): void {
    const previous = this.#byKey.get(key);
    if (previous !== undefined) this.#bySecurity.delete(dhanBrokerToken(previous.exchangeSegment, previous.securityId));
    this.#byKey.set(key, ref);
    this.#bySecurity.set(dhanBrokerToken(ref.exchangeSegment, ref.securityId), key);
  }

  /**
   * Adds `(instrumentKey, brokerToken)` pairs, e.g. from the api's reverse-map table. Pairs with an unknown key or a
   * token that isn't `<exchangeSegment>:<securityId>` are skipped; returns how many were added.
   */
  load(rows: Iterable<{ readonly instrumentKey: string; readonly brokerToken: string }>): number {
    let added = 0;
    for (const row of rows) {
      const parsed = parseInstrumentKey(row.instrumentKey);
      const separator = row.brokerToken.indexOf(":");
      const segment = row.brokerToken.slice(0, separator);
      const securityId = row.brokerToken.slice(separator + 1);
      if (!parsed.ok || separator < 1 || !(segment in DHAN_EXCHANGE_SEGMENT_CODES) || !/^\d+$/.test(securityId)) {
        continue;
      }
      this.set(parsed.value.key, {
        exchangeSegment: segment as DhanExchangeSegment,
        securityId,
        instrument: dhanInstrumentFor(parsed.value),
      });
      added += 1;
    }
    return added;
  }

  get(key: InstrumentKey): DhanInstrumentRef | undefined {
    return this.#byKey.get(key);
  }

  keyOf(segment: string, securityId: string): InstrumentKey | undefined {
    return this.#bySecurity.get(`${segment}:${securityId}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV

/**
 * Splits a stream of text chunks into CSV records (RFC 4180: quoted fields, `""` escapes, CR/LF/CRLF line ends,
 * newlines inside quotes). Empty lines are skipped.
 */
export async function* parseCsv(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let quoteSeen = false; // the previous character closed a quote (or was the first of `""`)
  let pendingCr = false;

  const endField = (): void => {
    record.push(field);
    field = "";
  };
  const endRecord = (): string[] | undefined => {
    endField();
    const done = record;
    record = [];
    return done.length === 1 && done[0] === "" ? undefined : done;
  };

  for await (const chunk of chunks) {
    const out: string[][] = [];
    for (const char of chunk) {
      if (pendingCr) {
        pendingCr = false;
        if (char === "\n") continue;
      }
      if (quoted) {
        if (char === '"') {
          quoted = false;
          quoteSeen = true;
        } else field += char;
        continue;
      }
      if (char === '"') {
        if (quoteSeen) field += '"'; // `""` inside a quoted field
        quoted = true;
        quoteSeen = false;
        continue;
      }
      quoteSeen = false;
      if (char === ",") endField();
      else if (char === "\n" || char === "\r") {
        pendingCr = char === "\r";
        const done = endRecord();
        if (done !== undefined) out.push(done);
      } else field += char;
    }
    yield* out;
  }
  if (record.length > 0 || field !== "") {
    const done = endRecord();
    if (done !== undefined) yield done;
  }
}

/** Decodes a byte stream to text chunks (UTF-8; TextDecoder drops a leading BOM). */
export async function* decodeUtf8(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  for await (const bytes of body) {
    const text = decoder.decode(bytes, { stream: true });
    if (text !== "") yield text;
  }
  const rest = decoder.decode();
  if (rest !== "") yield rest;
}

/** Records as `header → value` objects (header names trimmed and upper-cased). */
export async function* csvRecords(chunks: AsyncIterable<string>): AsyncGenerator<Readonly<Record<string, string>>> {
  let header: string[] | undefined;
  for await (const cells of parseCsv(chunks)) {
    if (header === undefined) {
      header = cells.map((cell) => cell.trim().toUpperCase());
      continue;
    }
    const record: Record<string, string> = {};
    for (const [index, name] of header.entries()) record[name] = (cells[index] ?? "").trim();
    yield record;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Row mapping

export interface DhanMasterOptions {
  /** Unit of `TICK_SIZE` (default `paise`: Dhan's file says 5 for ₹0.05). */
  readonly tickSizeUnit?: "paise" | "rupee" | undefined;
  /** Exchange freeze quantity per F&O underlying (`{ NIFTY: 1800 }`); Dhan's master has no such column. */
  readonly freezeQuantities?: Readonly<Record<string, number>> | undefined;
}

/** A mapped row and where it lives at Dhan. */
export interface DhanMasterRow {
  readonly row: InstrumentRow;
  readonly ref: DhanInstrumentRef;
}

function pick(record: Readonly<Record<string, string>>, ...names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== "" && value !== "NA") return value;
  }
  return "";
}

const INSTRUMENT_KINDS: Readonly<Record<string, "INDEX" | "EQ" | "FUT" | "OPT">> = Object.freeze({
  INDEX: "INDEX",
  EQUITY: "EQ",
  FUTIDX: "FUT",
  FUTSTK: "FUT",
  FUTCOM: "FUT",
  FUTCUR: "FUT",
  OPTIDX: "OPT",
  OPTSTK: "OPT",
  OPTFUT: "OPT",
  OPTCUR: "OPT",
});

/** Exchange id + CSV segment letter → our token for F&O and equity rows. */
function tokenFor(exchange: string, segment: string, kind: "INDEX" | "EQ" | "FUT" | "OPT"): SegmentToken | undefined {
  if (kind === "INDEX") return exchange === "NSE" ? "NSE_INDEX" : exchange === "BSE" ? "BSE_INDEX" : undefined;
  if (kind === "EQ") {
    if (segment !== "E") return undefined;
    return exchange === "NSE" ? "NSE_EQ" : exchange === "BSE" ? "BSE_EQ" : undefined;
  }
  if (exchange === "NSE") return segment === "D" ? "NSE_FO" : segment === "C" ? "NSE_CD" : undefined;
  if (exchange === "BSE") return segment === "D" ? "BSE_FO" : undefined;
  if (exchange === "MCX") return segment === "M" ? "MCX_FO" : undefined;
  return undefined;
}

/** `YYYY-MM-DD[ HH:mm:ss]`, `DD-MM-YYYY` or `DD/MM/YYYY` → `YYYY-MM-DD`; anything else (or year 1) → undefined. */
export function dhanDate(text: string | null | undefined): string | undefined {
  if (text === undefined || text === null) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
  if (iso !== null) return iso[1] === "0001" ? undefined : `${iso[1] ?? ""}-${iso[2] ?? ""}-${iso[3] ?? ""}`;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(text.trim());
  if (dmy !== null) return `${dmy[3] ?? ""}-${dmy[2] ?? ""}-${dmy[1] ?? ""}`;
  return undefined;
}

/** The F&O underlying: `UNDERLYING_SYMBOL`, else the part of the trading symbol before the first `-`. */
function underlyingOf(record: Readonly<Record<string, string>>): string {
  const underlying = pick(record, "UNDERLYING_SYMBOL");
  if (underlying !== "") return underlying.toUpperCase();
  return (pick(record, "SEM_TRADING_SYMBOL", "SYMBOL_NAME").split("-")[0] ?? "").trim().toUpperCase();
}

function positive(text: string): number | undefined {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function tickSizeOf(text: string, unit: "paise" | "rupee"): string {
  const value = positive(text);
  if (value === undefined) return "0.05";
  const rupees = toDecimalString(unit === "paise" ? toDecimal(String(value)).div(100) : String(value));
  return toDecimal(rupees).gt(0) ? rupees : "0.05";
}

/**
 * One CSV record → a canonical row and its Dhan reference, or `undefined` for rows the platform doesn't trade (BSE
 * currency, unknown instruments, symbols outside the key grammar, malformed expiries or strikes).
 */
export function dhanMasterRow(
  record: Readonly<Record<string, string>>,
  options: DhanMasterOptions = {},
): DhanMasterRow | undefined {
  const exchange = pick(record, "EXCH_ID", "SEM_EXM_EXCH_ID").toUpperCase();
  const segmentLetter = pick(record, "SEGMENT", "SEM_SEGMENT").toUpperCase();
  const securityId = pick(record, "SECURITY_ID", "SEM_SMST_SECURITY_ID");
  const instrument = pick(record, "INSTRUMENT", "SEM_INSTRUMENT_NAME").toUpperCase() as DhanInstrument;
  const kind = INSTRUMENT_KINDS[instrument];
  if (kind === undefined || !/^\d{1,20}$/.test(securityId)) return undefined;
  const token = tokenFor(exchange, segmentLetter, kind);
  if (token === undefined) return undefined;

  const tradingSymbol = pick(record, "SEM_TRADING_SYMBOL", "SYMBOL_NAME", "UNDERLYING_SYMBOL").slice(0, 64);
  let key: InstrumentKey;
  let expiry: string | undefined;
  let strike: string | undefined;
  let optionType: OptionType | undefined;
  try {
    if (kind === "INDEX" || kind === "EQ") {
      const raw = (
        pick(record, "UNDERLYING_SYMBOL", "SEM_TRADING_SYMBOL", "SYMBOL_NAME") || tradingSymbol
      ).toUpperCase();
      const symbol = kind === "INDEX" ? (DHAN_INDEX_ALIASES[raw] ?? raw) : raw;
      key = formatInstrumentKey({ segment: kind, token, symbol });
    } else {
      expiry = dhanDate(pick(record, "SM_EXPIRY_DATE", "SEM_EXPIRY_DATE"));
      if (expiry === undefined) return undefined;
      if (kind === "FUT") {
        key = formatInstrumentKey({ segment: "FUT", token, symbol: underlyingOf(record), expiry });
      } else {
        const option = pick(record, "OPTION_TYPE", "SEM_OPTION_TYPE").toUpperCase();
        const strikeValue = positive(pick(record, "STRIKE_PRICE", "SEM_STRIKE_PRICE"));
        if ((option !== "CE" && option !== "PE") || strikeValue === undefined) return undefined;
        optionType = option;
        strike = canonicalStrike(toDecimalString(String(strikeValue)));
        key = formatInstrumentKey({ segment: "OPT", token, symbol: underlyingOf(record), expiry, strike, optionType });
      }
    }
  } catch {
    return undefined; // outside the key grammar
  }

  const parsed = parseInstrumentKey(key);
  /* v8 ignore next -- formatInstrumentKey has just produced this key */
  if (!parsed.ok) return undefined;
  const lot = positive(pick(record, "LOT_SIZE", "SEM_LOT_UNITS"));
  const isin = pick(record, "ISIN").toUpperCase();
  const name = pick(record, "DISPLAY_NAME", "SEM_CUSTOM_SYMBOL", "SYMBOL_NAME", "SM_SYMBOL_NAME") || tradingSymbol;
  const freeze = kind === "FUT" || kind === "OPT" ? options.freezeQuantities?.[parsed.value.symbol] : undefined;
  const exchangeSegment = dhanSegmentForToken(token);
  const row: InstrumentRow = {
    instrumentKey: key,
    brokerToken: dhanBrokerToken(exchangeSegment, securityId),
    exchange: parsed.value.exchange,
    segment: parsed.value.segment,
    tradingSymbol: tradingSymbol || parsed.value.symbol,
    name: name.slice(0, 200),
    ...(/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin) ? { isin } : {}),
    ...(expiry === undefined ? {} : { expiry }),
    ...(strike === undefined ? {} : { strike }),
    ...(optionType === undefined ? {} : { optionType }),
    lotSize: lot === undefined ? 1 : Math.max(1, Math.round(lot)),
    tickSize: tickSizeOf(pick(record, "TICK_SIZE", "SEM_TICK_SIZE"), options.tickSizeUnit ?? "paise"),
    ...(freeze !== undefined && Number.isSafeInteger(freeze) && freeze > 0 ? { freezeQty: freeze } : {}),
  };
  return { row, ref: { exchangeSegment, securityId, instrument } };
}
