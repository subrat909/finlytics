/**
 * Candles (`GET /v1/candles`) and the TradingView UDF datafeed (`GET /v1/udf/*`), phase 1 plan "REST".
 *
 * Candles are OHLCV bars from Timescale `Candle`: `ts` is the bar's start (epoch ms, UTC), prices are decimal strings,
 * volume and OI are integers. Only complete bars are served; the client draws the live bar from ticks.
 */
import { z } from "zod";

import { InstrumentKeySchema } from "../instrument-key";
import { PriceSchema } from "../money";

/** Timeframes the api serves (a subset of Prisma `Timeframe`). */
export const CANDLE_TIMEFRAMES = Object.freeze(["M1", "M5", "M15", "H1", "D1"] as const);
export const CandleTimeframeSchema = z.enum(CANDLE_TIMEFRAMES);
export type CandleTimeframe = z.infer<typeof CandleTimeframeSchema>;

/** Each timeframe's bar length in milliseconds. */
export const CANDLE_TIMEFRAME_MS = Object.freeze({
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  D1: 86_400_000,
} as const satisfies Record<CandleTimeframe, number>);

/** The most bars one request may span (`(to − from) / bar length`). */
export const MAX_CANDLES_PER_REQUEST = 5_000;

/** Epoch seconds as digits only: what TradingView and most clients send. */
const EPOCH_SECONDS = /^\d{1,11}$/;

/**
 * A time as epoch seconds (digits) or an ISO 8601 date-time with an offset, read into a Date. Anything else (or a date
 * outside 2000–2099) is invalid.
 */
export const CandleTimeSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, ctx) => {
    const ms = EPOCH_SECONDS.test(value)
      ? Number(value) * 1_000
      : z.iso.datetime({ offset: true }).safeParse(value).success
        ? Date.parse(value)
        : Number.NaN;
    if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms >= Date.UTC(2100, 0, 1)) {
      ctx.addIssue({ code: "custom", message: "Expected epoch seconds or an ISO 8601 date-time from 2000 to 2099" });
      return z.NEVER;
    }
    return new Date(ms);
  });

/** `GET /v1/candles?key=&tf=&from=&to=`: `from` inclusive, `to` exclusive, at most {@link MAX_CANDLES_PER_REQUEST} bars. */
export const CandlesQuerySchema = z
  .strictObject({
    key: InstrumentKeySchema,
    tf: CandleTimeframeSchema,
    from: CandleTimeSchema,
    to: CandleTimeSchema,
  })
  .superRefine((query, ctx) => {
    const span = query.to.getTime() - query.from.getTime();
    if (span <= 0) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Must be after from" });
    } else if (span / CANDLE_TIMEFRAME_MS[query.tf] > MAX_CANDLES_PER_REQUEST) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: `The range spans more than ${String(MAX_CANDLES_PER_REQUEST)} bars of this timeframe`,
      });
    }
  });
export type CandlesQuery = z.infer<typeof CandlesQuerySchema>;

/** One bar on the wire. */
export const CandleBarSchema = z.strictObject({
  /** Bar start, epoch milliseconds (UTC). */
  ts: z.int().min(0),
  open: PriceSchema,
  high: PriceSchema,
  low: PriceSchema,
  close: PriceSchema,
  volume: z.int().min(0),
  oi: z.int().min(0).optional(),
});
export type CandleBar = z.infer<typeof CandleBarSchema>;

/** `GET /v1/candles`: bars in ascending time order. */
export const CandleListSchema = z.array(CandleBarSchema);
export type CandleList = z.infer<typeof CandleListSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// TradingView UDF (https://www.tradingview.com/charting-library-docs/latest/connecting_data/UDF)

/** UDF resolutions the api serves, and the candle timeframe behind each. */
export const UDF_RESOLUTIONS = Object.freeze({
  "1": "M1",
  "5": "M5",
  "15": "M15",
  "60": "H1",
  "1D": "D1",
  D: "D1",
} as const satisfies Record<string, CandleTimeframe>);
export type UdfResolution = keyof typeof UDF_RESOLUTIONS;

/** The resolutions advertised in `/udf/config` and on every symbol. */
export const UDF_SUPPORTED_RESOLUTIONS = Object.freeze(["1", "5", "15", "60", "1D"] as const);

export const UdfConfigSchema = z.strictObject({
  supported_resolutions: z.array(z.string()),
  supports_group_request: z.boolean(),
  supports_marks: z.boolean(),
  supports_search: z.boolean(),
  supports_timescale_marks: z.boolean(),
  supports_time: z.boolean(),
  exchanges: z.array(z.strictObject({ value: z.string(), name: z.string(), desc: z.string() })),
  symbols_types: z.array(z.strictObject({ name: z.string(), value: z.string() })),
});
export type UdfConfig = z.infer<typeof UdfConfigSchema>;

/** `/udf/symbols?symbol=`: the symbol is a canonical instrument key (the `ticker` every search result carries). */
export const UdfSymbolQuerySchema = z.strictObject({ symbol: InstrumentKeySchema });

export const UdfSymbolInfoSchema = z.strictObject({
  name: z.string(),
  ticker: z.string(),
  description: z.string(),
  type: z.string(),
  session: z.string(),
  timezone: z.literal("Asia/Kolkata"),
  exchange: z.string(),
  listed_exchange: z.string(),
  minmov: z.int().min(1),
  pricescale: z.int().min(1),
  has_intraday: z.boolean(),
  has_daily: z.boolean(),
  supported_resolutions: z.array(z.string()),
  intraday_multipliers: z.array(z.string()),
  volume_precision: z.int().min(0),
  data_status: z.enum(["streaming", "endofday"]),
});
export type UdfSymbolInfo = z.infer<typeof UdfSymbolInfoSchema>;

/** `/udf/search?query=&limit=&type=&exchange=`. */
export const UdfSearchQuerySchema = z.strictObject({
  query: z.string().trim().max(64).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.string().max(32).optional(),
  exchange: z.string().max(32).optional(),
});
export type UdfSearchQuery = z.infer<typeof UdfSearchQuerySchema>;

export const UdfSearchResultSchema = z.array(
  z.strictObject({
    symbol: z.string(),
    full_name: z.string(),
    description: z.string(),
    exchange: z.string(),
    ticker: z.string(),
    type: z.string(),
  }),
);
export type UdfSearchResult = z.infer<typeof UdfSearchResultSchema>;

/** `/udf/history?symbol=&resolution=&from=&to=&countback=` (epoch seconds). */
export const UdfHistoryQuerySchema = z.strictObject({
  symbol: InstrumentKeySchema,
  resolution: z.enum(Object.keys(UDF_RESOLUTIONS) as [UdfResolution, ...UdfResolution[]]),
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0),
  countback: z.coerce.number().int().min(1).max(5_000).optional(),
});
export type UdfHistoryQuery = z.infer<typeof UdfHistoryQuerySchema>;

/**
 * The UDF history answer: `s: "ok"` with parallel arrays (seconds and numbers), or `s: "no_data"` (optionally with
 * `nextTime`). One object schema, not a union, so it documents as one OpenAPI response.
 */
export const UdfHistorySchema = z
  .strictObject({
    s: z.enum(["ok", "no_data"]),
    t: z.array(z.number()).optional(),
    o: z.array(z.number()).optional(),
    h: z.array(z.number()).optional(),
    l: z.array(z.number()).optional(),
    c: z.array(z.number()).optional(),
    v: z.array(z.number()).optional(),
    nextTime: z.number().optional(),
  })
  .refine(
    (history) =>
      history.s === "no_data" ||
      [history.t, history.o, history.h, history.l, history.c, history.v].every(
        (series) => series !== undefined && series.length === history.t?.length,
      ),
    { message: "An ok answer carries t, o, h, l, c and v of equal length" },
  );
export type UdfHistory = z.infer<typeof UdfHistorySchema>;
