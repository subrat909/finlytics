/**
 * What the feed publishes per tick (phase 1 plan "Redis keys"): a {@link QuoteUpdate}, written three ways by the feed
 * leader and read by the gateway.
 *
 * - `quote:<key>` hash: {@link quoteHashFields} (`ltp, close, chg, chgPct, vol, oi, bid, ask, ts`; decimal strings,
 *   `ts` epoch ms). Fields the tick doesn't carry are left as they were.
 * - `q:<key>` channel: {@link encodeQuoteUpdate}, JSON; the gateway reads it back with {@link decodeQuoteUpdate}.
 * - `ticks:<broker>` stream: the same JSON under field `u`, with the key under `k`.
 *
 * `chg` = ltp − previous close and `chgPct` = chg / close × 100 (2 decimals), exact decimals; both `"0"` when the close
 * isn't known.
 */
import type { Tick } from "@finlytics/broker-sdk";
import { InstrumentKeySchema, PriceSchema, DecimalStringSchema, toDecimal, toDecimalString } from "@finlytics/shared";
import type { InstrumentKey, RtQuoteRow } from "@finlytics/shared";
import { z } from "zod";

export const QuoteUpdateSchema = z.strictObject({
  k: InstrumentKeySchema,
  ltp: PriceSchema,
  chg: DecimalStringSchema,
  chgPct: DecimalStringSchema,
  vol: z.int().min(0),
  ts: z.int().min(0),
  close: PriceSchema.optional(),
  oi: z.int().min(0).optional(),
  bid: PriceSchema.optional(),
  ask: PriceSchema.optional(),
});
export type QuoteUpdate = z.infer<typeof QuoteUpdateSchema>;

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
  return {
    k: tick.instrumentKey,
    ltp: tick.ltp,
    ...changeOf(tick.ltp, tick.close),
    vol: tick.volume ?? 0,
    ts: tick.ts,
    ...(tick.close === undefined ? {} : { close: tick.close }),
    ...(tick.oi === undefined ? {} : { oi: tick.oi }),
    ...(tick.bid === undefined ? {} : { bid: tick.bid }),
    ...(tick.ask === undefined ? {} : { ask: tick.ask }),
  };
}

/** The `quote:<key>` hash fields for an update. */
export function quoteHashFields(update: QuoteUpdate): Record<string, string> {
  const fields: Record<string, string> = {
    ltp: update.ltp,
    chg: update.chg,
    chgPct: update.chgPct,
    vol: String(update.vol),
    ts: String(update.ts),
  };
  if (update.close !== undefined) fields["close"] = update.close;
  if (update.oi !== undefined) fields["oi"] = String(update.oi);
  if (update.bid !== undefined) fields["bid"] = update.bid;
  if (update.ask !== undefined) fields["ask"] = update.ask;
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

/** The `q` event row: `[key, ltp, chg, chgPct, vol, ts]`. */
export function toQuoteRow(update: QuoteUpdate): RtQuoteRow {
  return [update.k, update.ltp, update.chg, update.chgPct, update.vol, update.ts];
}

/**
 * A `quote:<key>` hash read back as an update (the snapshot a new subscriber gets), or undefined when the hash is
 * missing or malformed.
 */
export function quoteFromHash(key: InstrumentKey, hash: Record<string, string>): QuoteUpdate | undefined {
  const number = (value: string | undefined): number | undefined =>
    value === undefined || !/^\d{1,16}$/.test(value) ? undefined : Number(value);
  const candidate = {
    k: key,
    ltp: hash["ltp"],
    chg: hash["chg"] ?? "0",
    chgPct: hash["chgPct"] ?? "0",
    vol: number(hash["vol"]) ?? 0,
    ts: number(hash["ts"]),
    ...(hash["close"] === undefined ? {} : { close: hash["close"] }),
  };
  const parsed = QuoteUpdateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
