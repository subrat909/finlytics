import type { Bar } from "./bars";

/**
 * One Heikin Ashi bar from the raw bar and the previous Heikin Ashi bar: close is the bar's average price, open the
 * midpoint of the previous HA body (the raw open and close's midpoint for the first bar), and the wicks reach the raw
 * extremes or the HA body, whichever is further.
 */
export function heikinAshiBar(bar: Bar, previous: Bar | undefined): Bar {
  const close = (bar.open + bar.high + bar.low + bar.close) / 4;
  const open = previous === undefined ? (bar.open + bar.close) / 2 : (previous.open + previous.close) / 2;
  return {
    time: bar.time,
    open,
    high: Math.max(bar.high, open, close),
    low: Math.min(bar.low, open, close),
    close,
    volume: bar.volume,
  };
}

/** A whole series as Heikin Ashi bars. */
export function heikinAshi(bars: readonly Bar[]): Bar[] {
  const result: Bar[] = [];
  for (const bar of bars) result.push(heikinAshiBar(bar, result.at(-1)));
  return result;
}
