/**
 * Exact money and price helpers (plan D14). Prices and amounts are decimal strings on the wire, `Decimal(18,4)` in
 * Postgres and decimal.js in logic. Never `number`: binary floats can't represent most prices (0.1 + 0.2 ≠ 0.3).
 *
 * - Wire input: {@link DecimalStringSchema}, {@link PriceSchema}, {@link MoneySchema}, {@link QuantitySchema}.
 * - Logic: {@link toDecimal}, decimal.js arithmetic, then {@link toDecimalString} or {@link roundToTick}.
 * - Display: {@link formatInr}, {@link formatInrCompact}. No `Intl`, so server and browser render identical text.
 */
import { Decimal } from "decimal.js";
import { z } from "zod";

import { describe } from "./internal/describe";
import { lookup } from "./internal/lookup";
import { quote } from "./internal/quote";

export type { Decimal };

// ---------------------------------------------------------------------------------------------------------------------
// Wire schemas

/** What Postgres Decimal(18,4) holds: up to 14 integer digits (no leading zeros) and up to 4 decimals. No exponent. */
const DECIMAL_STRING_PATTERN = /^-?(0|[1-9]\d{0,13})(\.\d{1,4})?$/;
const NON_NEGATIVE_DECIMAL_STRING_PATTERN = /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/;
const DECIMAL_STRING_RULES = "at most 14 integer digits and 4 decimals, no leading zeros, no exponent";

/** A decimal string that fits Decimal(18,4), e.g. `"24000.05"`, `"-0.5"`. Rejects `"01"`, `"1e5"`, `"1.00005"`. */
export const DecimalStringSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, `Expected a decimal string with ${DECIMAL_STRING_RULES}`);

/** A price, strike or tick size: a non-negative {@link DecimalStringSchema}. */
export const PriceSchema = z
  .string()
  .regex(NON_NEGATIVE_DECIMAL_STRING_PATTERN, `Expected a non-negative decimal string with ${DECIMAL_STRING_RULES}`);

/** A signed amount (P&L, funds, charges): a {@link DecimalStringSchema}. */
export const MoneySchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, `Expected an amount as a decimal string with ${DECIMAL_STRING_RULES}`);

/** An order quantity in units (not lots): a positive integer that fits the Postgres `Int` column. */
export const QuantitySchema = z.int().min(1).max(2_147_483_647);

// ---------------------------------------------------------------------------------------------------------------------
// Decimal conversion

/**
 * This package's own Decimal constructor (plan D14). Not exported, and never reconfigured:
 * - a clone, so a global `Decimal.set()` (ours or anyone's) can't change how money is computed here;
 * - `defaults: true`, so it doesn't inherit whatever the global constructor was configured with before this loaded;
 * - 40 significant digits: exact for every Decimal(18,4) value, with headroom for products and quotients;
 * - exponent thresholds at their limits, so even `toString()` and `toJSON()` never use exponential notation.
 */
const Dec = Decimal.clone({
  defaults: true,
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

const MAX_DECIMAL_PLACES = 4;

/** 10^14, the smallest magnitude with 15 integer digits: too large for Decimal(18,4). */
const INTEGER_DIGITS_LIMIT = new Dec("1e14");

/** Plain decimal notation: optional minus, no leading zeros, optional fraction. No exponent, `+`, whitespace or hex. */
const PLAIN_DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * An object with a decimal.js-style `toFixed()`: Prisma's `Decimal` (which bundles its own decimal.js), a Decimal from
 * another decimal.js copy, or anything whose no-argument `toFixed()` returns plain decimal notation. The `object`
 * constraint keeps `number` out, because numbers have a `toFixed()` too.
 */
export type DecimalObjectLike = object & { toFixed(): string };

/**
 * A value the money helpers accept: a plain decimal string (`"1234.5"`, `"-0.05"`), a Decimal, or a
 * {@link DecimalObjectLike}. Never `number`: it is a type error, and untyped callers get a TypeError at runtime.
 */
export type DecimalLike = string | Decimal | DecimalObjectLike;

/**
 * Converts a {@link DecimalLike} to a Decimal for exact arithmetic. Methods on the result (`plus`, `times`, `div`, …)
 * keep this package's configuration: 40 significant digits, half-up.
 *
 * - Strings must be plain decimal notation. Any number of decimals is fine here (only the wire schemas cap them at 4).
 *   Rejected: leading zeros, exponents, `+`, whitespace, `"NaN"`, `"Infinity"`.
 * - Decimal-like objects are read through `toFixed()`, which decimal.js renders exactly, so a Prisma Decimal (or one
 *   from any other decimal.js copy) converts without a float in between. Detection is structural: `instanceof` would
 *   fail across copies of decimal.js.
 *
 * @throws {TypeError} for numbers, malformed strings, other non-decimal values and non-finite Decimals.
 */
export function toDecimal(value: DecimalLike): Decimal {
  return decimalFromUnknown(value);
}

/** {@link toDecimal} for untyped input: typed callers can't pass a number, JavaScript callers can. */
function decimalFromUnknown(value: unknown): Decimal {
  if (typeof value === "string") return parsePlainDecimal(value);
  if (typeof value === "number" || isBoxedNumber(value)) {
    throw new TypeError(
      "Numbers are not accepted: pass a decimal string, because floats can't hold most prices exactly",
    );
  }
  if (isOwnDecimal(value)) {
    if (!value.isFinite()) throw new TypeError(`Not a finite decimal: ${value.toString()}`);
    return value;
  }
  if (hasToFixed(value)) {
    const text = value.toFixed();
    if (typeof text === "string") return parsePlainDecimal(text);
    throw new TypeError(`toFixed() returned ${describe(text)}, not a string`);
  }
  throw new TypeError(`Expected a decimal string or a Decimal, got ${describe(value)}`);
}

function parsePlainDecimal(text: string): Decimal {
  if (!PLAIN_DECIMAL_PATTERN.test(text)) throw new TypeError(`Not a plain decimal string: ${quote(text)}`);
  return new Dec(text);
}

/** A Decimal from this module's constructor. decimal.js sets `constructor` on every instance, so this isn't instanceof. */
function isOwnDecimal(value: unknown): value is Decimal {
  return typeof value === "object" && value !== null && (value as { constructor?: unknown }).constructor === Dec;
}

/** `new Number(1.5)`: its `toFixed()` would silently round to an integer. */
function isBoxedNumber(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.prototype.toString.call(value) === "[object Number]";
}

function hasToFixed(value: unknown): value is { toFixed(): unknown } {
  return typeof value === "object" && value !== null && typeof (value as { toFixed?: unknown }).toFixed === "function";
}

// ---------------------------------------------------------------------------------------------------------------------
// Rounding

/**
 * Rounding for {@link toDecimalString}. `"down"` and `"up"` are in value terms, as in {@link roundToTick}.
 * - `"half-up"` (default): to nearest, ties away from zero (0.00005 → 0.0001, -0.00005 → -0.0001).
 * - `"half-even"`: to nearest, ties to the even neighbour (banker's rounding).
 * - `"down"`: toward −∞ (floor). `"up"`: toward +∞ (ceil).
 */
export type DecimalRounding = "half-up" | "half-even" | "down" | "up";

/**
 * Rounding for {@link roundToTick}, in value terms, also for negative prices: `"down"` is floor and `"up"` is ceil.
 * `"nearest"` breaks ties away from zero.
 */
export type TickRounding = "nearest" | "down" | "up";

const DECIMAL_ROUNDING: Readonly<Record<DecimalRounding, Decimal.Rounding>> = Object.freeze({
  "half-up": Decimal.ROUND_HALF_UP,
  "half-even": Decimal.ROUND_HALF_EVEN,
  down: Decimal.ROUND_FLOOR,
  up: Decimal.ROUND_CEIL,
});

const TICK_ROUNDING: Readonly<Record<TickRounding, Decimal.Rounding>> = Object.freeze({
  nearest: Decimal.ROUND_HALF_UP,
  down: Decimal.ROUND_FLOOR,
  up: Decimal.ROUND_CEIL,
});

/**
 * Renders a value in canonical wire form: at most 4 decimals (rounded with `rounding`), trailing zeros trimmed, never
 * an exponent, never `"-0"`. The result always passes {@link DecimalStringSchema}, and a canonical string comes back
 * unchanged: `"24000.05"` → `"24000.05"`, `"1.50"` → `"1.5"`, `"-0.00001"` → `"0"`.
 *
 * @throws {RangeError} when the rounded value has more than 14 integer digits (it would not fit Decimal(18,4)).
 * @throws {TypeError} when the value is not a {@link DecimalLike}.
 */
export function toDecimalString(value: DecimalLike, rounding: DecimalRounding = "half-up"): string {
  const mode = lookup(DECIMAL_ROUNDING, rounding, "rounding");
  const rounded = toDecimal(value).toDecimalPlaces(MAX_DECIMAL_PLACES, mode);
  if (rounded.abs().gte(INTEGER_DIGITS_LIMIT)) {
    throw new RangeError(
      `${quote(rounded.toFixed())} has more than 14 integer digits, so it does not fit Decimal(18,4)`,
    );
  }
  // toFixed() without arguments: plain notation, no trailing zeros, and no sign on zero (rounded -0.00001 is "0").
  return rounded.toFixed();
}

/**
 * Rounds a price to a multiple of the tick size, rendered by {@link toDecimalString}. `mode` is required: the right
 * direction depends on the order, so there is no default. `"down"` never returns more than the price and `"up"` never
 * less, also for negative prices; `"nearest"` breaks ties away from zero.
 *
 * ```ts
 * roundToTick("24000.07", "0.05", "nearest"); // "24000.05"
 * roundToTick("-1.03", "0.05", "down"); // "-1.05"
 * ```
 *
 * @throws {RangeError} when the tick is not greater than 0 or has more than 4 decimals (its multiples might not fit
 *   the wire format), or the result has more than 14 integer digits.
 */
export function roundToTick(price: DecimalLike, tick: DecimalLike, mode: TickRounding): string {
  const rounding = lookup(TICK_ROUNDING, mode, "tick rounding mode");
  const size = toTickSize(tick);
  if (size.decimalPlaces() > MAX_DECIMAL_PLACES) {
    throw new RangeError(`Tick size ${quote(size.toFixed())} has more than 4 decimals`);
  }
  return toDecimalString(toDecimal(price).toNearest(size, rounding));
}

/**
 * Whether a price is an exact multiple of the tick size: `isOnTick("24000.05", "0.05")` is true.
 *
 * @throws {RangeError} when the tick is not greater than 0.
 */
export function isOnTick(price: DecimalLike, tick: DecimalLike): boolean {
  return toDecimal(price).mod(toTickSize(tick)).isZero();
}

function toTickSize(tick: DecimalLike): Decimal {
  const size = toDecimal(tick);
  if (!size.gt(0)) throw new RangeError(`Tick size must be greater than 0, got ${quote(size.toFixed())}`);
  return size;
}

// ---------------------------------------------------------------------------------------------------------------------
// INR formatting

/** Options for {@link formatInr}. */
export interface FormatInrOptions {
  /** Decimal places, always all shown (default 2). Rounded half-up. */
  readonly decimals?: 0 | 2 | 4 | undefined;
  /** `"auto"` (default): a minus sign on negative values. `"always"`: a plus sign on positive values too. */
  readonly sign?: "auto" | "always" | undefined;
  /** Prefix the rupee symbol (default true). */
  readonly symbol?: boolean | undefined;
}

/** Options for {@link formatInrCompact}. */
export interface FormatInrCompactOptions {
  /** The most decimal places shown (default 2). Rounded half-up; trailing zeros are trimmed. */
  readonly maxDecimals?: 0 | 1 | 2 | 3 | 4 | undefined;
}

const INR = "₹";
const INR_DECIMALS: readonly number[] = [0, 2, 4];
const COMPACT_MAX_DECIMALS: readonly number[] = [0, 1, 2, 3, 4];
const ALWAYS_SIGN: Readonly<Record<"auto" | "always", boolean>> = Object.freeze({ auto: false, always: true });

/** A compact unit, linked to the next larger one for rounding carry-over. */
interface CompactUnit {
  readonly scale: Decimal;
  readonly suffix: string;
  readonly next: CompactUnit | undefined;
}

/** Indian compact units: K = thousand, L = lakh (1,00,000), Cr = crore (1,00,00,000). */
const CRORE: CompactUnit = { scale: new Dec("1e7"), suffix: " Cr", next: undefined };
const LAKH: CompactUnit = { scale: new Dec("1e5"), suffix: " L", next: CRORE };
const THOUSAND: CompactUnit = { scale: new Dec("1e3"), suffix: " K", next: LAKH };
const RUPEES: CompactUnit = { scale: new Dec("1"), suffix: "", next: THOUSAND };
const COMPACT_UNITS_LARGEST_FIRST: readonly CompactUnit[] = [CRORE, LAKH, THOUSAND];

/**
 * Formats rupees with Indian digit grouping (lakh, crore): `"₹1,00,000.00"`, `"-₹1,23,45,678.90"`, `"₹0.00"`.
 *
 * Deterministic and `Intl`-free, so the server render and the browser hydration produce the same text. The sign is
 * decided after rounding: a value that rounds to zero prints unsigned (never `"-₹0.00"`), and `sign: "always"` adds
 * `+` to positive values only.
 *
 * @throws {RangeError} for an unknown `decimals` or `sign` option.
 */
export function formatInr(value: DecimalLike, options: FormatInrOptions = {}): string {
  const { decimals = 2, sign = "auto", symbol = true } = options;
  if (!INR_DECIMALS.includes(decimals)) throw new RangeError(`decimals must be 0, 2 or 4, got ${String(decimals)}`);
  const alwaysSign = lookup(ALWAYS_SIGN, sign, "sign");

  const rounded = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const [integer = "0", fraction] = rounded.abs().toFixed(decimals).split(".");
  const signText = rounded.isZero() ? "" : rounded.isNegative() ? "-" : alwaysSign ? "+" : "";
  return `${signText}${symbol ? INR : ""}${groupIndian(integer)}${fraction === undefined ? "" : `.${fraction}`}`;
}

/**
 * Formats rupees compactly with Indian units: `"₹1.23 Cr"` from 1 crore (1e7), `"₹45.6 L"` from 1 lakh (1e5),
 * `"₹12.3 K"` from 1,000, and plain `"₹999"` below. At most `maxDecimals` decimals (default 2), rounded half-up, with
 * trailing zeros trimmed (`"₹1 Cr"`). Deterministic and `Intl`-free, like {@link formatInr}.
 *
 * At a threshold, the unit is chosen by magnitude and the number is then rounded. When rounding carries it up to the
 * next unit, the next unit is used, as Intl's compact notation does: 99,999.999 is `"₹1 L"` (never `"₹100 K"`) and
 * 999.999 is `"₹1 K"`, while 99,994.99 stays `"₹99.99 K"`. A value that rounds to zero prints unsigned.
 *
 * @throws {RangeError} for a `maxDecimals` outside 0–4.
 */
export function formatInrCompact(value: DecimalLike, options: FormatInrCompactOptions = {}): string {
  const { maxDecimals = 2 } = options;
  if (!COMPACT_MAX_DECIMALS.includes(maxDecimals)) {
    throw new RangeError(`maxDecimals must be an integer from 0 to 4, got ${String(maxDecimals)}`);
  }

  const decimal = toDecimal(value);
  const magnitude = decimal.abs();
  let unit = COMPACT_UNITS_LARGEST_FIRST.find((candidate) => magnitude.gte(candidate.scale)) ?? RUPEES;
  let scaled = magnitude.div(unit.scale).toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_UP);
  // Rounding can carry into the next unit: 99,999.999 rounds to 100.00 K, which is shown as 1 L.
  while (unit.next !== undefined && scaled.times(unit.scale).gte(unit.next.scale)) {
    unit = unit.next;
    scaled = magnitude.div(unit.scale).toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_UP);
  }

  const [integer = "0", fraction] = scaled.toFixed().split(".");
  const signText = decimal.isNegative() && !scaled.isZero() ? "-" : "";
  return `${signText}${INR}${groupIndian(integer)}${fraction === undefined ? "" : `.${fraction}`}${unit.suffix}`;
}

/** Indian digit grouping: the last three digits, then pairs. `"12345678"` → `"1,23,45,678"`. Digits only, no sign. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  let grouped = digits.slice(-3);
  let rest = digits.slice(0, -3);
  while (rest.length > 2) {
    grouped = `${rest.slice(-2)},${grouped}`;
    rest = rest.slice(0, -2);
  }
  return `${rest},${grouped}`;
}
