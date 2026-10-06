/**
 * Charts: the wire contract is `@finlytics/shared` (`schemas/candles`, stream C2): `GET /v1/candles` bars with `ts` in
 * epoch ms and decimal-string prices. This file adds the UI's timeframe labels and lookbacks.
 */
import { CANDLE_TIMEFRAME_MS, CANDLE_TIMEFRAMES, CandleTimeframeSchema } from "@finlytics/shared";
import type { CandleTimeframe } from "@finlytics/shared";

export type Timeframe = CandleTimeframe;
export const TIMEFRAMES = CANDLE_TIMEFRAMES;
export const TimeframeSchema = CandleTimeframeSchema;
export const DEFAULT_TIMEFRAME: Timeframe = "M5";

export const TIMEFRAME_LABELS: Readonly<Record<Timeframe, { short: string; long: string }>> = {
  M1: { short: "1m", long: "1 minute" },
  M5: { short: "5m", long: "5 minutes" },
  M15: { short: "15m", long: "15 minutes" },
  H1: { short: "1h", long: "1 hour" },
  D1: { short: "1D", long: "1 day" },
};

/** Seconds per bar (the chart's unit). */
export const TIMEFRAME_SECONDS: Readonly<Record<Timeframe, number>> = {
  M1: CANDLE_TIMEFRAME_MS.M1 / 1_000,
  M5: CANDLE_TIMEFRAME_MS.M5 / 1_000,
  M15: CANDLE_TIMEFRAME_MS.M15 / 1_000,
  H1: CANDLE_TIMEFRAME_MS.H1 / 1_000,
  D1: CANDLE_TIMEFRAME_MS.D1 / 1_000,
};

/**
 * How far back each timeframe loads: enough bars to read the trend, and within the api's `MAX_CANDLES_PER_REQUEST`
 * (5,000 bars of calendar time: 3 days of M1 is 4,320).
 */
export const TIMEFRAME_LOOKBACK_DAYS: Readonly<Record<Timeframe, number>> = {
  M1: 3,
  M5: 10,
  M15: 30,
  H1: 120,
  D1: 730,
};
