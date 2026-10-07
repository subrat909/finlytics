/**
 * Drawings on the price pane. A drawing is anchored in chart units (IST-shifted time and price), never pixels, so it
 * stays put while the chart scrolls, zooms, changes interval or loads older history.
 */
import { z } from "zod";

import { ColorTokenSchema } from "../indicators/registry";
import type { ColorToken } from "../indicators/registry";

export const DRAWING_KINDS = Object.freeze([
  "trend",
  "ray",
  "hline",
  "hray",
  "vline",
  "rect",
  "fib",
  "measure",
  "text",
] as const);
export const DrawingKindSchema = z.enum(DRAWING_KINDS);
export type DrawingKind = z.infer<typeof DrawingKindSchema>;

/** The left toolbar's tools: two pointer modes, then one tool per drawing kind. */
export type DrawingTool = "cursor" | "crosshair" | DrawingKind;

export function isDrawingKind(tool: DrawingTool): tool is DrawingKind {
  return tool !== "cursor" && tool !== "crosshair";
}

/** How many anchor points each kind takes (clicks to draw it). */
export const POINT_COUNT: Readonly<Record<DrawingKind, 1 | 2>> = Object.freeze({
  trend: 2,
  ray: 2,
  hline: 1,
  hray: 1,
  vline: 1,
  rect: 2,
  fib: 2,
  measure: 2,
  text: 1,
});

export const TOOL_LABELS: Readonly<Record<DrawingTool, string>> = Object.freeze({
  cursor: "Cursor",
  crosshair: "Crosshair",
  trend: "Trend line",
  ray: "Ray",
  hline: "Horizontal line",
  hray: "Horizontal ray",
  vline: "Vertical line",
  rect: "Rectangle",
  fib: "Fibonacci retracement",
  measure: "Price range",
  text: "Text note",
});

export const DEFAULT_DRAWING_COLORS: Readonly<Record<DrawingKind, ColorToken>> = Object.freeze({
  trend: "primary",
  ray: "primary",
  hline: "info",
  hray: "info",
  vline: "violet",
  rect: "highlight",
  fib: "orange",
  measure: "info",
  text: "fg",
});

/** Fibonacci retracement levels, from the second point (0) to the first (1). */
export const FIB_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const);

export const AnchorPointSchema = z.object({ time: z.number(), price: z.number() });
export type AnchorPoint = z.infer<typeof AnchorPointSchema>;

/** The most characters a text note keeps. */
export const MAX_NOTE_LENGTH = 200;

export const DrawingSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: DrawingKindSchema,
    points: z.array(AnchorPointSchema).min(1).max(2),
    color: ColorTokenSchema,
    text: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .refine((drawing) => drawing.points.length === POINT_COUNT[drawing.kind], "Wrong number of points for the kind");
export type Drawing = z.infer<typeof DrawingSchema>;
