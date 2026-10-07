/**
 * Charts: the wire contract is `@finlytics/shared` (`GET /v1/candles`: bars with `ts` in epoch ms and decimal-string
 * prices, timeframes M1 M5 M15 H1 D1, at most `MAX_CANDLES_PER_REQUEST` bars per request). The workspace offers more
 * intervals: 3m, 30m, 4H and 1W are resampled in the browser from a finer timeframe the api serves.
 */
import { CANDLE_TIMEFRAME_MS, MAX_CANDLES_PER_REQUEST } from "@finlytics/shared";
import type { CandleTimeframe } from "@finlytics/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Intervals

export const CHART_INTERVALS = Object.freeze(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const);
export const ChartIntervalSchema = z.enum(CHART_INTERVALS);
export type ChartInterval = z.infer<typeof ChartIntervalSchema>;
export const DEFAULT_INTERVAL: ChartInterval = "M5";

export interface IntervalSpec {
  /** Toolbar text: `5m`, `1H`, `1D`. */
  short: string;
  /** Accessible name: `5 minutes`. */
  long: string;
  /** Bar length in seconds. */
  seconds: number;
  /** The api timeframe the bars are built from. */
  source: CandleTimeframe;
  /** Calendar days the first request spans (within the api's bar cap for `source`). */
  lookbackDays: number;
  /** Minutes and hours (a time on the axis), else days and weeks. */
  intraday: boolean;
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

export const INTERVALS: Readonly<Record<ChartInterval, IntervalSpec>> = Object.freeze({
  M1: { short: "1m", long: "1 minute", seconds: MINUTE, source: "M1", lookbackDays: 3, intraday: true },
  M3: { short: "3m", long: "3 minutes", seconds: 3 * MINUTE, source: "M1", lookbackDays: 3, intraday: true },
  M5: { short: "5m", long: "5 minutes", seconds: 5 * MINUTE, source: "M5", lookbackDays: 10, intraday: true },
  M15: { short: "15m", long: "15 minutes", seconds: 15 * MINUTE, source: "M15", lookbackDays: 30, intraday: true },
  M30: { short: "30m", long: "30 minutes", seconds: 30 * MINUTE, source: "M15", lookbackDays: 50, intraday: true },
  H1: { short: "1H", long: "1 hour", seconds: HOUR, source: "H1", lookbackDays: 120, intraday: true },
  H4: { short: "4H", long: "4 hours", seconds: 4 * HOUR, source: "H1", lookbackDays: 200, intraday: true },
  D1: { short: "1D", long: "1 day", seconds: DAY, source: "D1", lookbackDays: 730, intraday: false },
  W1: { short: "1W", long: "1 week", seconds: 7 * DAY, source: "D1", lookbackDays: 3_650, intraday: false },
});

/** Whether the interval is built in the browser from a finer api timeframe. */
export function isResampled(interval: ChartInterval): boolean {
  return INTERVALS[interval].seconds * 1_000 !== CANDLE_TIMEFRAME_MS[INTERVALS[interval].source];
}

/** The widest span (seconds) one `/v1/candles` request may cover for a timeframe. */
export function maxRequestSpan(timeframe: CandleTimeframe): number {
  return (MAX_CANDLES_PER_REQUEST * CANDLE_TIMEFRAME_MS[timeframe]) / 1_000;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chart types, ranges, scales and settings

export const CHART_TYPES = Object.freeze([
  "candles",
  "hollow",
  "bars",
  "line",
  "area",
  "baseline",
  "heikin-ashi",
] as const);
export const ChartTypeSchema = z.enum(CHART_TYPES);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const CHART_TYPE_LABELS: Readonly<Record<ChartType, string>> = Object.freeze({
  candles: "Candles",
  hollow: "Hollow candles",
  bars: "Bars",
  line: "Line",
  area: "Area",
  baseline: "Baseline",
  "heikin-ashi": "Heikin Ashi",
});

export const CHART_RANGES = Object.freeze(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"] as const);
export type ChartRange = (typeof CHART_RANGES)[number];

export interface RangeSpec {
  label: string;
  long: string;
  /** The interval the range is shown in (TradingView's pairing). */
  interval: ChartInterval;
}

export const RANGES: Readonly<Record<ChartRange, RangeSpec>> = Object.freeze({
  "1D": { label: "1D", long: "1 day", interval: "M1" },
  "5D": { label: "5D", long: "5 days", interval: "M5" },
  "1M": { label: "1M", long: "1 month", interval: "M30" },
  "3M": { label: "3M", long: "3 months", interval: "H1" },
  "6M": { label: "6M", long: "6 months", interval: "H4" },
  YTD: { label: "YTD", long: "Year to date", interval: "D1" },
  "1Y": { label: "1Y", long: "1 year", interval: "D1" },
  ALL: { label: "All", long: "All history", interval: "W1" },
});

export const SCALE_MODES = Object.freeze(["normal", "log", "percent"] as const);
export const ScaleModeSchema = z.enum(SCALE_MODES);
export type ScaleMode = z.infer<typeof ScaleModeSchema>;

export const ChartSettingsSchema = z.object({
  gridVertical: z.boolean(),
  gridHorizontal: z.boolean(),
  /** `magnet` snaps the crosshair's price to the bar's open/high/low/close. */
  crosshair: z.enum(["normal", "magnet"]),
  /** The dashed last-price line and its axis label. */
  priceLine: z.boolean(),
  /** A vertical line at each new trading day on intraday charts. */
  sessionBreaks: z.boolean(),
});
export type ChartSettings = z.infer<typeof ChartSettingsSchema>;

export const DEFAULT_SETTINGS: ChartSettings = Object.freeze({
  gridVertical: true,
  gridHorizontal: true,
  crosshair: "normal",
  priceLine: true,
  sessionBreaks: false,
});
