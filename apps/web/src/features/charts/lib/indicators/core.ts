/**
 * Indicator building blocks (pure, no DOM): moving averages and window statistics over series aligned with the bars.
 * `null` means "no value yet" (warm-up) and restarts a window, as `na` does in Pine Script, so a series computed from
 * another indicator (MACD's signal line) warms up after that indicator's own warm-up. The definitions follow
 * TradingView's built-ins (`ta.sma`, `ta.ema`, `ta.rma`, `ta.wma`, `ta.stdev`) so values match the charts traders know.
 */
import type { Bar } from "../bars";

export type Series = (number | null)[];
export type Input = readonly (number | null | undefined)[];

export type PriceSource = "close" | "open" | "high" | "low" | "hl2" | "hlc3" | "ohlc4";
export const PRICE_SOURCES: readonly PriceSource[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"];

export function source(bars: readonly Bar[], from: PriceSource): number[] {
  switch (from) {
    case "open":
      return bars.map((bar) => bar.open);
    case "high":
      return bars.map((bar) => bar.high);
    case "low":
      return bars.map((bar) => bar.low);
    case "hl2":
      return bars.map((bar) => (bar.high + bar.low) / 2);
    case "hlc3":
      return bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
    case "ohlc4":
      return bars.map((bar) => (bar.open + bar.high + bar.low + bar.close) / 4);
    case "close":
      return bars.map((bar) => bar.close);
  }
}

function blank(length: number): Series {
  return Array.from({ length }, () => null);
}

function valueAt(values: Input, index: number): number | null {
  const value = values[index];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** How many consecutive values end at each index (0 where the value is missing). */
function runLengths(values: Input): number[] {
  const runs: number[] = [];
  let run = 0;
  for (let index = 0; index < values.length; index += 1) {
    run = valueAt(values, index) === null ? 0 : run + 1;
    runs.push(run);
  }
  return runs;
}

/** Simple moving average. */
export function sma(values: Input, period: number): Series {
  const out = blank(values.length);
  const runs = runLengths(values);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = valueAt(values, index);
    if (value === null) {
      sum = 0;
      continue;
    }
    sum += value;
    if ((runs[index] ?? 0) > period) sum -= valueAt(values, index - period) ?? 0;
    if ((runs[index] ?? 0) >= period) out[index] = sum / period;
  }
  return out;
}

/** Exponential smoothing seeded with the SMA of the first `period` values (Pine's `ta.ema` and `ta.rma`). */
function smoothed(values: Input, period: number, alpha: number): Series {
  const out = blank(values.length);
  let previous: number | null = null;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = valueAt(values, index);
    if (value === null) {
      previous = null;
      sum = 0;
      count = 0;
      continue;
    }
    if (previous === null) {
      sum += value;
      count += 1;
      if (count === period) {
        previous = sum / period;
        out[index] = previous;
      }
      continue;
    }
    previous = alpha * value + (1 - alpha) * previous;
    out[index] = previous;
  }
  return out;
}

/** Exponential moving average, α = 2 / (period + 1). */
export function ema(values: Input, period: number): Series {
  return smoothed(values, period, 2 / (period + 1));
}

/** Wilder's moving average (RSI, ATR, ADX), α = 1 / period. */
export function rma(values: Input, period: number): Series {
  return smoothed(values, period, 1 / period);
}

/** Weighted moving average: the newest value weighs `period`, the oldest 1. */
export function wma(values: Input, period: number): Series {
  const out = blank(values.length);
  const runs = runLengths(values);
  const denominator = (period * (period + 1)) / 2;
  for (let index = period - 1; index < values.length; index += 1) {
    if ((runs[index] ?? 0) < period) continue;
    let sum = 0;
    for (let offset = 0; offset < period; offset += 1) {
      sum += (valueAt(values, index - offset) ?? 0) * (period - offset);
    }
    out[index] = sum / denominator;
  }
  return out;
}

/** Population standard deviation over the window (Pine's `ta.stdev`). */
export function stdev(values: Input, period: number): Series {
  const out = blank(values.length);
  const runs = runLengths(values);
  for (let index = period - 1; index < values.length; index += 1) {
    if ((runs[index] ?? 0) < period) continue;
    let mean = 0;
    for (let offset = 0; offset < period; offset += 1) mean += valueAt(values, index - offset) ?? 0;
    mean /= period;
    let squares = 0;
    for (let offset = 0; offset < period; offset += 1) squares += ((valueAt(values, index - offset) ?? 0) - mean) ** 2;
    out[index] = Math.sqrt(squares / period);
  }
  return out;
}

function extreme(values: Input, period: number, pick: (a: number, b: number) => number): Series {
  const out = blank(values.length);
  const runs = runLengths(values);
  for (let index = period - 1; index < values.length; index += 1) {
    if ((runs[index] ?? 0) < period) continue;
    let result = valueAt(values, index) ?? 0;
    for (let offset = 1; offset < period; offset += 1) result = pick(result, valueAt(values, index - offset) ?? 0);
    out[index] = result;
  }
  return out;
}

/** Highest value over the window, including the current one. */
export function highest(values: Input, period: number): Series {
  return extreme(values, period, Math.max);
}

/** Lowest value over the window, including the current one. */
export function lowest(values: Input, period: number): Series {
  return extreme(values, period, Math.min);
}

/** `a − b` where both exist. */
export function subtract(a: Series, b: Series): Series {
  return a.map((value, index) => {
    const other = b[index];
    return value === null || other === null || other === undefined ? null : value - other;
  });
}

/** True range; the first bar's is its high − low (Pine's `ta.tr(true)`). */
export function trueRange(bars: readonly Bar[]): number[] {
  return bars.map((bar, index) => {
    const previous = bars[index - 1];
    if (previous === undefined) return bar.high - bar.low;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close));
  });
}
