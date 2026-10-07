/**
 * Candle maths for the live chart: wire bars in chart units, sessions, interval buckets, resampling and the live bar.
 * Times are IST-shifted epoch seconds (see ./time), so a day bar starts at a multiple of 86,400.
 */
import type { CandleBar } from "@finlytics/shared";

import { INTERVALS, isResampled } from "../schemas";
import type { ChartInterval } from "../schemas";

import { DAY_S, IST_OFFSET_S, dayStart, toChartTime, weekStart } from "./time";

export { IST_OFFSET_S };

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
    time: toChartTime(candle.ts),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.volume,
  };
}

/** Ascending by time, one bar per time (the later one in the input wins). */
export function normalizeBars(bars: readonly Bar[]): Bar[] {
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const result: Bar[] = [];
  for (const bar of sorted) {
    const last = result.at(-1);
    if (last !== undefined && last.time === bar.time) result[result.length - 1] = bar;
    else result.push(bar);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessions

/** A regular session as seconds after IST midnight: `[open, close)`. */
export interface Session {
  open: number;
  close: number;
}

const EQUITY_SESSION: Session = { open: (9 * 60 + 15) * 60, close: (15 * 60 + 30) * 60 };
const SESSIONS: Readonly<Record<string, Session>> = {
  NSE: EQUITY_SESSION,
  BSE: EQUITY_SESSION,
  NFO: EQUITY_SESSION,
  BFO: EQUITY_SESSION,
  MCX: { open: 9 * 3_600, close: (23 * 60 + 30) * 60 },
  CDS: { open: 9 * 3_600, close: 17 * 3_600 },
};

/** The exchange of a canonical key: `NSE_EQ|RELIANCE` → `NSE`, `MCX_FO|…` → `MCX`, `NSE_CD|…` → `CDS`. */
export function exchangeOfKey(key: string): string {
  const token = key.split("|")[0] ?? "";
  if (token.endsWith("_CD")) return "CDS";
  return token.split("_")[0] ?? "NSE";
}

export function sessionOf(exchange: string): Session {
  return SESSIONS[exchange] ?? EQUITY_SESSION;
}

/** Moves a time outside the day's session to its nearest edge (pre-open → the open, post-close → the last second). */
export function clampToSession(time: number, session: Session): number {
  const day = dayStart(time);
  if (time - day < session.open) return day + session.open;
  if (time - day >= session.close) return day + session.close - 1;
  return time;
}

// ---------------------------------------------------------------------------------------------------------------------
// Buckets and resampling

function aggregate(time: number, bars: readonly Bar[]): Bar {
  const first = bars[0];
  const last = bars.at(-1);
  if (first === undefined || last === undefined) throw new RangeError("aggregate() needs at least one bar");
  let high = first.high;
  let low = first.low;
  let volume = 0;
  for (const bar of bars) {
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    volume += bar.volume;
  }
  return { time, open: first.open, high, low, close: last.close, volume };
}

/**
 * The start of the bar of `interval` that contains `time`. Days start at IST midnight, weeks on Monday. Intraday bars
 * start at `phase + n × length`: resampled intervals use the session open as their phase (NSE 30m bars at :15 and :45,
 * 4H bars at 09:15 and 13:15); the api's own timeframes keep whatever phase their bars have (pass the last bar's time).
 */
export function bucketStart(time: number, interval: ChartInterval, phase = 0): number {
  if (interval === "D1") return dayStart(time);
  if (interval === "W1") return weekStart(time);
  const length = INTERVALS[interval].seconds;
  const offset = ((phase % length) + length) % length;
  return Math.floor((time - offset) / length) * length + offset;
}

/** The phase resampled intraday bars use: the session's open. */
export function sessionPhase(interval: ChartInterval, session: Session): number {
  return session.open % INTERVALS[interval].seconds;
}

/**
 * Bars of the api's timeframe for `interval` (`INTERVALS[interval].source`) as bars of `interval`. Bars of an interval
 * the api serves are returned as they are. Intraday source bars outside the session (an hourly bar stamped 09:00) are
 * counted in the session's first bucket.
 */
export function resample(source: readonly Bar[], interval: ChartInterval, session: Session): Bar[] {
  if (!isResampled(interval)) return [...source];
  const intraday = INTERVALS[interval].intraday;
  const phase = intraday ? sessionPhase(interval, session) : 0;
  const result: Bar[] = [];
  let bucket: number | undefined;
  let members: Bar[] = [];
  for (const bar of source) {
    const time = intraday ? clampToSession(bar.time, session) : bar.time;
    const start = bucketStart(time, interval, phase);
    if (bucket !== undefined && start !== bucket) {
      result.push(aggregate(bucket, members));
      members = [];
    }
    bucket = start;
    members.push(bar);
  }
  if (bucket !== undefined && members.length > 0) result.push(aggregate(bucket, members));
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// The live bar

/** One tick as the chart reads it. Day fields come from the exchange and are null until the feed has them. */
export interface LiveTick {
  price: number;
  /** Chart time (IST-shifted seconds). */
  time: number;
  /** Quantity traded since the previous tick (ticks carry the day's cumulative volume). */
  volumeDelta: number;
  dayVolume: number | null;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
}

export interface LiveContext {
  interval: ChartInterval;
  session: Session;
  /** Daily source bars (D1 and W1 charts): the completed days a weekly bar starts from. */
  dailySource?: readonly Bar[] | undefined;
  /** Today's bar as previous ticks built it (D1 and W1 charts). */
  liveDay?: Bar | undefined;
}

export interface LiveUpdate {
  bar: Bar;
  /** True when `bar` replaces the last bar, false when it is appended. */
  replace: boolean;
  /** Today's bar after this tick (D1 and W1 charts), to pass back as `liveDay` next time. */
  liveDay?: Bar | undefined;
}

/** Today's bar from a tick: the exchange's day open/high/low/volume when known, else what the ticks have shown. */
export function dayBarFromTick(previous: Bar | undefined, tick: LiveTick): Bar {
  const today = dayStart(tick.time);
  const same = previous !== undefined && previous.time === today ? previous : undefined;
  const open = tick.dayOpen ?? same?.open ?? tick.price;
  const high = Math.max(tick.dayHigh ?? tick.price, tick.price, same?.high ?? tick.price);
  const low = Math.min(tick.dayLow ?? tick.price, tick.price, same?.low ?? tick.price);
  const volume = tick.dayVolume ?? (same?.volume ?? 0) + tick.volumeDelta;
  return { time: today, open, high, low, close: tick.price, volume };
}

/**
 * Merges a tick into the chart's bars. Intraday: a tick inside the last bar's bucket updates it, a later one opens the
 * bucket it falls in, an older one is ignored (null); ticks outside the session count at its edge. Daily and weekly:
 * the last bar becomes the completed days of its bucket plus today's bar from the tick.
 */
export function mergeTick(bars: readonly Bar[], tick: LiveTick, context: LiveContext): LiveUpdate | null {
  const last = bars.at(-1);
  const { interval, session } = context;

  if (interval === "D1" || interval === "W1") {
    const day = dayBarFromTick(context.liveDay, tick);
    const bucket = bucketStart(day.time, interval);
    if (last !== undefined && bucket < last.time) return null;
    const completed = (context.dailySource ?? []).filter((bar) => bar.time >= bucket && bar.time < day.time);
    const bar = completed.length === 0 ? { ...day, time: bucket } : aggregate(bucket, [...completed, day]);
    return { bar, replace: last !== undefined && last.time === bucket, liveDay: day };
  }

  const time = clampToSession(tick.time, session);
  const length = INTERVALS[interval].seconds;
  const phase = isResampled(interval) ? sessionPhase(interval, session) : last === undefined ? 0 : last.time % length;
  const bucket = bucketStart(time, interval, phase);
  if (last === undefined || bucket > last.time) {
    const bar = {
      time: bucket,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tick.volumeDelta,
    };
    return { bar, replace: false };
  }
  if (bucket < last.time) return null;
  return {
    bar: {
      ...last,
      high: Math.max(last.high, tick.price),
      low: Math.min(last.low, tick.price),
      close: tick.price,
      volume: last.volume + tick.volumeDelta,
    },
    replace: true,
  };
}

/** `[from, to)` real epoch seconds of `days` calendar days ending at `toSeconds`. */
export function lookbackWindow(days: number, toSeconds: number): { from: number; to: number } {
  return { from: toSeconds - days * DAY_S, to: toSeconds };
}
