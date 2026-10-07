/**
 * Pane indicators (pure): RSI, MACD, Stochastic, ATR, ADX/DMI and OBV, following TradingView's built-ins.
 */
import type { Bar } from "../bars";

import { ema, highest, lowest, rma, sma, subtract, trueRange } from "./core";
import type { Input, Series } from "./core";

/** Relative Strength Index with Wilder's smoothing (Pine's `ta.rsi`). */
export function rsi(values: Input, period: number): Series {
  const gains: Series = [];
  const losses: Series = [];
  values.forEach((value, index) => {
    const previous = values[index - 1];
    if (index === 0 || value === null || value === undefined || previous === null || previous === undefined) {
      gains.push(null);
      losses.push(null);
      return;
    }
    gains.push(Math.max(value - previous, 0));
    losses.push(Math.max(previous - value, 0));
  });
  const up = rma(gains, period);
  const down = rma(losses, period);
  return up.map((gain, index) => {
    const loss = down[index] ?? null;
    if (gain === null || loss === null) return null;
    if (loss === 0) return 100;
    if (gain === 0) return 0;
    return 100 - 100 / (1 + gain / loss);
  });
}

export interface Macd {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD: the fast EMA − the slow EMA, its EMA as the signal line, and their difference as the histogram. */
export function macd(values: Input, fast: number, slow: number, signal: number): Macd {
  const line = subtract(ema(values, fast), ema(values, slow));
  const signalLine = ema(line, signal);
  return { macd: line, signal: signalLine, histogram: subtract(line, signalLine) };
}

export interface Stochastic {
  k: Series;
  d: Series;
}

/** Stochastic oscillator: %K (smoothed by an SMA) and %D, its SMA. A flat window has no value. */
export function stochastic(bars: readonly Bar[], period: number, smoothK: number, smoothD: number): Stochastic {
  const high = highest(
    bars.map((bar) => bar.high),
    period,
  );
  const low = lowest(
    bars.map((bar) => bar.low),
    period,
  );
  const raw = bars.map((bar, index) => {
    const top = high[index] ?? null;
    const bottom = low[index] ?? null;
    if (top === null || bottom === null || top === bottom) return null;
    return (100 * (bar.close - bottom)) / (top - bottom);
  });
  const k = sma(raw, smoothK);
  return { k, d: sma(k, smoothD) };
}

/** Average True Range with Wilder's smoothing (Pine's `ta.atr`). */
export function atr(bars: readonly Bar[], period: number): Series {
  return rma(trueRange(bars), period);
}

export interface Dmi {
  adx: Series;
  plus: Series;
  minus: Series;
}

/** Directional movement (Pine's `ta.dmi(diLength, adxSmoothing)`): +DI, −DI and ADX. */
export function adx(bars: readonly Bar[], diLength: number, adxSmoothing: number): Dmi {
  const range: Series = [];
  const plusMove: Series = [];
  const minusMove: Series = [];
  bars.forEach((bar, index) => {
    const previous = bars[index - 1];
    if (previous === undefined) {
      range.push(null);
      plusMove.push(null);
      minusMove.push(null);
      return;
    }
    const up = bar.high - previous.high;
    const down = previous.low - bar.low;
    plusMove.push(up > down && up > 0 ? up : 0);
    minusMove.push(down > up && down > 0 ? down : 0);
    range.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close)));
  });
  const smoothedRange = rma(range, diLength);
  const smoothedPlus = rma(plusMove, diLength);
  const smoothedMinus = rma(minusMove, diLength);

  // `fixnan`: a zero range carries the last value forward instead of dividing by zero.
  const directional = (moves: Series): Series => {
    let last: number | null = null;
    return moves.map((move, index) => {
      const total = smoothedRange[index] ?? null;
      if (move === null || total === null) return null;
      if (total !== 0) last = (100 * move) / total;
      return last;
    });
  };
  const plus = directional(smoothedPlus);
  const minus = directional(smoothedMinus);
  const dx = plus.map((value, index) => {
    const other = minus[index] ?? null;
    if (value === null || other === null) return null;
    const sum = value + other;
    return Math.abs(value - other) / (sum === 0 ? 1 : sum);
  });
  return { adx: rma(dx, adxSmoothing).map((value) => (value === null ? null : 100 * value)), plus, minus };
}

/** On-Balance Volume: volume added on up closes, subtracted on down closes, from 0 at the first bar. */
export function obv(bars: readonly Bar[]): number[] {
  let total = 0;
  return bars.map((bar, index) => {
    const previous = bars[index - 1];
    if (previous !== undefined) total += Math.sign(bar.close - previous.close) * bar.volume;
    return total;
  });
}
