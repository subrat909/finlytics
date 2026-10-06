/**
 * The paper market's deterministic price model (phase 1 plan P2): the same seed gives the same prices, run after run,
 * so screenshots, tests and demos are stable without a broker.
 *
 * - {@link basePrice}: a plausible previous close per instrument (known indices, then a hash of the key).
 * - {@link PriceWalk}: a seeded random walk on the 0.05 tick for live ticks.
 * - {@link anchorPrice}: a smooth, deterministic price curve over time for historical candles.
 *
 * Floats are used inside the model only; every price leaves it as a decimal string on the tick.
 */
import { parseInstrumentKey, roundToTick, toDecimal, toDecimalString } from "@finlytics/shared";
import type { ParsedInstrumentKey } from "@finlytics/shared";

/** Every paper price is a multiple of this. */
export const PAPER_TICK_SIZE = "0.05";

const KNOWN_INDEX_LEVELS: Readonly<Record<string, number>> = Object.freeze({
  "NIFTY 50": 24_000,
  NIFTY: 24_000,
  "NIFTY BANK": 52_000,
  BANKNIFTY: 52_000,
  "NIFTY FIN SERVICE": 23_000,
  FINNIFTY: 23_000,
  "NIFTY MID SELECT": 12_500,
  MIDCPNIFTY: 12_500,
  SENSEX: 80_000,
  BANKEX: 58_000,
  "INDIA VIX": 13,
});

/** FNV-1a, 32 bits: a stable hash for seeding. */
export function hashString(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
}

/** mulberry32: a small, fast PRNG with a 32-bit seed. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A float rendered as a price on the paper tick, never below one tick. */
export function toPaperPrice(value: number): string {
  const price = roundToTick(Math.max(value, 0.05).toFixed(4), PAPER_TICK_SIZE, "nearest");
  return toDecimal(price).lt(PAPER_TICK_SIZE) ? PAPER_TICK_SIZE : price;
}

/** The level of an underlying (index or stock) by symbol. */
function underlyingLevel(symbol: string, index: boolean): number {
  const known = KNOWN_INDEX_LEVELS[symbol];
  if (known !== undefined) return known;
  const hash = hashString(symbol);
  return index ? 5_000 + (hash % 45_000) : 100 + (hash % 290_000) / 100;
}

function levelOf(parsed: ParsedInstrumentKey): number {
  switch (parsed.segment) {
    case "INDEX":
      return underlyingLevel(parsed.symbol, true);
    case "EQ":
      return underlyingLevel(parsed.symbol, false);
    case "FUT":
      return underlyingLevel(parsed.symbol, parsed.symbol in KNOWN_INDEX_LEVELS) * 1.003;
    case "OPT": {
      const spot = underlyingLevel(parsed.symbol, parsed.symbol in KNOWN_INDEX_LEVELS);
      const strike = Number(parsed.strike);
      const intrinsic = parsed.optionType === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
      const timeValue = spot * 0.008 * Math.exp(-Math.abs(spot - strike) / (spot * 0.03));
      return intrinsic + timeValue + 0.5;
    }
  }
}

/**
 * A plausible previous close for `key`, as a float (callers render it with {@link toPaperPrice}).
 *
 * @throws {TypeError} for a key that isn't canonical (the gateway only passes valid keys).
 */
export function basePrice(key: string): number {
  const parsed = parseInstrumentKey(key);
  if (!parsed.ok) throw new TypeError("Not an instrument key");
  return levelOf(parsed.value);
}

/** The exchange of a valid key. */
export function exchangeOf(key: string): ParsedInstrumentKey["exchange"] {
  const parsed = parseInstrumentKey(key);
  if (!parsed.ok) throw new TypeError("Not an instrument key");
  return parsed.value.exchange;
}

/** One instrument's live state: a random walk around its previous close. */
export class PriceWalk {
  readonly close: string;
  ltp: string;
  open: string;
  high: string;
  low: string;
  volume = 0;
  readonly #random: () => number;
  readonly #stepFraction: number;

  /**
   * @param seed the run's seed (MARKET_FEED_PAPER_SEED); combined with the key, so each instrument has its own walk
   * @param stepFraction the largest move per step, as a fraction of the price (default 0.05 %)
   */
  constructor(key: string, seed: number, stepFraction = 0.0005) {
    this.#random = mulberry32(hashString(`${String(seed)}:${key}`));
    this.close = toPaperPrice(basePrice(key));
    // Open a little away from the close, so change % isn't zero on the first tick.
    this.ltp = toPaperPrice(Number(this.close) * (1 + (this.#random() - 0.5) * 0.01));
    this.open = this.ltp;
    this.high = this.ltp;
    this.low = this.ltp;
    this.#stepFraction = stepFraction;
  }

  /** Moves the price by a whole number of ticks (possibly zero) and adds volume. Returns the new LTP. */
  step(): string {
    const price = Number(this.ltp);
    const ticks = Math.round(((this.#random() - 0.5) * 2 * price * this.#stepFraction) / 0.05);
    const next = toDecimal(this.ltp).plus(toDecimal(PAPER_TICK_SIZE).times(ticks));
    this.ltp = next.lt(PAPER_TICK_SIZE) ? PAPER_TICK_SIZE : toDecimalString(next);
    if (toDecimal(this.ltp).gt(this.high)) this.high = this.ltp;
    if (toDecimal(this.ltp).lt(this.low)) this.low = this.ltp;
    this.volume += 1 + Math.floor(this.#random() * 500);
    return this.ltp;
  }
}

const DAY_MS = 86_400_000;

/**
 * A smooth, deterministic price for `key` at time `ms` (float): slow and daily waves around the base price, with a
 * phase per instrument. Historical paper candles sample it, so adjacent bars connect.
 */
export function anchorPrice(key: string, seed: number, ms: number): number {
  const base = basePrice(key);
  const phase = (hashString(`${String(seed)}:${key}:phase`) % 10_000) / 10_000;
  const slow = Math.sin((2 * Math.PI * ms) / (20 * DAY_MS) + phase * 2 * Math.PI);
  const daily = Math.sin((2 * Math.PI * ms) / DAY_MS + phase * 7);
  const fast = Math.sin((2 * Math.PI * ms) / 3_600_000 + phase * 13);
  return base * (1 + 0.04 * slow + 0.008 * daily + 0.002 * fast);
}
