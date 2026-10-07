/**
 * What the feed publishes per tick (phase 1 plan "Redis keys"; phase-1b "Quotes, depth and realtime"): a
 * {@link QuoteUpdate}, written three ways by the feed leader and read by the gateway, plus the book as an `RtDepth`.
 *
 * - `quote:<key>` hash: {@link quoteHashFields} (`ltp, close, chg, chgPct, vol, oi, bid, ask, open, high, low, atp,
 *   bidQty, askQty, ltq, ts`; decimal strings, `ts` epoch ms) and `src`, the broker that wrote it (`PAPER` for the
 *   simulator, so going live can delete simulated quotes). Fields the tick doesn't carry (volume in `ltp` mode, a day
 *   price or OI the broker omits as zero) are left as they were.
 * - `q:<key>` channel: {@link encodeQuoteUpdate}, JSON; the gateway reads it back with {@link decodeQuoteUpdate}.
 * - `ticks:<broker>` stream: the same JSON under field `u`, with the key under `k`.
 * - `depth:<key>` (JSON, 1 day) and `d:<key>` channel: {@link toDepth} when the tick carries a book.
 *
 * `chg` = ltp − previous close and `chgPct` = chg / close × 100 (2 decimals), exact decimals; both `"0"` when the close
 * isn't known.
 */
import type { Tick } from "@finlytics/broker-sdk";
import {
  DecimalStringSchema,
  InstrumentKeySchema,
  PriceSchema,
  RtDepthSchema,
  toDecimal,
  toDecimalString,
} from "@finlytics/shared";
import type { InstrumentKey, RtDepth, RtQuoteRow } from "@finlytics/shared";
import { z } from "zod";

const CountSchema = z.int().min(0);

export const QuoteUpdateSchema = z.strictObject({
  k: InstrumentKeySchema,
  ltp: PriceSchema,
  chg: DecimalStringSchema,
  chgPct: DecimalStringSchema,
  /** The day's volume; absent when the tick doesn't carry it (`ltp` mode, indices). */
  vol: CountSchema.optional(),
  ts: CountSchema,
  close: PriceSchema.optional(),
  oi: CountSchema.optional(),
  bid: PriceSchema.optional(),
  ask: PriceSchema.optional(),
  open: PriceSchema.optional(),
  high: PriceSchema.optional(),
  low: PriceSchema.optional(),
  atp: PriceSchema.optional(),
  bidQty: CountSchema.optional(),
  askQty: CountSchema.optional(),
  ltq: CountSchema.optional(),
});
export type QuoteUpdate = z.infer<typeof QuoteUpdateSchema>;

/** The optional price fields, as the tick, the update and the hash name them. */
const PRICE_FIELDS = ["close", "bid", "ask", "open", "high", "low", "atp"] as const;
/** The optional integer fields of the update (and the hash) and the tick field each comes from. */
const COUNT_FIELDS = [
  ["oi", "oi"],
  ["bidQty", "bidQty"],
  ["askQty", "askQty"],
  ["ltq", "ltq"],
] as const;

/** Most book levels kept per side. */
const MAX_DEPTH_LEVELS = 20;

/** Change and change % against the previous close (`"0"`, `"0"` without a positive close). */
export function changeOf(ltp: string, close: string | undefined): { chg: string; chgPct: string } {
  if (close === undefined) return { chg: "0", chgPct: "0" };
  const base = toDecimal(close);
  if (base.lte(0)) return { chg: "0", chgPct: "0" };
  const change = toDecimal(ltp).minus(base);
  return { chg: toDecimalString(change), chgPct: toDecimalString(change.div(base).times(100).toDecimalPlaces(2)) };
}

/** The update a normalised tick stands for. */
export function toQuoteUpdate(tick: Tick): QuoteUpdate {
  const update: Record<string, unknown> = {
    k: tick.instrumentKey,
    ltp: tick.ltp,
    ...changeOf(tick.ltp, tick.close),
    ts: tick.ts,
  };
  // A tick without volume (`ltp` mode) must not reset the stored day volume.
  if (tick.volume !== undefined) update["vol"] = tick.volume;
  for (const field of PRICE_FIELDS) if (tick[field] !== undefined) update[field] = tick[field];
  for (const [field, source] of COUNT_FIELDS) if (tick[source] !== undefined) update[field] = tick[source];
  return update as QuoteUpdate;
}

/** The `quote:<key>` hash fields for an update; `src` is the broker whose feed wrote it. */
export function quoteHashFields(update: QuoteUpdate, src?: string): Record<string, string> {
  const fields: Record<string, string> = {
    ltp: update.ltp,
    chg: update.chg,
    chgPct: update.chgPct,
    ts: String(update.ts),
  };
  if (update.vol !== undefined) fields["vol"] = String(update.vol);
  for (const field of PRICE_FIELDS) {
    const value = update[field];
    if (value !== undefined) fields[field] = value;
  }
  for (const [field] of COUNT_FIELDS) {
    const value = update[field];
    if (value !== undefined) fields[field] = String(value);
  }
  if (src !== undefined) fields["src"] = src;
  return fields;
}

export function encodeQuoteUpdate(update: QuoteUpdate): string {
  return JSON.stringify(update);
}

/** The update in a `q:<key>` message, or undefined when it isn't one (never trusted blindly). */
export function decodeQuoteUpdate(text: string): QuoteUpdate | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = QuoteUpdateSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** The `q` event row: `[key, ltp, chg, chgPct, vol, ts, open, high, low, close, oi, atp]` (null when unknown). */
export function toQuoteRow(update: QuoteUpdate): RtQuoteRow {
  return [
    update.k,
    update.ltp,
    update.chg,
    update.chgPct,
    update.vol ?? 0,
    update.ts,
    update.open ?? null,
    update.high ?? null,
    update.low ?? null,
    update.close ?? null,
    update.oi ?? null,
    update.atp ?? null,
  ];
}

/**
 * A `quote:<key>` hash read back as an update (the snapshot a new subscriber gets), or undefined when the hash is
 * missing or malformed. An invalid optional field is left out rather than failing the whole quote.
 */
export function quoteFromHash(key: InstrumentKey, hash: Record<string, string>): QuoteUpdate | undefined {
  const count = (value: string | undefined): number | undefined =>
    value === undefined || !/^\d{1,16}$/.test(value) ? undefined : Number(value);
  const candidate: Record<string, unknown> = {
    k: key,
    ltp: hash["ltp"],
    chg: hash["chg"] ?? "0",
    chgPct: hash["chgPct"] ?? "0",
    ts: count(hash["ts"]),
  };
  const vol = count(hash["vol"]);
  if (vol !== undefined) candidate["vol"] = vol;
  const head = { ltp: candidate["ltp"], chg: candidate["chg"], chgPct: candidate["chgPct"] };
  if (!QuoteUpdateSchema.pick({ ltp: true, chg: true, chgPct: true }).safeParse(head).success) return undefined;
  for (const field of PRICE_FIELDS) {
    if (PriceSchema.safeParse(hash[field]).success) candidate[field] = hash[field];
  }
  for (const [field] of COUNT_FIELDS) {
    const value = count(hash[field]);
    if (value !== undefined) candidate[field] = value;
  }
  const parsed = QuoteUpdateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** The book a tick carries as an `RtDepth` (best first), or undefined without one or when it doesn't validate. */
export function toDepth(tick: Tick): RtDepth | undefined {
  if (tick.depth === undefined) return undefined;
  const side = (levels: NonNullable<Tick["depth"]>["bids"]) =>
    levels.slice(0, MAX_DEPTH_LEVELS).map((level) => [level.price, level.qty, level.orders ?? 0] as const);
  const parsed = RtDepthSchema.safeParse({
    k: tick.instrumentKey,
    t: tick.ts,
    bids: side(tick.depth.bids),
    asks: side(tick.depth.asks),
    tbq: tick.tbq ?? null,
    tsq: tick.tsq ?? null,
  });
  return parsed.success ? parsed.data : undefined;
}

/** A stored or published depth (JSON), or undefined when it isn't one. */
export function decodeDepth(text: string | null): RtDepth | undefined {
  if (text === null) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = RtDepthSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
