/**
 * Chart time ↔ the time scale's logical index (pure). Drawings keep times, the chart draws by bar index: a time on a
 * bar maps to its index, a time between bars (a weekend gap, a point drawn at another interval) interpolates, and a
 * time before the first or after the last bar extrapolates by the bar length, so drawings reach into the future.
 */
import type { Bar } from "../bars";

export function timeToLogical(bars: readonly Bar[], period: number, time: number): number | null {
  const first = bars[0];
  const last = bars.at(-1);
  if (first === undefined || last === undefined) return null;
  if (time <= first.time) return (time - first.time) / period;
  if (time >= last.time) return bars.length - 1 + (time - last.time) / period;
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((bars[middle]?.time ?? Number.POSITIVE_INFINITY) <= time) low = middle;
    else high = middle - 1;
  }
  const before = bars[low];
  const after = bars[low + 1];
  if (before === undefined || after === undefined || before.time === time) return low;
  return low + (time - before.time) / (after.time - before.time);
}

/** The time of the bar nearest a logical index (snapped to a bar; extrapolated past either end). */
export function logicalToTime(bars: readonly Bar[], period: number, logical: number): number | null {
  const first = bars[0];
  const last = bars.at(-1);
  if (first === undefined || last === undefined || !Number.isFinite(logical)) return null;
  const index = Math.round(logical);
  if (index < 0) return first.time + index * period;
  if (index > bars.length - 1) return last.time + (index - (bars.length - 1)) * period;
  return bars[index]?.time ?? null;
}

/** The bar's open, high, low or close nearest `price` (the magnet). */
export function snapToBar(bar: Bar | undefined, price: number): number {
  if (bar === undefined) return price;
  let best = bar.close;
  for (const candidate of [bar.open, bar.high, bar.low]) {
    if (Math.abs(candidate - price) < Math.abs(best - price)) best = candidate;
  }
  return best;
}
