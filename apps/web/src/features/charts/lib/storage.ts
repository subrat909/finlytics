/**
 * The chart's local persistence (versioned JSON in localStorage, every access in try/catch): the workspace layout per
 * signed-in user, and drawings per instrument. Storage can be full, disabled (private mode) or hold data from an
 * older version; any of those reads as "nothing saved", never as an error.
 */
import { z } from "zod";

import {
  ChartIntervalSchema,
  ChartSettingsSchema,
  ChartTypeSchema,
  DEFAULT_INTERVAL,
  DEFAULT_SETTINGS,
  ScaleModeSchema,
} from "../schemas";
import type { ChartInterval, ChartSettings, ChartType, ScaleMode } from "../schemas";

import { DrawingSchema } from "./drawings/types";
import type { Drawing } from "./drawings/types";
import { MAX_INDICATORS, createInstance, sanitizeInstance } from "./indicators/registry";
import type { IndicatorInstance } from "./indicators/registry";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or undefined where it isn't available (server, disabled storage). */
export function browserStorage(): KeyValueStore | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function read(storage: KeyValueStore | undefined, key: string): unknown {
  if (storage === undefined) return undefined;
  try {
    const text = storage.getItem(key);
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function write(storage: KeyValueStore | undefined, key: string, value: unknown): void {
  if (storage === undefined) return;
  try {
    if (value === undefined) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or disabled storage: the chart still works, it just won't remember.
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Drawings, per instrument

const DRAWINGS_VERSION = 1;
const DRAWINGS_PREFIX = "finlytics.chart.drawings:";
/** The most drawings one instrument keeps. */
export const MAX_DRAWINGS = 500;

export function drawingsKey(instrumentKey: string): string {
  return `${DRAWINGS_PREFIX}${instrumentKey}`;
}

const DrawingsFileSchema = z.object({ v: z.literal(DRAWINGS_VERSION), drawings: z.array(z.unknown()) });

/** The saved drawings of an instrument; invalid entries are skipped, another version reads as none. */
export function loadDrawings(instrumentKey: string, storage = browserStorage()): Drawing[] {
  const file = DrawingsFileSchema.safeParse(read(storage, drawingsKey(instrumentKey)));
  if (!file.success) return [];
  return file.data.drawings
    .flatMap((entry) => {
      const drawing = DrawingSchema.safeParse(entry);
      return drawing.success ? [drawing.data] : [];
    })
    .slice(-MAX_DRAWINGS);
}

/** Saves an instrument's drawings (an empty list removes the entry). */
export function saveDrawings(instrumentKey: string, drawings: readonly Drawing[], storage = browserStorage()): void {
  write(
    storage,
    drawingsKey(instrumentKey),
    drawings.length === 0 ? undefined : { v: DRAWINGS_VERSION, drawings: drawings.slice(-MAX_DRAWINGS) },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The workspace layout, per user

const LAYOUT_VERSION = 1;
const LAYOUT_PREFIX = "finlytics.chart.layout:";

export interface ChartLayout {
  interval: ChartInterval;
  chartType: ChartType;
  indicators: IndicatorInstance[];
  scaleMode: ScaleMode;
  autoScale: boolean;
  settings: ChartSettings;
  /** The right panel (quote and watchlist) on wide screens. */
  panelOpen: boolean;
}

export function defaultLayout(): ChartLayout {
  return {
    interval: DEFAULT_INTERVAL,
    chartType: "candles",
    indicators: [createInstance("volume", "volume-default")],
    scaleMode: "normal",
    autoScale: true,
    settings: { ...DEFAULT_SETTINGS },
    panelOpen: true,
  };
}

export function layoutKey(userId: string | undefined): string {
  return `${LAYOUT_PREFIX}${userId ?? "default"}`;
}

const LayoutFileSchema = z.object({
  v: z.literal(LAYOUT_VERSION),
  interval: ChartIntervalSchema.catch(DEFAULT_INTERVAL),
  chartType: ChartTypeSchema.catch("candles"),
  indicators: z.array(z.unknown()).catch([]),
  scaleMode: ScaleModeSchema.catch("normal"),
  autoScale: z.boolean().catch(true),
  settings: z.record(z.string(), z.unknown()).catch({}),
  panelOpen: z.boolean().catch(true),
});

/** The saved layout, field by field: an invalid field takes its default, another version reads as the default. */
export function loadLayout(userId: string | undefined, storage = browserStorage()): ChartLayout {
  const file = LayoutFileSchema.safeParse(read(storage, layoutKey(userId)));
  if (!file.success) return defaultLayout();
  const { interval, chartType, indicators, scaleMode, autoScale, settings, panelOpen } = file.data;
  const ids = new Set<string>();
  const instances = indicators.flatMap((entry) => {
    const instance = sanitizeInstance(entry);
    if (instance === undefined || ids.has(instance.id)) return [];
    ids.add(instance.id);
    return [instance];
  });
  const savedSettings = ChartSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...settings });
  return {
    interval,
    chartType,
    indicators: instances.slice(0, MAX_INDICATORS),
    scaleMode,
    autoScale,
    settings: savedSettings.success ? savedSettings.data : { ...DEFAULT_SETTINGS },
    panelOpen,
  };
}

export function saveLayout(userId: string | undefined, layout: ChartLayout, storage = browserStorage()): void {
  write(storage, layoutKey(userId), { v: LAYOUT_VERSION, ...layout });
}
