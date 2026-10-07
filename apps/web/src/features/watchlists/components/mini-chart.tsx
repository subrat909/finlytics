"use client";

import { BaselineSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { ChartOptions, DeepPartial, IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

import { useMarketStore } from "@/features/realtime/store";

import { istDay, tickBucket } from "../lib/intraday";
import type { IntradayPoint } from "../lib/intraday";

interface Colors {
  text: string;
  grid: string;
  up: string;
  down: string;
  muted: string;
}

function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** `#rrggbb` + alpha → `rgba()`; anything else is returned as is (tokens are 6-digit hex). */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return color;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? "0", 16));
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

/** Canvas charts can't use classes: the token values come from the element's computed style (themed islands too). */
function readColors(element: Element): Colors {
  const style = getComputedStyle(element);
  return {
    text: token(style, "--fg-muted"),
    grid: token(style, "--surface-2"),
    up: token(style, "--profit"),
    down: token(style, "--loss"),
    muted: token(style, "--fg-muted"),
  };
}

function chartOptions(colors: Colors, fontFamily: string): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: colors.text,
      fontFamily,
      fontSize: 11,
      // The logo injects an unnonced <style> (blocked by the CSP); the attribution is a link below instead.
      attributionLogo: false,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: colors.muted, labelBackgroundColor: colors.muted },
      horzLine: { color: colors.muted, labelBackgroundColor: colors.muted },
    },
    handleScroll: false,
    handleScale: false,
  };
}

function seriesOptions(colors: Colors) {
  return {
    topLineColor: colors.up,
    topFillColor1: withAlpha(colors.up, 0.28),
    topFillColor2: withAlpha(colors.up, 0.04),
    bottomLineColor: colors.down,
    bottomFillColor1: withAlpha(colors.down, 0.04),
    bottomFillColor2: withAlpha(colors.down, 0.28),
    lineWidth: 2 as const,
  };
}

interface Handles {
  chart: IChartApi;
  series: ISeriesApi<"Baseline">;
  baseline: IPriceLine;
}

export interface MiniChartProps {
  instrumentKey: string;
  /** One session's 5-minute closes, ascending. */
  points: readonly IntradayPoint[];
  /** The previous close: above it the line is profit-coloured, below it loss-coloured. */
  baseline: number;
  /** Read by screen readers instead of the canvas. */
  summary: string;
}

/**
 * The watchlist's intraday chart (Lightweight Charts v5, Apache-2.0, attributed with a link to TradingView): a baseline
 * series around the previous close, coloured from the design tokens (re-read when `data-theme` changes), the last
 * point moved by live ticks straight from the store (no React render per tick). Loaded with `next/dynamic`
 * (`ssr: false`); `chart.remove()` on unmount frees the canvases and listeners.
 */
export default function MiniChart({ instrumentKey, points, baseline, summary }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<Handles | null>(null);
  const baselineRef = useRef(baseline);

  // The chart: created once per mount, removed on unmount.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const font = getComputedStyle(element).fontFamily;
    const colors = readColors(element);
    const chart = createChart(element, { autoSize: true, ...chartOptions(colors, font) });
    const series = chart.addSeries(BaselineSeries, {
      ...seriesOptions(colors),
      baseValue: { type: "price", price: baselineRef.current },
      priceLineVisible: false,
    });
    const line = series.createPriceLine({
      price: baselineRef.current,
      color: colors.muted,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: "Prev close",
    });
    handlesRef.current = { chart, series, baseline: line };

    const retheme = () => {
      const next = readColors(element);
      chart.applyOptions(chartOptions(next, getComputedStyle(element).fontFamily));
      series.applyOptions(seriesOptions(next));
      line.applyOptions({ color: next.muted });
    };
    const observer = new MutationObserver(retheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      handlesRef.current = null;
      chart.remove();
    };
  }, []);

  // The previous close can arrive after the chart (the first tick).
  useEffect(() => {
    baselineRef.current = baseline;
    const handles = handlesRef.current;
    if (handles === null) return;
    handles.series.applyOptions({ baseValue: { type: "price", price: baseline } });
    handles.baseline.applyOptions({ price: baseline });
  }, [baseline]);

  // The session's points, then live ticks on the last one (or the next 5-minute bucket).
  useEffect(() => {
    const handles = handlesRef.current;
    if (handles === null) return;
    handles.series.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    handles.chart.timeScale().fitContent();

    let last = points.at(-1);
    return useMarketStore.subscribe((state, previous) => {
      const tick = state.ticks.get(instrumentKey);
      if (tick === undefined || tick === previous.ticks.get(instrumentKey)) return;
      const time = tickBucket(tick.ts);
      // Only this session's line: a later day starts with the next fetch, an older tick changes nothing.
      if (last !== undefined && (time < last.time || istDay(time) !== istDay(last.time))) return;
      last = { time, value: tick.ltp };
      handlesRef.current?.series.update({ time: time as UTCTimestamp, value: tick.ltp });
    });
  }, [instrumentKey, points]);

  return (
    <div className="flex h-full w-full flex-col" data-slot="mini-chart">
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} role="img" aria-label={summary} className="absolute inset-0" />
      </div>
      <p className="pt-1 text-right text-[11px] text-fg-muted">
        Chart by{" "}
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
