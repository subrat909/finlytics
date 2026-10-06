/**
 * Historical paper candles (phase 1 plan "Candles": the paper source). Deterministic for a seed: the same request
 * always returns the same bars, so a range stored once never disagrees with a later read.
 *
 * Intraday bars exist where they overlap the exchange's regular session on an IST weekday; daily bars on IST weekdays.
 */
import type { Candle, CandleQuery } from "@finlytics/broker-sdk";
import { CANDLE_TIMEFRAME_MS } from "@finlytics/shared";
import type { CandleTimeframe } from "@finlytics/shared";

import { alignToBar, isIstWeekday, sessionBounds } from "../market-hours";

import { anchorPrice, exchangeOf, hashString, mulberry32, toPaperPrice } from "./price-model";

/** At most this many bars per call, whatever the range (the api asks for at most 5000). */
const MAX_BARS = 20_000;

function barExists(exchange: ReturnType<typeof exchangeOf>, start: number, barMs: number): boolean {
  if (!isIstWeekday(start)) return false;
  if (barMs >= 86_400_000) return true;
  const { open, close } = sessionBounds(exchange, start);
  return start + barMs > open && start < close;
}

/** Paper bars for `[from, to)` in ascending order. */
export function paperCandles(query: CandleQuery & { readonly timeframe: CandleTimeframe }, seed: number): Candle[] {
  const barMs = CANDLE_TIMEFRAME_MS[query.timeframe];
  const exchange = exchangeOf(query.instrumentKey);
  const candles: Candle[] = [];
  const end = query.to.getTime();
  let start = alignToBar(query.from.getTime(), barMs);
  if (start < query.from.getTime()) start += barMs;
  for (; start < end && candles.length < MAX_BARS; start += barMs) {
    if (!barExists(exchange, start, barMs)) continue;
    const random = mulberry32(hashString(`${String(seed)}:${query.instrumentKey}:${query.timeframe}:${String(start)}`));
    const open = anchorPrice(query.instrumentKey, seed, start);
    const close = anchorPrice(query.instrumentKey, seed, start + barMs);
    const high = Math.max(open, close) * (1 + random() * 0.002);
    const low = Math.min(open, close) * (1 - random() * 0.002);
    const [o, c, h, l] = [toPaperPrice(open), toPaperPrice(close), toPaperPrice(high), toPaperPrice(low)];
    candles.push({
      ts: start,
      open: o,
      close: c,
      // Rounding can move open or close past a wick by a tick: widen the wick instead.
      high: [o, c, h].reduce((max, price) => (Number(price) > Number(max) ? price : max)),
      low: [o, c, l].reduce((min, price) => (Number(price) < Number(min) ? price : min)),
      volume: 1_000 + Math.floor(random() * 100_000),
    });
  }
  return candles;
}
