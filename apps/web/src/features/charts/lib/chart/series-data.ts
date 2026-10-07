/**
 * Bars and indicator values as Lightweight Charts points (pure). Missing values become whitespace points, so every
 * series shares the main series' time scale and a line breaks where its indicator has no value.
 */
import type {
  BarData,
  CandlestickData,
  HistogramData,
  LineData,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";

import type { ChartType } from "../../schemas";
import type { Bar } from "../bars";
import type { Series } from "../indicators/core";
import type { PlotSpec } from "../indicators/registry";
import type { ChartColors } from "../theme-colors";
import { withAlpha } from "../theme-colors";

type Time = UTCTimestamp;

export type MainPoint = CandlestickData<Time> | BarData<Time> | LineData<Time>;
export type PlotPoint = LineData<Time> | HistogramData<Time> | WhitespaceData<Time>;

/** Chart types drawn from OHLC (the rest draw the close as one value). */
export function isOhlcType(type: ChartType): boolean {
  return type !== "line" && type !== "area" && type !== "baseline";
}

function ohlc(bar: Bar): CandlestickData<Time> {
  return { time: bar.time as Time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
}

/**
 * Hollow candles (TradingView's): coloured by the close against the previous close, hollow when the close is at or
 * above the open.
 */
function hollow(bar: Bar, previous: Bar | undefined, colors: ChartColors): CandlestickData<Time> {
  const color = previous === undefined || bar.close >= previous.close ? colors.up : colors.down;
  return { ...ohlc(bar), color: bar.close >= bar.open ? "transparent" : color, borderColor: color, wickColor: color };
}

/** One bar as the main series' point (`displayed` is the Heikin Ashi bar for that chart type). */
export function mainPoint(type: ChartType, bar: Bar, previous: Bar | undefined, colors: ChartColors): MainPoint {
  if (type === "hollow") return hollow(bar, previous, colors);
  if (isOhlcType(type)) return ohlc(bar);
  return { time: bar.time as Time, value: bar.close };
}

export function mainPoints(type: ChartType, bars: readonly Bar[], colors: ChartColors): MainPoint[] {
  return bars.map((bar, index) => mainPoint(type, bar, bars[index - 1], colors));
}

/** The point colour of a histogram plot: by the bar's direction (volume) or the value's sign (MACD). */
function histogramColor(plot: PlotSpec, bar: Bar, value: number, colors: ChartColors, color: string): string {
  if (plot.colorBy === "direction") return bar.close >= bar.open ? colors.upVolume : colors.downVolume;
  if (plot.colorBy === "sign") return value >= 0 ? withAlpha(colors.up, 0.6) : withAlpha(colors.down, 0.6);
  return color;
}

export function plotPoint(
  plot: PlotSpec,
  bar: Bar,
  value: number | null | undefined,
  colors: ChartColors,
  color: string,
): PlotPoint {
  const time = bar.time as Time;
  if (value === null || value === undefined || !Number.isFinite(value)) return { time };
  if (plot.style === "histogram") return { time, value, color: histogramColor(plot, bar, value, colors, color) };
  return { time, value };
}

export function plotPoints(
  plot: PlotSpec,
  bars: readonly Bar[],
  values: Series | undefined,
  colors: ChartColors,
  color: string,
): PlotPoint[] {
  return bars.map((bar, index) => plotPoint(plot, bar, values?.[index], colors, color));
}

/** The baseline chart's level: the middle of the loaded closes' range. */
export function baselineLevel(bars: readonly Bar[]): number {
  if (bars.length === 0) return 0;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    if (bar.close < low) low = bar.close;
    if (bar.close > high) high = bar.close;
  }
  return (low + high) / 2;
}
