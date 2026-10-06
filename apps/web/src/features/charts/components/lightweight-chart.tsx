"use client";

import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart } from "lightweight-charts";
import type { DeepPartial, ChartOptions, IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

import { useMarketStore } from "@/features/realtime/store";

import { nextBar, tickTime } from "../lib/bars";
import type { Bar } from "../lib/bars";
import { readChartColors } from "../lib/theme-colors";
import type { ChartColors } from "../lib/theme-colors";

export interface LightweightChartProps {
  bars: readonly Bar[];
  instrumentKey: string;
  /** Seconds per bar. */
  period: number;
  /** Read by screen readers instead of the canvas (docs/05: chart alt summary). */
  summary: string;
}

interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
}

function chartOptions(colors: ChartColors, fontFamily: string): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: colors.text,
      fontFamily,
      // The built-in logo injects an unnonced <style> (blocked by the CSP); the attribution is a link below instead.
      attributionLogo: false,
    },
    grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
    rightPriceScale: { borderColor: colors.border },
    timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: colors.crosshair, labelBackgroundColor: colors.crosshair },
      horzLine: { color: colors.crosshair, labelBackgroundColor: colors.crosshair },
    },
  };
}

function seriesColors(colors: ChartColors) {
  return {
    upColor: colors.up,
    downColor: colors.down,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
    borderVisible: false,
  };
}

function volumePoint(bar: Bar, colors: ChartColors) {
  return {
    time: bar.time as UTCTimestamp,
    value: bar.volume,
    color: bar.close >= bar.open ? colors.upVolume : colors.downVolume,
  };
}

function candlePoint(bar: Bar) {
  return { time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
}

/**
 * Lightweight Charts v5 (Apache-2.0, attributed with a link to TradingView): candles plus volume, coloured from the design tokens (re-read when `data-theme` changes), the
 * last bar driven by live ticks straight from the market store (no React render per tick). Loaded with `next/dynamic`
 * (`ssr: false`); `chart.remove()` on unmount frees the canvases and listeners.
 */
export default function LightweightChart({ bars, instrumentKey, period, summary }: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const colorsRef = useRef<ChartColors | null>(null);

  // The chart: created once per mount, themed from the tokens, removed on unmount.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const colors = readChartColors(element);
    colorsRef.current = colors;
    const chart = createChart(element, {
      autoSize: true,
      ...chartOptions(colors, getComputedStyle(element).fontFamily),
    });
    const candles = chart.addSeries(CandlestickSeries, seriesColors(colors));
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
    handlesRef.current = { chart, candles, volume };

    const retheme = () => {
      const next = readChartColors(element);
      colorsRef.current = next;
      chart.applyOptions(chartOptions(next, getComputedStyle(element).fontFamily));
      candles.applyOptions(seriesColors(next));
    };
    const observer = new MutationObserver(retheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      handlesRef.current = null;
      chart.remove();
    };
  }, []);

  // History, then live ticks on the last bar: subscribed to the store directly, so a tick never re-renders React.
  useEffect(() => {
    const handles = handlesRef.current;
    const colors = colorsRef.current;
    if (handles === null || colors === null) return;
    handles.candles.setData(bars.map(candlePoint));
    handles.volume.setData(bars.map((bar) => volumePoint(bar, colors)));
    handles.chart.timeScale().scrollToRealTime();

    let last = bars.at(-1);
    let lastVolume: number | null = null;
    return useMarketStore.subscribe((state, previous) => {
      const tick = state.ticks.get(instrumentKey);
      if (tick === undefined || tick === previous.ticks.get(instrumentKey)) return;
      const delta = tick.vol !== null && lastVolume !== null ? Math.max(0, tick.vol - lastVolume) : 0;
      lastVolume = tick.vol;
      const bar = nextBar(last, tick.ltp, tickTime(tick), period, delta);
      if (bar === last) return;
      last = bar;
      const current = handlesRef.current;
      const palette = colorsRef.current;
      if (current === null || palette === null) return;
      current.candles.update(candlePoint(bar));
      current.volume.update(volumePoint(bar, palette));
    });
  }, [bars, instrumentKey, period]);

  return (
    <div className="flex h-full w-full flex-col" data-slot="lightweight-chart">
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} role="img" aria-label={summary} className="absolute inset-0" />
      </div>
      <p className="px-3 pb-2 text-right text-xs text-fg-muted">
        Charts by{" "}
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm font-medium text-highlight underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          TradingView
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}
