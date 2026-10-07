/**
 * The indicator catalogue: what the Indicators dialog lists, the inputs each one takes, the lines it plots (coloured
 * by design token, never a hex value) and the pure function that computes them. An `IndicatorInstance` is one copy on
 * the chart with its own inputs and styles; it is what the layout persists.
 */
import { z } from "zod";

import type { Bar } from "../bars";

import { PRICE_SOURCES, ema, sma, source, wma } from "./core";
import type { PriceSource, Series } from "./core";
import { adx, atr, macd, obv, rsi, stochastic } from "./oscillators";
import { bollinger, donchian, parabolicSar, supertrend, vwap } from "./overlays";

/** Colours an indicator or drawing may use: design tokens, resolved from CSS at draw time (so themes switch). */
export const COLOR_TOKENS = Object.freeze([
  "primary",
  "highlight",
  "info",
  "violet",
  "orange",
  "warning",
  "profit",
  "loss",
  "fg-muted",
  "fg",
] as const);
export const ColorTokenSchema = z.enum(COLOR_TOKENS);
export type ColorToken = z.infer<typeof ColorTokenSchema>;

export const COLOR_TOKEN_LABELS: Readonly<Record<ColorToken, string>> = Object.freeze({
  primary: "Indigo",
  highlight: "Cyan",
  info: "Sky",
  violet: "Violet",
  orange: "Orange",
  warning: "Amber",
  profit: "Green",
  loss: "Rose",
  "fg-muted": "Grey",
  fg: "Contrast",
});

export const INDICATOR_KINDS = Object.freeze([
  "sma",
  "ema",
  "wma",
  "vwap",
  "bb",
  "supertrend",
  "donchian",
  "psar",
  "volume",
  "rsi",
  "macd",
  "stoch",
  "atr",
  "adx",
  "obv",
] as const);
export const IndicatorKindSchema = z.enum(INDICATOR_KINDS);
export type IndicatorKind = z.infer<typeof IndicatorKindSchema>;

export interface NumberInputSpec {
  kind: "number";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}
export interface SourceInputSpec {
  kind: "source";
  key: string;
  label: string;
  default: PriceSource;
}
export interface BooleanInputSpec {
  kind: "boolean";
  key: string;
  label: string;
  default: boolean;
}
export type InputSpec = NumberInputSpec | SourceInputSpec | BooleanInputSpec;
export type InputValue = number | string | boolean;
export type InputValues = Readonly<Record<string, InputValue>>;

export type PlotStyle = "line" | "histogram" | "dots";

export interface PlotSpec {
  key: string;
  label: string;
  style: PlotStyle;
  color: ColorToken;
  /** Per-point colours: profit/loss by the bar's direction (volume) or by the value's sign (MACD histogram). */
  colorBy?: "direction" | "sign" | undefined;
  width?: 1 | 2 | undefined;
}

export type IndicatorGroup = "overlay" | "oscillator";

export interface IndicatorDefinition {
  kind: IndicatorKind;
  name: string;
  short: string;
  group: IndicatorGroup;
  category: string;
  description: string;
  inputs: readonly InputSpec[];
  plots: readonly PlotSpec[];
  /** Horizontal reference levels in the pane (RSI 70/30). */
  levels?: readonly number[] | undefined;
  /** Axis and legend format: the instrument's price precision, two decimals, or volume units. */
  format: "price" | "decimal" | "volume";
  compute: (bars: readonly Bar[], inputs: InputValues) => Readonly<Record<string, Series>>;
}

function num(inputs: InputValues, key: string, fallback: number): number {
  const value = inputs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function src(inputs: InputValues): PriceSource {
  const value = inputs["source"];
  return typeof value === "string" && (PRICE_SOURCES as readonly string[]).includes(value)
    ? (value as PriceSource)
    : "close";
}

const LENGTH = (fallback: number, max = 500): NumberInputSpec => ({
  kind: "number",
  key: "length",
  label: "Length",
  min: 1,
  max,
  step: 1,
  default: fallback,
});
const SOURCE: SourceInputSpec = { kind: "source", key: "source", label: "Source", default: "close" };

export const INDICATORS: Readonly<Record<IndicatorKind, IndicatorDefinition>> = Object.freeze({
  sma: {
    kind: "sma",
    name: "Simple Moving Average",
    short: "SMA",
    group: "overlay",
    category: "Moving averages",
    description: "The average price of the last N bars.",
    inputs: [LENGTH(20), SOURCE],
    plots: [{ key: "value", label: "SMA", style: "line", color: "warning" }],
    format: "price",
    compute: (bars, inputs) => ({ value: sma(source(bars, src(inputs)), num(inputs, "length", 20)) }),
  },
  ema: {
    kind: "ema",
    name: "Exponential Moving Average",
    short: "EMA",
    group: "overlay",
    category: "Moving averages",
    description: "A moving average that weighs recent bars more.",
    inputs: [LENGTH(9), SOURCE],
    plots: [{ key: "value", label: "EMA", style: "line", color: "info" }],
    format: "price",
    compute: (bars, inputs) => ({ value: ema(source(bars, src(inputs)), num(inputs, "length", 9)) }),
  },
  wma: {
    kind: "wma",
    name: "Weighted Moving Average",
    short: "WMA",
    group: "overlay",
    category: "Moving averages",
    description: "A moving average with linearly rising weights.",
    inputs: [LENGTH(9), SOURCE],
    plots: [{ key: "value", label: "WMA", style: "line", color: "violet" }],
    format: "price",
    compute: (bars, inputs) => ({ value: wma(source(bars, src(inputs)), num(inputs, "length", 9)) }),
  },
  vwap: {
    kind: "vwap",
    name: "VWAP",
    short: "VWAP",
    group: "overlay",
    category: "Volume",
    description: "Volume-weighted average price, restarting every session (IST). Indices have no volume.",
    inputs: [],
    plots: [{ key: "value", label: "VWAP", style: "line", color: "primary", width: 2 }],
    format: "price",
    compute: (bars) => ({ value: vwap(bars) }),
  },
  bb: {
    kind: "bb",
    name: "Bollinger Bands",
    short: "BB",
    group: "overlay",
    category: "Bands and channels",
    description: "A moving average with bands two standard deviations away.",
    inputs: [
      LENGTH(20),
      { kind: "number", key: "mult", label: "Standard deviations", min: 0.1, max: 10, step: 0.1, default: 2 },
      SOURCE,
    ],
    plots: [
      { key: "basis", label: "Basis", style: "line", color: "orange" },
      { key: "upper", label: "Upper", style: "line", color: "info" },
      { key: "lower", label: "Lower", style: "line", color: "info" },
    ],
    format: "price",
    compute: (bars, inputs) => {
      const bands = bollinger(source(bars, src(inputs)), num(inputs, "length", 20), num(inputs, "mult", 2));
      return { basis: bands.basis, upper: bands.upper, lower: bands.lower };
    },
  },
  supertrend: {
    kind: "supertrend",
    name: "SuperTrend",
    short: "SuperTrend",
    group: "overlay",
    category: "Trend",
    description: "An ATR trailing stop that flips with the trend.",
    inputs: [
      { kind: "number", key: "length", label: "ATR length", min: 1, max: 200, step: 1, default: 10 },
      { kind: "number", key: "factor", label: "Factor", min: 0.1, max: 20, step: 0.1, default: 3 },
    ],
    plots: [
      { key: "up", label: "Up trend", style: "line", color: "profit", width: 2 },
      { key: "down", label: "Down trend", style: "line", color: "loss", width: 2 },
    ],
    format: "price",
    compute: (bars, inputs) => {
      const result = supertrend(bars, num(inputs, "length", 10), num(inputs, "factor", 3));
      return { up: result.up, down: result.down };
    },
  },
  donchian: {
    kind: "donchian",
    name: "Donchian Channels",
    short: "DC",
    group: "overlay",
    category: "Bands and channels",
    description: "The highest high and lowest low of the last N bars.",
    inputs: [LENGTH(20)],
    plots: [
      { key: "upper", label: "Upper", style: "line", color: "highlight" },
      { key: "basis", label: "Basis", style: "line", color: "orange" },
      { key: "lower", label: "Lower", style: "line", color: "highlight" },
    ],
    format: "price",
    compute: (bars, inputs) => {
      const bands = donchian(bars, num(inputs, "length", 20));
      return { upper: bands.upper, basis: bands.basis, lower: bands.lower };
    },
  },
  psar: {
    kind: "psar",
    name: "Parabolic SAR",
    short: "SAR",
    group: "overlay",
    category: "Trend",
    description: "Stop-and-reverse dots that trail the trend.",
    inputs: [
      { kind: "number", key: "start", label: "Start", min: 0.001, max: 1, step: 0.001, default: 0.02 },
      { kind: "number", key: "increment", label: "Increment", min: 0.001, max: 1, step: 0.001, default: 0.02 },
      { kind: "number", key: "maximum", label: "Maximum", min: 0.01, max: 1, step: 0.01, default: 0.2 },
    ],
    plots: [{ key: "value", label: "SAR", style: "dots", color: "info" }],
    format: "price",
    compute: (bars, inputs) => ({
      value: parabolicSar(
        bars,
        num(inputs, "start", 0.02),
        num(inputs, "increment", 0.02),
        num(inputs, "maximum", 0.2),
      ),
    }),
  },
  volume: {
    kind: "volume",
    name: "Volume",
    short: "Vol",
    group: "oscillator",
    category: "Volume",
    description: "Traded quantity per bar, green on up bars and rose on down bars.",
    inputs: [{ kind: "boolean", key: "separatePane", label: "Show in its own pane", default: false }],
    plots: [{ key: "value", label: "Volume", style: "histogram", color: "fg-muted", colorBy: "direction" }],
    format: "volume",
    compute: (bars) => ({ value: bars.map((bar) => bar.volume) }),
  },
  rsi: {
    kind: "rsi",
    name: "Relative Strength Index",
    short: "RSI",
    group: "oscillator",
    category: "Momentum",
    description: "Momentum from 0 to 100; above 70 is overbought, below 30 oversold.",
    inputs: [LENGTH(14, 200), SOURCE],
    plots: [{ key: "value", label: "RSI", style: "line", color: "violet" }],
    levels: [70, 50, 30],
    format: "decimal",
    compute: (bars, inputs) => ({ value: rsi(source(bars, src(inputs)), num(inputs, "length", 14)) }),
  },
  macd: {
    kind: "macd",
    name: "MACD",
    short: "MACD",
    group: "oscillator",
    category: "Momentum",
    description: "The gap between a fast and a slow EMA, with its signal line and histogram.",
    inputs: [
      { kind: "number", key: "fast", label: "Fast length", min: 1, max: 200, step: 1, default: 12 },
      { kind: "number", key: "slow", label: "Slow length", min: 1, max: 200, step: 1, default: 26 },
      { kind: "number", key: "signal", label: "Signal length", min: 1, max: 100, step: 1, default: 9 },
      SOURCE,
    ],
    plots: [
      { key: "histogram", label: "Histogram", style: "histogram", color: "fg-muted", colorBy: "sign" },
      { key: "macd", label: "MACD", style: "line", color: "info" },
      { key: "signal", label: "Signal", style: "line", color: "orange" },
    ],
    format: "decimal",
    compute: (bars, inputs) => {
      const result = macd(
        source(bars, src(inputs)),
        num(inputs, "fast", 12),
        num(inputs, "slow", 26),
        num(inputs, "signal", 9),
      );
      return { histogram: result.histogram, macd: result.macd, signal: result.signal };
    },
  },
  stoch: {
    kind: "stoch",
    name: "Stochastic",
    short: "Stoch",
    group: "oscillator",
    category: "Momentum",
    description: "Where the close sits in the recent high–low range, from 0 to 100.",
    inputs: [
      { kind: "number", key: "length", label: "%K length", min: 1, max: 200, step: 1, default: 14 },
      { kind: "number", key: "smoothK", label: "%K smoothing", min: 1, max: 50, step: 1, default: 1 },
      { kind: "number", key: "smoothD", label: "%D smoothing", min: 1, max: 50, step: 1, default: 3 },
    ],
    plots: [
      { key: "k", label: "%K", style: "line", color: "info" },
      { key: "d", label: "%D", style: "line", color: "orange" },
    ],
    levels: [80, 20],
    format: "decimal",
    compute: (bars, inputs) => {
      const result = stochastic(bars, num(inputs, "length", 14), num(inputs, "smoothK", 1), num(inputs, "smoothD", 3));
      return { k: result.k, d: result.d };
    },
  },
  atr: {
    kind: "atr",
    name: "Average True Range",
    short: "ATR",
    group: "oscillator",
    category: "Volatility",
    description: "The average bar range including gaps (Wilder's smoothing).",
    inputs: [LENGTH(14, 200)],
    plots: [{ key: "value", label: "ATR", style: "line", color: "loss" }],
    format: "price",
    compute: (bars, inputs) => ({ value: atr(bars, num(inputs, "length", 14)) }),
  },
  adx: {
    kind: "adx",
    name: "ADX / DMI",
    short: "ADX",
    group: "oscillator",
    category: "Trend",
    description: "Trend strength (ADX) with the +DI and −DI directional lines.",
    inputs: [
      { kind: "number", key: "length", label: "DI length", min: 1, max: 200, step: 1, default: 14 },
      { kind: "number", key: "smoothing", label: "ADX smoothing", min: 1, max: 200, step: 1, default: 14 },
    ],
    plots: [
      { key: "adx", label: "ADX", style: "line", color: "warning", width: 2 },
      { key: "plus", label: "+DI", style: "line", color: "profit" },
      { key: "minus", label: "−DI", style: "line", color: "loss" },
    ],
    levels: [25],
    format: "decimal",
    compute: (bars, inputs) => {
      const result = adx(bars, num(inputs, "length", 14), num(inputs, "smoothing", 14));
      return { adx: result.adx, plus: result.plus, minus: result.minus };
    },
  },
  obv: {
    kind: "obv",
    name: "On-Balance Volume",
    short: "OBV",
    group: "oscillator",
    category: "Volume",
    description: "Running volume, added on up closes and subtracted on down closes.",
    inputs: [],
    plots: [{ key: "value", label: "OBV", style: "line", color: "highlight" }],
    format: "volume",
    compute: (bars) => ({ value: obv(bars) }),
  },
});

export const INDICATOR_LIST: readonly IndicatorDefinition[] = INDICATOR_KINDS.map((kind) => INDICATORS[kind]);

// ---------------------------------------------------------------------------------------------------------------------
// Instances

export const LINE_WIDTHS = Object.freeze([1, 2, 3, 4] as const);
export type LineWidth = (typeof LINE_WIDTHS)[number];

export interface PlotStyleValue {
  color: ColorToken;
  width: LineWidth;
}

export interface IndicatorInstance {
  id: string;
  kind: IndicatorKind;
  inputs: Record<string, InputValue>;
  styles: Record<string, PlotStyleValue>;
  hidden: boolean;
}

/** The most indicators one chart carries (each is a series or a pane). */
export const MAX_INDICATORS = 12;

/** The persisted shape, read loosely: unknown inputs are dropped and the rest sanitised by {@link sanitizeInstance}. */
export const IndicatorInstanceSchema = z.object({
  id: z.string().min(1).max(64),
  kind: IndicatorKindSchema,
  inputs: z.record(z.string(), z.union([z.number(), z.string().max(16), z.boolean()])),
  styles: z.record(z.string(), z.object({ color: ColorTokenSchema, width: z.number() })),
  hidden: z.boolean(),
});

function clampNumber(spec: NumberInputSpec, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return spec.default;
  const stepped = spec.step >= 1 ? Math.round(value) : value;
  return Math.min(spec.max, Math.max(spec.min, stepped));
}

/** Every input of the definition, valid: missing ones take the default, numbers are clamped, unknown keys dropped. */
export function sanitizeInputs(
  kind: IndicatorKind,
  inputs: Readonly<Record<string, unknown>>,
): Record<string, InputValue> {
  const result: Record<string, InputValue> = {};
  for (const spec of INDICATORS[kind].inputs) {
    const value = inputs[spec.key];
    if (spec.kind === "number") result[spec.key] = clampNumber(spec, value);
    else if (spec.kind === "boolean") result[spec.key] = typeof value === "boolean" ? value : spec.default;
    else
      result[spec.key] =
        typeof value === "string" && (PRICE_SOURCES as readonly string[]).includes(value) ? value : spec.default;
  }
  return result;
}

export function defaultStyles(kind: IndicatorKind): Record<string, PlotStyleValue> {
  return Object.fromEntries(
    INDICATORS[kind].plots.map((plot) => [plot.key, { color: plot.color, width: plot.width ?? 1 }]),
  );
}

function sanitizeStyles(kind: IndicatorKind, styles: Readonly<Record<string, { color: ColorToken; width: number }>>) {
  const defaults = defaultStyles(kind);
  for (const [key, style] of Object.entries(styles)) {
    const fallback = defaults[key];
    if (fallback === undefined) continue;
    const width = (LINE_WIDTHS as readonly number[]).includes(style.width)
      ? (style.width as LineWidth)
      : fallback.width;
    defaults[key] = { color: style.color, width };
  }
  return defaults;
}

let sequence = 0;

/** A fresh id (event handlers only: not deterministic). */
export function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createInstance(kind: IndicatorKind, id = newId(kind)): IndicatorInstance {
  return { id, kind, inputs: sanitizeInputs(kind, {}), styles: defaultStyles(kind), hidden: false };
}

/** A persisted instance, made valid against the current catalogue (or undefined if it can't be). */
export function sanitizeInstance(value: unknown): IndicatorInstance | undefined {
  const parsed = IndicatorInstanceSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { id, kind, inputs, styles, hidden } = parsed.data;
  return { id, kind, inputs: sanitizeInputs(kind, inputs), styles: sanitizeStyles(kind, styles), hidden };
}

/** Where an instance draws: on the price pane, at the bottom of the price pane (volume), or in its own pane. */
export function placementOf(instance: Pick<IndicatorInstance, "kind" | "inputs">): "overlay" | "volume" | "pane" {
  if (instance.kind === "volume") return instance.inputs["separatePane"] === true ? "pane" : "volume";
  return INDICATORS[instance.kind].group === "overlay" ? "overlay" : "pane";
}

/** The legend's parameter text: `20 close`, `12 26 9 close`. */
export function describeInputs(instance: Pick<IndicatorInstance, "kind" | "inputs">): string {
  return INDICATORS[instance.kind].inputs
    .filter((spec) => spec.kind !== "boolean")
    .map((spec) => String(instance.inputs[spec.key] ?? spec.default))
    .join(" ");
}
