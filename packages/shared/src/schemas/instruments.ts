/**
 * Instruments (plan P6; docs/04 §2 "Market data"): `GET /v1/instruments?q=` (search) and `GET /v1/instruments/:key`.
 * Prices are decimal strings, expiries `YYYY-MM-DD`.
 */
import { z } from "zod";

import { PriceSchema } from "../money";

import { BrokerCodeSchema, ExchangeSchema, OptionTypeSchema, SegmentSchema } from "./enums";

/** The most results one search returns. */
export const INSTRUMENT_SEARCH_MAX_LIMIT = 50;

/** `GET /v1/instruments` query: `q` (1–64 characters) with optional exchange and segment filters. */
export const InstrumentSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(64),
  exchange: ExchangeSchema.optional(),
  segment: SegmentSchema.optional(),
  limit: z.coerce.number().int().min(1).max(INSTRUMENT_SEARCH_MAX_LIMIT).default(20),
});
export type InstrumentSearchQuery = z.infer<typeof InstrumentSearchQuerySchema>;

/** One instrument as the api shows it. */
export const InstrumentSchema = z.strictObject({
  /** The canonical key (`NSE_FO|NIFTY|2025-10-30|24000|CE`). */
  key: z.string().min(1),
  exchange: ExchangeSchema,
  segment: SegmentSchema,
  /** EQ/INDEX: the trading symbol; FUT/OPT: the underlying. */
  symbol: z.string().min(1),
  /** The exchange's trading symbol (`NIFTY25OCT24000CE`), when known. */
  tradingSymbol: z.string().nullable(),
  name: z.string(),
  expiry: z.iso.date().nullable(),
  strike: PriceSchema.nullable(),
  optionType: OptionTypeSchema.nullable(),
  lotSize: z.int().min(1),
  tickSize: PriceSchema,
  isActive: z.boolean(),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

/** `GET /v1/instruments`: best matches first. */
export const InstrumentListSchema = z.array(InstrumentSchema);

/** `POST /v1/admin/instruments/sync` (admins): one broker, or every broker with an instrument master when omitted. */
export const InstrumentSyncRequestSchema = z.strictObject({ broker: BrokerCodeSchema.optional() });
export type InstrumentSyncRequest = z.infer<typeof InstrumentSyncRequestSchema>;

/** The queued jobs (202). A job id already queued in the same minute is reused. */
export const InstrumentSyncResultSchema = z.strictObject({
  jobs: z.array(z.strictObject({ broker: BrokerCodeSchema, jobId: z.string().min(1) })),
});
export type InstrumentSyncResult = z.infer<typeof InstrumentSyncResultSchema>;
