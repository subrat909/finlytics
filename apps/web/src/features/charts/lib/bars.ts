/**
 * Candle maths for the live chart. Times are epoch seconds shifted to IST (+5:30), so the chart's axis reads in market
 * time whatever the device's zone (Lightweight Charts draws UTC).
 */
import type { CandleBar } from "@finlytics/shared";

import type { Tick } from "@/features/realtime/schemas";

export const IST_OFFSET_S = 19_800;

export interface Bar {
  /** Epoch seconds, IST-shifted. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A wire bar (`ts` epoch ms, decimal strings) in chart units. */
export function toBar(candle: CandleBar): Bar {
  return {
    time: Math.floor(candle.ts / 1_000) + IST_OFFSET_S,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.volume,
  };
}

/**
 * The last bar after a tick. Bars keep the server's phase (an H1 bar that starts at 09:15 stays at :15): a tick inside
 * the last bar's period updates it, a later one opens bar `last.time + n × period`. A tick older than the last bar is
 * ignored. `volumeDelta` is the traded quantity since the previous tick (ticks carry the day's cumulative volume).
 */
export function nextBar(last: Bar | undefined, price: number, tickTime: number, period: number, volumeDelta = 0): Bar {
  if (last === undefined) {
    const time = Math.floor(tickTime / period) * period;
    return { time, open: price, high: price, low: price, close: price, volume: volumeDelta };
  }
  if (tickTime < last.time) return last;
  const steps = Math.floor((tickTime - last.time) / period);
  if (steps === 0) {
    return {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
      volume: last.volume + volumeDelta,
    };
  }
  return { time: last.time + steps * period, open: price, high: price, low: price, close: price, volume: volumeDelta };
}

/** A tick's time in the chart's (IST-shifted) seconds. */
export function tickTime(tick: Pick<Tick, "ts">): number {
  return Math.floor(tick.ts / 1_000) + IST_OFFSET_S;
}

/** `[from, to]` in epoch seconds for a timeframe's lookback, ending now. */
export function candleRange(lookbackDays: number, nowMs: number): { from: number; to: number } {
  const to = Math.floor(nowMs / 1_000);
  return { from: to - lookbackDays * 86_400, to };
}
