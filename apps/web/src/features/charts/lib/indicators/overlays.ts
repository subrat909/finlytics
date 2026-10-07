/**
 * Price-pane indicators (pure): VWAP, Bollinger Bands, SuperTrend, Donchian channels and Parabolic SAR, following
 * TradingView's built-ins.
 */
import type { Bar } from "../bars";
import { dayStart } from "../time";

import { highest, lowest, rma, sma, stdev, trueRange } from "./core";
import type { Input, Series } from "./core";

/** Volume-weighted average of the typical price (hlc3), restarting at each IST trading day. Null without volume. */
export function vwap(bars: readonly Bar[]): Series {
  let day = Number.NaN;
  let priceVolume = 0;
  let volume = 0;
  return bars.map((bar) => {
    const start = dayStart(bar.time);
    if (start !== day) {
      day = start;
      priceVolume = 0;
      volume = 0;
    }
    priceVolume += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    volume += bar.volume;
    return volume > 0 ? priceVolume / volume : null;
  });
}

export interface Bands {
  basis: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger Bands: the SMA ± `multiplier` population standard deviations. */
export function bollinger(values: Input, period: number, multiplier: number): Bands {
  const basis = sma(values, period);
  const deviation = stdev(values, period);
  return {
    basis,
    upper: basis.map((value, index) => (value === null ? null : value + multiplier * (deviation[index] ?? 0))),
    lower: basis.map((value, index) => (value === null ? null : value - multiplier * (deviation[index] ?? 0))),
  };
}

/** Donchian channels: the highest high and lowest low of the window, and their midpoint. */
export function donchian(bars: readonly Bar[], period: number): Bands {
  const upper = highest(
    bars.map((bar) => bar.high),
    period,
  );
  const lower = lowest(
    bars.map((bar) => bar.low),
    period,
  );
  return {
    upper,
    lower,
    basis: upper.map((value, index) => {
      const low = lower[index];
      return value === null || low === null || low === undefined ? null : (value + low) / 2;
    }),
  };
}

export interface SuperTrend {
  /** The line while the trend is up (below price), else null. */
  up: Series;
  /** The line while the trend is down (above price), else null. */
  down: Series;
  /** -1 up, 1 down (Pine's convention), null while warming up. */
  direction: (1 | -1 | null)[];
}

/** SuperTrend (Pine's `ta.supertrend(factor, atrPeriod)`) on hl2 with Wilder's ATR. */
export function supertrend(bars: readonly Bar[], period: number, factor: number): SuperTrend {
  const atr = rma(trueRange(bars), period);
  const result: SuperTrend = { up: [], down: [], direction: [] };
  let previousUpper: number | null = null;
  let previousLower: number | null = null;
  let previousTrend: number | null = null;
  let previousClose: number | null = null;
  bars.forEach((bar, index) => {
    const range = atr[index] ?? null;
    if (range === null) {
      result.up.push(null);
      result.down.push(null);
      result.direction.push(null);
      previousClose = bar.close;
      return;
    }
    const middle = (bar.high + bar.low) / 2;
    let upper = middle + factor * range;
    let lower = middle - factor * range;
    const lastLower = previousLower ?? 0;
    const lastUpper = previousUpper ?? 0;
    lower = lower > lastLower || (previousClose !== null && previousClose < lastLower) ? lower : lastLower;
    upper = upper < lastUpper || previousClose === null || previousClose > lastUpper ? upper : lastUpper;

    let direction: 1 | -1;
    if ((atr[index - 1] ?? null) === null) direction = 1;
    else if (previousTrend === previousUpper) direction = bar.close > upper ? -1 : 1;
    else direction = bar.close < lower ? 1 : -1;
    const trend = direction === -1 ? lower : upper;

    result.up.push(direction === -1 ? trend : null);
    result.down.push(direction === 1 ? trend : null);
    result.direction.push(direction);
    previousUpper = upper;
    previousLower = lower;
    previousTrend = trend;
    previousClose = bar.close;
  });
  return result;
}

/** Parabolic SAR (Pine's `ta.sar(start, increment, maximum)`); the first bar has none. */
export function parabolicSar(bars: readonly Bar[], start: number, increment: number, maximum: number): Series {
  const out: Series = bars.map(() => null);
  let result = 0;
  let extremePoint = 0;
  let acceleration = start;
  let rising = false;
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previous = bars[index - 1];
    if (bar === undefined || previous === undefined) continue;
    let firstTrendBar = false;
    if (index === 1) {
      rising = bar.close > previous.close;
      extremePoint = rising ? bar.high : bar.low;
      result = rising ? previous.low : previous.high;
      firstTrendBar = true;
      acceleration = start;
    }
    result += acceleration * (extremePoint - result);
    if (rising && result > bar.low) {
      firstTrendBar = true;
      rising = false;
      result = Math.max(bar.high, extremePoint);
      extremePoint = bar.low;
      acceleration = start;
    } else if (!rising && result < bar.high) {
      firstTrendBar = true;
      rising = true;
      result = Math.min(bar.low, extremePoint);
      extremePoint = bar.high;
      acceleration = start;
    }
    if (!firstTrendBar) {
      if (rising && bar.high > extremePoint) {
        extremePoint = bar.high;
        acceleration = Math.min(acceleration + increment, maximum);
      } else if (!rising && bar.low < extremePoint) {
        extremePoint = bar.low;
        acceleration = Math.min(acceleration + increment, maximum);
      }
    }
    const before = bars[index - 2];
    if (rising) {
      result = Math.min(result, previous.low, before?.low ?? previous.low);
    } else {
      result = Math.max(result, previous.high, before?.high ?? previous.high);
    }
    out[index] = result;
  }
  return out;
}
