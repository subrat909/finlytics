/**
 * Canonical instrument keys (plan D13, §5). One key names one instrument everywhere: it is the `Instrument` primary
 * key, the realtime room and Redis quote key, and the `instrumentKey` column inside compressed hypertables. **The
 * grammar is permanent**: changing it would mean rewriting primary keys and compressed history.
 *
 * ```
 * key    = token "|" symbol                               ; *_EQ, *_INDEX tokens
 *        | token "|" symbol "|" expiry                    ; FUT (NSE_FO, NSE_CD, BSE_FO, MCX_FO)
 *        | token "|" symbol "|" expiry "|" strike "|" opt ; OPT
 * symbol = 1–64 of [A-Z0-9 &\-._()/], starts [A-Z0-9], no trailing/double spaces, never "|"
 * expiry = YYYY-MM-DD, real calendar date, 2000–2099
 * strike = /^(0|[1-9]\d{0,13})(\.\d{0,3}[1-9])?$/ and > 0   ; "24000", "82.5", never "24000.00"
 * opt    = CE | PE ; whole key ≤ 128 chars, checked before any pattern
 * ```
 *
 * - {@link parseInstrumentKey} is strict: canonical keys only.
 * - {@link normalizeInstrumentKey} is lenient: it repairs case, surrounding whitespace and strike formatting, then
 *   applies the same grammar.
 * - Both check the length first, then split on `|`. Each regex runs on one part of at most 128 characters and can't
 *   backtrack catastrophically, so parsing is linear in the input.
 * - Bad input is returned as a {@link Result} with a typed reason; only programmer errors (a non-string argument,
 *   invalid parts given to {@link formatInstrumentKey}) throw.
 */
import { z } from "zod";

import { SEGMENT_TOKEN_INFO, SEGMENT_TOKENS } from "./constants/exchanges";
import type { SegmentToken, SegmentTokenInfo } from "./constants/exchanges";
import { describe } from "./internal/describe";
import { quote } from "./internal/quote";
import { toDecimal, toDecimalString } from "./money";
import type { Decimal, DecimalLike } from "./money";
import { OPTION_TYPES } from "./schemas/enums";
import type { Exchange, OptionType, Segment } from "./schemas/enums";
import { err, ok } from "./types/result";
import type { Result } from "./types/result";

// ---------------------------------------------------------------------------------------------------------------------
// Types

/** A string that has passed the strict grammar. Get one from a parser or {@link formatInstrumentKey}, never a cast. */
export type InstrumentKey = string & z.$brand<"InstrumentKey">;

/** A `YYYY-MM-DD` calendar date from 2000 to 2099, read in UTC. */
export type IsoDate = string & z.$brand<"IsoDate">;

/**
 * Why a key was rejected. Each part has its own reason; the parts are checked in key order (token, then the number of
 * parts, then symbol, expiry, strike and option type) and the first failure is reported. `LENGTH` is checked before
 * anything else. `ENCODING` comes only from {@link instrumentKeyFromParam}: the parameter is not valid
 * percent-encoding.
 */
export type InstrumentKeyErrorReason =
  "LENGTH" | "ARITY" | "TOKEN" | "SYMBOL" | "EXPIRY" | "STRIKE" | "OPTION_TYPE" | "ENCODING";

/** A rejected key: a stable `reason` to branch on and a human-readable `message` (caller input truncated to 40). */
export interface InstrumentKeyError {
  readonly reason: InstrumentKeyErrorReason;
  readonly message: string;
}

/**
 * The parts {@link formatInstrumentKey} joins into a key, discriminated by the Prisma segment. `strike` must already
 * be canonical (see {@link canonicalStrike}). A {@link ParsedInstrumentKey} is also valid input.
 */
export type InstrumentKeyParts =
  | {
      readonly segment: "EQ" | "INDEX";
      readonly token: SegmentToken;
      readonly symbol: string;
    }
  | {
      readonly segment: "FUT";
      readonly token: SegmentToken;
      readonly symbol: string;
      readonly expiry: string;
    }
  | {
      readonly segment: "OPT";
      readonly token: SegmentToken;
      readonly symbol: string;
      readonly expiry: string;
      readonly strike: string;
      readonly optionType: OptionType;
    };

/**
 * A key split into its parts, with the Prisma `exchange` and `segment` it maps to. `key` is the canonical key itself.
 * For FUT and OPT keys, `symbol` is the underlying.
 */
export type ParsedInstrumentKey =
  | {
      readonly key: InstrumentKey;
      readonly token: SegmentToken;
      readonly exchange: Exchange;
      readonly segment: "EQ" | "INDEX";
      readonly symbol: string;
    }
  | {
      readonly key: InstrumentKey;
      readonly token: SegmentToken;
      readonly exchange: Exchange;
      readonly segment: "FUT";
      readonly symbol: string;
      readonly expiry: IsoDate;
    }
  | {
      readonly key: InstrumentKey;
      readonly token: SegmentToken;
      readonly exchange: Exchange;
      readonly segment: "OPT";
      readonly symbol: string;
      readonly expiry: IsoDate;
      readonly strike: string;
      readonly optionType: OptionType;
    };

// ---------------------------------------------------------------------------------------------------------------------
// Grammar

/** The longest accepted key, checked before any pattern runs. The longest valid key is 105 characters. */
export const MAX_INSTRUMENT_KEY_LENGTH = 128;

const MAX_SYMBOL_LENGTH = 64;

/** A key character percent-encodes to at most 3 characters (`|` → `%7C`), so a longer parameter can't hold a key. */
const MAX_PARAM_LENGTH = 3 * MAX_INSTRUMENT_KEY_LENGTH;

const MIN_EXPIRY_YEAR = 2000;
const MAX_EXPIRY_YEAR = 2099;
const MS_PER_DAY = 86_400_000;

/**
 * Words of `[A-Z0-9&._()/-]` separated by single spaces, starting with a letter or digit. Linear time: a space ends
 * one word and starts the next, so the repetitions can never overlap.
 */
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9&._()/-]*(?: [A-Z0-9&._()/-]+)*$/;
const SYMBOL_RULES =
  "expected 1–64 characters from A–Z, 0–9, space and & - . _ ( ) /, starting with a letter or digit, with single " +
  "spaces between words";
const LOWERCASE_ASCII = /[a-z]+/g;

const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** What toDecimalString renders for a positive Decimal(18,4): no leading or trailing zeros, at most 4 decimals. */
const CANONICAL_STRIKE_PATTERN = /^(0|[1-9]\d{0,13})(\.\d{0,3}[1-9])?$/;
const CANONICAL_STRIKE_RULES =
  "expected a decimal greater than 0 with no leading or trailing zeros, at most 14 integer digits and 4 decimals, " +
  'e.g. "24000" or "82.5"';

/** Plain unsigned decimal notation, trailing zeros allowed: what normalizeInstrumentKey accepts as a strike. */
const PLAIN_STRIKE_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

/** 10^14: the smallest strike with 15 integer digits. */
const STRIKE_LIMIT = toDecimal("100000000000000");
const MAX_STRIKE_DECIMALS = 4;

/** How many `|`-separated parts each instrument kind has. */
const PART_COUNT = Object.freeze({ EQ: 2, INDEX: 2, FUT: 3, OPT: 5 } as const satisfies Record<Segment, number>);

const PART_NAMES = Object.freeze({
  EQ: "token|symbol",
  INDEX: "token|symbol",
  FUT: "a future: token|symbol|expiry",
  OPT: "an option: token|symbol|expiry|strike|CE or PE",
} as const satisfies Record<Segment, string>);

/** How the strike is read: canonical only (parse), or canonicalised from plain decimal notation (normalize). */
type StrikeMode = "canonical" | "lenient";

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

/**
 * Parses a canonical key into its parts, with the Prisma exchange and segment. Strict: lowercase, surrounding
 * whitespace and non-canonical strikes (`"24000.00"`) are rejected; use {@link normalizeInstrumentKey} for input that
 * may need repair.
 *
 * ```ts
 * const parsed = parseInstrumentKey("NSE_FO|NIFTY|2025-10-30|24000|CE");
 * if (parsed.ok && parsed.value.segment === "OPT") use(parsed.value.exchange, parsed.value.strike); // "NFO", "24000"
 * ```
 *
 * @throws {TypeError} when `text` is not a string.
 */
export function parseInstrumentKey(text: string): Result<ParsedInstrumentKey, InstrumentKeyError> {
  const key = requireString(text, "an instrument key");
  if (key.length > MAX_INSTRUMENT_KEY_LENGTH) return err(lengthError(key.length));
  return parseParts(key.split("|"), "canonical");
}

/**
 * Repairs a key typed by a person or sent by a broker, then applies the strict grammar:
 * - trims the key, and the whitespace around each part (`" nse_eq | infy "`);
 * - uppercases ASCII letters only, so a look-alike such as `ı` (dotless i) is rejected instead of becoming `I`;
 * - canonicalises the strike from plain decimal notation (`"24000.00"` → `"24000"`). A strike with more than 4
 *   significant decimals is rejected, never rounded.
 *
 * Nothing else is repaired: whitespace inside a part is kept (a symbol with a double space is still rejected) and the
 * expiry must already be `YYYY-MM-DD`. The trimmed key may have at most 128 characters. Idempotent: a normalised key
 * normalises to itself and passes {@link parseInstrumentKey}.
 *
 * @throws {TypeError} when `text` is not a string.
 */
export function normalizeInstrumentKey(text: string): Result<InstrumentKey, InstrumentKeyError> {
  const trimmed = requireString(text, "an instrument key").trim();
  if (trimmed.length > MAX_INSTRUMENT_KEY_LENGTH) return err(lengthError(trimmed.length));
  const parsed = parseParts(trimmed.split("|").map(normalizePart), "lenient");
  return parsed.ok ? ok(parsed.value.key) : parsed;
}

/** Whether a value is a canonical key: a string that {@link parseInstrumentKey} accepts. */
export function isInstrumentKey(value: unknown): value is InstrumentKey {
  return typeof value === "string" && parseInstrumentKey(value).ok;
}

/**
 * A canonical key, as a branded Zod schema (strict, like {@link parseInstrumentKey}). An invalid key fails with a
 * `custom` issue whose message explains the problem and whose `params.reason` is the {@link InstrumentKeyErrorReason}.
 */
export const InstrumentKeySchema = z
  .string()
  .superRefine((value, ctx) => {
    const parsed = parseInstrumentKey(value);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: parsed.error.message,
        input: value,
        params: { reason: parsed.error.reason },
      });
    }
  })
  .brand<"InstrumentKey">();

function parseParts(parts: readonly string[], strikeMode: StrikeMode): Result<ParsedInstrumentKey, InstrumentKeyError> {
  const [token = "", symbol = "", expiryText = "", strikeText = "", optionTypeText = ""] = parts;
  if (!isSegmentToken(token)) {
    return err({
      reason: "TOKEN",
      message: `Unknown segment token ${quote(token)}; expected one of ${SEGMENT_TOKENS.join(", ")}`,
    });
  }
  const info: SegmentTokenInfo = SEGMENT_TOKEN_INFO[token];
  const segment = info.kinds.find((kind) => PART_COUNT[kind] === parts.length);
  if (segment === undefined) return err(arityError(token, info, parts.length));

  const symbolResult = checkSymbol(symbol);
  if (!symbolResult.ok) return symbolResult;
  const { exchange } = info;
  if (segment === "EQ" || segment === "INDEX") {
    return ok({ key: joinKey(token, symbol), token, exchange, segment, symbol });
  }

  const expiryResult = readExpiry(expiryText);
  if (!expiryResult.ok) return expiryResult;
  const expiry = expiryText as IsoDate;
  if (segment === "FUT") return ok({ key: joinKey(token, symbol, expiry), token, exchange, segment, symbol, expiry });

  const strikeResult = readStrike(strikeText, strikeMode);
  if (!strikeResult.ok) return strikeResult;
  const strike = strikeResult.value;
  if (!isOptionType(optionTypeText)) {
    return err({ reason: "OPTION_TYPE", message: `Option type ${quote(optionTypeText)} must be CE or PE` });
  }
  const optionType = optionTypeText;
  return ok({
    key: joinKey(token, symbol, expiry, strike, optionType),
    token,
    exchange,
    segment,
    symbol,
    expiry,
    strike,
    optionType,
  });
}

function normalizePart(part: string): string {
  return upperAscii(part.trim());
}

/** Uppercases a–z only: `toUpperCase` would also turn look-alikes such as `ı` (dotless i) into ASCII letters. */
function upperAscii(text: string): string {
  return text.replace(LOWERCASE_ASCII, (letters) => letters.toUpperCase());
}

/** Own keys only, so `"toString"` or `"__proto__"` is not a token. */
function isSegmentToken(text: string): text is SegmentToken {
  return Object.hasOwn(SEGMENT_TOKEN_INFO, text);
}

function isOptionType(text: string): text is OptionType {
  const optionTypes: readonly string[] = OPTION_TYPES;
  return optionTypes.includes(text);
}

function joinKey(...parts: readonly string[]): InstrumentKey {
  return parts.join("|") as InstrumentKey;
}

function lengthError(length: number): InstrumentKeyError {
  return {
    reason: "LENGTH",
    message: `Instrument key is ${String(length)} characters long; the maximum is ${String(MAX_INSTRUMENT_KEY_LENGTH)}`,
  };
}

function arityError(token: SegmentToken, info: SegmentTokenInfo, count: number): InstrumentKeyError {
  const expected = info.kinds.map((kind) => `${String(PART_COUNT[kind])} parts (${PART_NAMES[kind]})`).join(" or ");
  return { reason: "ARITY", message: `${token} keys have ${expected}, got ${String(count)}` };
}

function checkSymbol(symbol: string): Result<string, InstrumentKeyError> {
  if (isSymbol(symbol)) return ok(symbol);
  const fixedByCase = isSymbol(upperAscii(symbol));
  const rules = fixedByCase ? "symbols are uppercase (display case lives in Instrument.name)" : SYMBOL_RULES;
  return err({ reason: "SYMBOL", message: `Invalid symbol ${quote(symbol)}: ${rules}` });
}

function isSymbol(text: string): boolean {
  return text.length <= MAX_SYMBOL_LENGTH && SYMBOL_PATTERN.test(text);
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function readExpiry(text: string): Result<CalendarDate, InstrumentKeyError> {
  if (!EXPIRY_PATTERN.test(text)) return err(expiryError(`Expiry ${quote(text)} is not a YYYY-MM-DD date`));
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (year < MIN_EXPIRY_YEAR || year > MAX_EXPIRY_YEAR) {
    return err(expiryError(`Expiry ${quote(text)} is outside the years 2000–2099`));
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return err(expiryError(`Expiry ${quote(text)} is not a calendar date`));
  }
  return ok({ year, month, day });
}

function expiryError(message: string): InstrumentKeyError {
  return { reason: "EXPIRY", message };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function readStrike(text: string, mode: StrikeMode): Result<string, InstrumentKeyError> {
  if (mode === "lenient") {
    if (!PLAIN_STRIKE_PATTERN.test(text)) {
      return err(strikeError(`Strike ${quote(text)} is not a plain decimal number`));
    }
    return strikeFromDecimal(toDecimal(text), text);
  }
  if (text === "0") return err(strikeError(`Strike must be greater than 0, got "0"`));
  if (!CANONICAL_STRIKE_PATTERN.test(text)) {
    return err(strikeError(`Strike ${quote(text)} is not canonical: ${CANONICAL_STRIKE_RULES}`));
  }
  return ok(text);
}

/** Validates a strike's value and renders it canonically. `shown` is the caller's text, for the message. */
function strikeFromDecimal(value: Decimal, shown: string): Result<string, InstrumentKeyError> {
  if (!value.gt(0)) return err(strikeError(`Strike must be greater than 0, got ${quote(shown)}`));
  if (value.decimalPlaces() > MAX_STRIKE_DECIMALS) {
    return err(strikeError(`Strike ${quote(shown)} has more than 4 decimals; strikes are never rounded`));
  }
  if (value.gte(STRIKE_LIMIT)) return err(strikeError(`Strike ${quote(shown)} has more than 14 integer digits`));
  return ok(toDecimalString(value));
}

function strikeError(message: string): InstrumentKeyError {
  return { reason: "STRIKE", message };
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new TypeError(`Expected ${what} as a string, got ${describe(value)}`);
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Building

/**
 * Joins parts into a canonical key. For parts known to be valid, e.g. from {@link parseInstrumentKey} or from the
 * instrument master; data that may be invalid goes through {@link normalizeInstrumentKey}, which returns a Result.
 * `parseInstrumentKey(formatInstrumentKey(parts))` gives the parts back.
 *
 * ```ts
 * formatInstrumentKey({
 *   segment: "OPT",
 *   token: "NSE_FO",
 *   symbol: "NIFTY",
 *   expiry: "2025-10-30",
 *   strike: canonicalStrike(row.strike), // a Prisma Decimal: "24000"
 *   optionType: "CE",
 * }); // "NSE_FO|NIFTY|2025-10-30|24000|CE"
 * ```
 *
 * @throws {RangeError} when the parts don't form a canonical key (the {@link InstrumentKeyError} is the `cause`), or
 *   the token doesn't carry the segment (`{ segment: "EQ", token: "NSE_INDEX" }`).
 */
export function formatInstrumentKey(parts: InstrumentKeyParts): InstrumentKey {
  const parsed = parseInstrumentKey(partList(parts).join("|"));
  if (!parsed.ok)
    throw new RangeError(`Invalid instrument key parts: ${parsed.error.message}`, { cause: parsed.error });
  if (parsed.value.segment !== parts.segment) {
    throw new RangeError(`${parsed.value.key} has segment ${parsed.value.segment}, not ${parts.segment}`);
  }
  return parsed.value.key;
}

/** The parts in key order. An unknown segment (untyped caller) yields two parts and fails the segment check. */
function partList(parts: InstrumentKeyParts): readonly string[] {
  if (parts.segment === "OPT") return [parts.token, parts.symbol, parts.expiry, parts.strike, parts.optionType];
  if (parts.segment === "FUT") return [parts.token, parts.symbol, parts.expiry];
  return [parts.token, parts.symbol];
}

/**
 * Renders a strike canonically for a key: `"24000.00"` → `"24000"`, `"82.50"` → `"82.5"`. Accepts what
 * {@link toDecimal} accepts, so a Prisma `Decimal` strike column goes straight in.
 *
 * @throws {TypeError} when the value is not a {@link DecimalLike}.
 * @throws {RangeError} when the strike is not greater than 0, has more than 4 significant decimals (never rounded) or
 *   more than 14 integer digits.
 */
export function canonicalStrike(value: DecimalLike): string {
  const decimal = toDecimal(value);
  const result = strikeFromDecimal(decimal, typeof value === "string" ? value : decimal.toFixed());
  if (!result.ok) throw new RangeError(result.error.message, { cause: result.error });
  return result.value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Expiry dates (UTC only)

/**
 * The expiry as a Date at UTC midnight, the form Prisma reads and writes for `@db.Date` columns:
 * `expiryToDate("2025-10-30")` is `2025-10-30T00:00:00.000Z`.
 *
 * @throws {TypeError} when `expiry` is not a string.
 * @throws {RangeError} when it is not a `YYYY-MM-DD` calendar date from 2000 to 2099 (only possible through a cast).
 */
export function expiryToDate(expiry: IsoDate): Date {
  const date = readExpiry(requireString(expiry, "an expiry"));
  if (!date.ok) throw new RangeError(date.error.message, { cause: date.error });
  return new Date(Date.UTC(date.value.year, date.value.month - 1, date.value.day));
}

/**
 * The expiry of a Date at UTC midnight, e.g. an `Instrument.expiry` value read by Prisma: `2025-10-30T00:00:00.000Z` →
 * `"2025-10-30"`.
 *
 * A Date with a time of day is rejected rather than truncated. In India that is usually a local-midnight Date: IST
 * midnight on 30 October is 18:30 UTC on the 29th, which would silently become the wrong expiry. Build such dates
 * with `Date.UTC`.
 *
 * @throws {TypeError} when `date` is not a Date.
 * @throws {RangeError} for an invalid Date, a time other than UTC midnight, or a year outside 2000–2099.
 */
export function dateToExpiry(date: Date): IsoDate {
  if (Object.prototype.toString.call(date) !== "[object Date]") {
    throw new TypeError(`Expected a Date, got ${describe(date)}`);
  }
  const time = date.getTime();
  if (Number.isNaN(time)) throw new RangeError("Expected a valid Date, got an Invalid Date");
  const year = date.getUTCFullYear();
  if (year < MIN_EXPIRY_YEAR || year > MAX_EXPIRY_YEAR) {
    throw new RangeError(`Expiry year must be from 2000 to 2099, got ${String(year)}`);
  }
  if (time % MS_PER_DAY !== 0) {
    throw new RangeError(`Expected a Date at UTC midnight, got ${date.toISOString()}; build it with Date.UTC`);
  }
  return `${String(year)}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}` as IsoDate;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// ---------------------------------------------------------------------------------------------------------------------
// URL parameters

/**
 * Encodes a key as one URL path segment: `"NSE_INDEX|NIFTY 50"` → `"NSE_INDEX%7CNIFTY%2050"`. Every `|`, space, `&`
 * and `/` is percent-encoded, so the key can't split the path or the query.
 */
export function instrumentKeyToParam(key: InstrumentKey): string {
  return encodeURIComponent(key);
}

/**
 * Decodes and strictly parses a URL parameter made by {@link instrumentKeyToParam}. Never throws for a string:
 * malformed percent-encoding (`"%E0%A4%A"`) is an `ENCODING` error, and a parameter longer than 384 characters (3 per
 * key character) is a `LENGTH` error before anything is decoded.
 *
 * Safe on a parameter the framework has already decoded: `%` is not in the key grammar, so decoding a valid key again
 * leaves it unchanged.
 *
 * @throws {TypeError} when `param` is not a string.
 */
export function instrumentKeyFromParam(param: string): Result<ParsedInstrumentKey, InstrumentKeyError> {
  const text = requireString(param, "a URL parameter");
  if (text.length > MAX_PARAM_LENGTH) {
    return err({
      reason: "LENGTH",
      message:
        `URL parameter is ${String(text.length)} characters long; ` +
        `an encoded instrument key has at most ${String(MAX_PARAM_LENGTH)}`,
    });
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    return err({ reason: "ENCODING", message: `URL parameter ${quote(text)} is not valid percent-encoding` });
  }
  return parseInstrumentKey(decoded);
}
