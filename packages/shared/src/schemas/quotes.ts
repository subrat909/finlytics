/**
 * Quotes (plan "Redis keys"; docs/04 §2 "Market data"): `GET /v1/quotes?keys=a,b` answers from the `quote:<key>` hashes
 * the feed worker writes, never from a broker. Numbers are decimal strings; `ts` is epoch milliseconds.
 */
import { z } from "zod";

import { InstrumentKeySchema } from "../instrument-key";

/** The most keys one request may ask for. */
export const MAX_QUOTE_KEYS = 50;

/** A number as the feed writes it: a plain decimal string, up to 18 integer digits and 8 decimals. */
const QuoteNumberSchema = z.string().regex(/^-?(0|[1-9]\d{0,17})(\.\d{1,8})?$/, "Expected a decimal string");

/** The latest quote of one instrument. Only `ltp` and `ts` are always there. */
export const QuoteSchema = z.strictObject({
  ltp: QuoteNumberSchema,
  /** Previous close. */
  close: QuoteNumberSchema.optional(),
  /** Change and change % against the previous close. */
  chg: QuoteNumberSchema.optional(),
  chgPct: QuoteNumberSchema.optional(),
  vol: QuoteNumberSchema.optional(),
  oi: QuoteNumberSchema.optional(),
  bid: QuoteNumberSchema.optional(),
  ask: QuoteNumberSchema.optional(),
  /** Exchange time of the last trade, epoch milliseconds. */
  ts: z.int().min(0),
});
export type Quote = z.infer<typeof QuoteSchema>;

/** The optional hash fields, in output order. */
const OPTIONAL_FIELDS = ["close", "chg", "chgPct", "vol", "oi", "bid", "ask"] as const;

/**
 * A `quote:<key>` hash (all values strings) as a {@link Quote}, or undefined without a valid `ltp` and `ts`. Invalid or
 * empty optional fields are left out rather than failing the whole quote.
 */
export function quoteFromHash(hash: Readonly<Record<string, string | undefined>>): Quote | undefined {
  const ltp = QuoteNumberSchema.safeParse(hash["ltp"]);
  const ts = /^\d{1,16}$/.test(hash["ts"] ?? "") ? Number(hash["ts"]) : Number.NaN;
  if (!ltp.success || !Number.isSafeInteger(ts)) return undefined;
  const quote: Record<string, string | number> = { ltp: ltp.data };
  for (const field of OPTIONAL_FIELDS) {
    const value = QuoteNumberSchema.safeParse(hash[field]);
    if (value.success) quote[field] = value.data;
  }
  quote["ts"] = ts;
  return quote as Quote;
}

/**
 * `GET /v1/quotes` query: `keys`, comma-separated canonical keys (1–50, duplicates collapsed). Keys never contain a
 * comma (instrument-key grammar).
 */
export const QuotesQuerySchema = z.strictObject({
  keys: z
    .string()
    .max(MAX_QUOTE_KEYS * 130)
    .transform((value) =>
      value
        .split(",")
        .map((key) => key.trim())
        .filter((key) => key !== ""),
    )
    .pipe(z.array(InstrumentKeySchema).min(1).max(MAX_QUOTE_KEYS))
    .transform((keys) => [...new Set(keys)]),
});
export type QuotesQuery = z.infer<typeof QuotesQuerySchema>;

/** `GET /v1/quotes`: one entry per requested key that has a quote; keys without one are left out. */
export const QuotesResultSchema = z.record(z.string(), QuoteSchema);
export type QuotesResult = z.infer<typeof QuotesResultSchema>;
