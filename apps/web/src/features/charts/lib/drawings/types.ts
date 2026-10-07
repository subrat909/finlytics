/**
 * Drawings on the price pane. A drawing is anchored in chart units (IST-shifted time and price), never pixels, so it
 * stays put while the chart scrolls, zooms, changes interval or loads older history. Style fields are optional so
 * drawings saved by earlier versions still load (their defaults come from {@link styleOf}).
 */
import { z } from "zod";

import { ColorTokenSchema } from "../indicators/registry";
import type { ColorToken } from "../indicators/registry";

export const DRAWING_KINDS = Object.freeze([
  "trend",
  "arrow",
  "ray",
  "extended",
  "hline",
  "hray",
  "vline",
  "crossline",
  "channel",
  "rect",
  "ellipse",
  "triangle",
  "fib",
  "measure",
  "daterange",
  "datepricerange",
  "text",
  "pricelabel",
] as const);
export const DrawingKindSchema = z.enum(DRAWING_KINDS);
export type DrawingKind = z.infer<typeof DrawingKindSchema>;

/** The left toolbar's tools: two pointer modes, then one tool per drawing kind. */
export type DrawingTool = "cursor" | "crosshair" | DrawingKind;

export function isDrawingKind(tool: DrawingTool): tool is DrawingKind {
  return tool !== "cursor" && tool !== "crosshair";
}

/** How many anchor points each kind takes (clicks to draw it). */
export const POINT_COUNT: Readonly<Record<DrawingKind, 1 | 2 | 3>> = Object.freeze({
  trend: 2,
  arrow: 2,
  ray: 2,
  extended: 2,
  hline: 1,
  hray: 1,
  vline: 1,
  crossline: 1,
  channel: 3,
  rect: 2,
  ellipse: 2,
  triangle: 3,
  fib: 2,
  measure: 2,
  daterange: 2,
  datepricerange: 2,
  text: 1,
  pricelabel: 1,
});

export const TOOL_LABELS: Readonly<Record<DrawingTool, string>> = Object.freeze({
  cursor: "Arrow",
  crosshair: "Cross",
  trend: "Trend line",
  arrow: "Arrow line",
  ray: "Ray",
  extended: "Extended line",
  hline: "Horizontal line",
  hray: "Horizontal ray",
  vline: "Vertical line",
  crossline: "Cross line",
  channel: "Parallel channel",
  rect: "Rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  fib: "Fib retracement",
  measure: "Price range",
  daterange: "Date range",
  datepricerange: "Date and price range",
  text: "Text",
  pricelabel: "Price label",
});

export const DEFAULT_DRAWING_COLORS: Readonly<Record<DrawingKind, ColorToken>> = Object.freeze({
  trend: "primary",
  arrow: "primary",
  ray: "primary",
  extended: "primary",
  hline: "info",
  hray: "info",
  vline: "violet",
  crossline: "violet",
  channel: "highlight",
  rect: "highlight",
  ellipse: "violet",
  triangle: "orange",
  fib: "orange",
  measure: "info",
  daterange: "info",
  datepricerange: "info",
  text: "fg",
  pricelabel: "primary",
});

/** Fibonacci retracement levels, from the second point (0) to the first (1). */
export const FIB_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const);

export const LINE_DASHES = Object.freeze(["solid", "dashed", "dotted"] as const);
export const LineDashSchema = z.enum(LINE_DASHES);
export type LineDash = z.infer<typeof LineDashSchema>;

export const DRAWING_WIDTHS = Object.freeze([1, 2, 3, 4] as const);
export const FONT_SIZES = Object.freeze([11, 12, 14, 16, 20, 24] as const);

/** Kinds with an area that can be filled. */
export const FILLABLE: ReadonlySet<DrawingKind> = new Set(["rect", "ellipse", "triangle", "channel", "fib"]);
/** Two-point lines that can extend past their points. */
export const EXTENDABLE: ReadonlySet<DrawingKind> = new Set(["trend", "arrow"]);
/** Kinds whose label (price, levels, statistics) can be hidden. */
export const LABELLED: ReadonlySet<DrawingKind> = new Set([
  "hline",
  "hray",
  "fib",
  "measure",
  "daterange",
  "datepricerange",
  "pricelabel",
]);
/** Kinds that carry text. */
export const TEXTUAL: ReadonlySet<DrawingKind> = new Set(["text", "pricelabel"]);

export const AnchorPointSchema = z.object({ time: z.number(), price: z.number() });
export type AnchorPoint = z.infer<typeof AnchorPointSchema>;

/** The most characters a text note keeps. */
export const MAX_NOTE_LENGTH = 200;

export const DrawingSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: DrawingKindSchema,
    points: z.array(AnchorPointSchema).min(1).max(3),
    color: ColorTokenSchema,
    text: z.string().max(MAX_NOTE_LENGTH).optional(),
    width: z.number().int().min(1).max(4).optional(),
    dash: LineDashSchema.optional(),
    fill: z.boolean().optional(),
    fillOpacity: z.number().min(0).max(0.6).optional(),
    extendLeft: z.boolean().optional(),
    extendRight: z.boolean().optional(),
    labels: z.boolean().optional(),
    fontSize: z.number().int().min(10).max(32).optional(),
    locked: z.boolean().optional(),
  })
  .refine((drawing) => drawing.points.length === POINT_COUNT[drawing.kind], "Wrong number of points for the kind");
export type Drawing = z.infer<typeof DrawingSchema>;

/** A drawing's style with every default filled in. */
export interface DrawingStyle {
  color: ColorToken;
  width: number;
  dash: LineDash;
  fill: boolean;
  fillOpacity: number;
  extendLeft: boolean;
  extendRight: boolean;
  labels: boolean;
  fontSize: number;
  locked: boolean;
}

export function styleOf(drawing: Drawing): DrawingStyle {
  return {
    color: drawing.color,
    width: drawing.width ?? (drawing.kind === "fib" ? 1 : 2),
    dash: drawing.dash ?? "solid",
    fill: drawing.fill ?? FILLABLE.has(drawing.kind),
    fillOpacity: drawing.fillOpacity ?? 0.12,
    extendLeft: drawing.extendLeft ?? false,
    extendRight: drawing.extendRight ?? false,
    labels: drawing.labels ?? true,
    fontSize: drawing.fontSize ?? (drawing.kind === "text" ? 14 : 12),
    locked: drawing.locked ?? false,
  };
}

/** The style fields a drawing may change through the style bar or the settings dialog. */
export type DrawingPatch = Partial<
  Pick<
    Drawing,
    | "color"
    | "width"
    | "dash"
    | "fill"
    | "fillOpacity"
    | "extendLeft"
    | "extendRight"
    | "labels"
    | "fontSize"
    | "locked"
    | "text"
    | "points"
  >
>;

/** Canvas dash patterns for a line `width` px wide. */
export function dashPattern(dash: LineDash, width: number): number[] {
  if (dash === "dashed") return [6 * Math.max(1, width * 0.75), 4 * Math.max(1, width * 0.75)];
  if (dash === "dotted") return [Math.max(1.5, width), Math.max(3, width * 2)];
  return [];
}
