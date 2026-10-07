/**
 * Intraday maths for the watchlist's mini chart. Times are epoch seconds shifted to IST (+5:30), so the axis reads in
 * market time whatever the device's zone (Lightweight Charts draws UTC).
 */
import type { CandleBar } from "@finlytics/shared";

export const IST_OFFSET_S = 19_800;
/** The mini chart's bars: 5 minutes (`tf=M5`). */
export const INTRADAY_PERIOD_S = 300;
/** Enough history to reach the last session over a long weekend (5 × 288 bars, under the api's 5,000). */
export const INTRADAY_LOOKBACK_S = 5 * 86_400;

export interface IntradayPoint {
  /** Epoch seconds, IST-shifted. */
  time: number;
  value: number;
}

/** The IST calendar day of an IST-shifted time (days since the epoch). */
export function istDay(time: number): number {
  return Math.floor(time / 86_400);
}

/** A tick's exchange time (epoch ms) as the start of its 5-minute bucket, IST-shifted. */
export function tickBucket(ts: number): number {
  const shifted = Math.floor(ts / 1_000) + IST_OFFSET_S;
  return Math.floor(shifted / INTRADAY_PERIOD_S) * INTRADAY_PERIOD_S;
}

/** The closes of the latest session in `candles` (ascending, as the api sends them). */
export function lastSession(candles: readonly CandleBar[]): IntradayPoint[] {
  const points = candles.map((candle) => ({
    time: Math.floor(candle.ts / 1_000) + IST_OFFSET_S,
    value: Number(candle.close),
  }));
  const last = points.at(-1);
  if (last === undefined) return [];
  const day = istDay(last.time);
  return points.filter((point) => istDay(point.time) === day);
}

/** `[from, to]` in epoch seconds for the lookback, ending now. */
export function intradayRange(nowMs: number): { from: number; to: number } {
  const to = Math.floor(nowMs / 1_000);
  return { from: to - INTRADAY_LOOKBACK_S, to };
}
