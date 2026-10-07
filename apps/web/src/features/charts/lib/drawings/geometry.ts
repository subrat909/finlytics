/**
 * Drawing geometry in screen pixels (pure): distances, hit tests, Fibonacci levels and price-range statistics. The
 * renderer and the pointer handling share these, so what is drawn is exactly what can be grabbed.
 */
import { FIB_LEVELS } from "./types";
import type { AnchorPoint, Drawing } from "./types";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PaneSize {
  width: number;
  height: number;
}

/** Pixels around a line or handle that still count as on it. */
export const HIT_TOLERANCE = 6;
export const HANDLE_RADIUS = 5;

export function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from `p` to the segment `a–b`. */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Where the ray from `a` through `b` leaves a pane of `size` (or `b` if they coincide). */
export function rayEnd(a: ScreenPoint, b: ScreenPoint, size: PaneSize): ScreenPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return b;
  const limits: number[] = [];
  if (dx > 0) limits.push((size.width - a.x) / dx);
  if (dx < 0) limits.push(-a.x / dx);
  if (dy > 0) limits.push((size.height - a.y) / dy);
  if (dy < 0) limits.push(-a.y / dy);
  const t = Math.max(1, Math.min(...limits.filter((value) => value > 0), Number.POSITIVE_INFINITY));
  return Number.isFinite(t) ? { x: a.x + t * dx, y: a.y + t * dy } : b;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectOf(a: ScreenPoint, b: ScreenPoint): Rect {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  };
}

function inside(p: ScreenPoint, rect: Rect, margin = 0): boolean {
  return (
    p.x >= rect.left - margin && p.x <= rect.right + margin && p.y >= rect.top - margin && p.y <= rect.bottom + margin
  );
}

/** A text note's box: the anchor is its left edge, vertically centred. */
export function textBox(anchor: ScreenPoint, text: string, charWidth = 7.2): Rect {
  const width = Math.max(24, text.length * charWidth + 12);
  return { left: anchor.x, right: anchor.x + width, top: anchor.y - 11, bottom: anchor.y + 11 };
}

export interface FibLevel {
  level: number;
  price: number;
}

/** Retracement levels between the first point (level 1) and the second (level 0). */
export function fibLevels(from: AnchorPoint, to: AnchorPoint): FibLevel[] {
  return FIB_LEVELS.map((level) => ({ level, price: to.price + (from.price - to.price) * level }));
}

export interface RangeStats {
  change: number;
  percent: number;
  /** Bars between the two points (signed, by the chart's bar spacing). */
  bars: number;
  /** Seconds between the two points. */
  seconds: number;
}

export function rangeStats(from: AnchorPoint, to: AnchorPoint, bars: number): RangeStats {
  const change = to.price - from.price;
  return {
    change,
    percent: from.price === 0 ? 0 : (change / from.price) * 100,
    bars,
    seconds: to.time - from.time,
  };
}

export interface HitResult {
  /** The anchor index under the pointer (a handle), or null for the drawing's body. */
  handle: number | null;
  distance: number;
}

/**
 * Whether `p` is on `drawing`, given its anchors on screen (null for an anchor off the time scale). Handles win over
 * the body. Horizontal lines and rays need only the price; vertical lines only the time.
 */
export function hitTest(
  drawing: Pick<Drawing, "kind" | "text">,
  points: readonly (ScreenPoint | null)[],
  p: ScreenPoint,
  size: PaneSize,
  tolerance = HIT_TOLERANCE,
): HitResult | null {
  const [a, b] = points;
  for (const [index, point] of points.entries()) {
    if (point !== null && distance(point, p) <= HANDLE_RADIUS + 2) return { handle: index, distance: 0 };
  }
  let gap = Number.POSITIVE_INFINITY;
  switch (drawing.kind) {
    case "hline":
      if (a) gap = Math.abs(p.y - a.y);
      break;
    case "hray":
      if (a && p.x >= a.x - tolerance) gap = Math.abs(p.y - a.y);
      break;
    case "vline":
      if (a) gap = Math.abs(p.x - a.x);
      break;
    case "trend":
      if (a && b) gap = distanceToSegment(p, a, b);
      break;
    case "ray":
      if (a && b) gap = distanceToSegment(p, a, rayEnd(a, b, size));
      break;
    case "rect":
    case "measure":
      if (a && b && inside(p, rectOf(a, b), tolerance)) gap = 0;
      break;
    case "fib":
      if (a && b) {
        const rect = rectOf(a, b);
        if (p.x >= rect.left - tolerance && p.x <= rect.right + tolerance) {
          const top = Math.min(a.y, b.y);
          const bottom = Math.max(a.y, b.y);
          const steps = FIB_LEVELS.map((level) => b.y + (a.y - b.y) * level);
          gap = Math.min(...steps.map((y) => Math.abs(p.y - y)), p.y >= top && p.y <= bottom ? tolerance : gap);
        }
      }
      break;
    case "text":
      if (a && inside(p, textBox(a, drawing.text ?? ""), 2)) gap = 0;
      break;
  }
  return gap <= tolerance ? { handle: null, distance: gap } : null;
}

/** The anchors moved by a pixel delta, through the caller's pixel ↔ chart conversions. */
export function translate(
  points: readonly AnchorPoint[],
  screen: readonly (ScreenPoint | null)[],
  dx: number,
  dy: number,
  toChart: (point: ScreenPoint) => AnchorPoint | null,
): AnchorPoint[] {
  return points.map((point, index) => {
    const at = screen[index];
    if (at === null || at === undefined) return point;
    return toChart({ x: at.x + dx, y: at.y + dy }) ?? point;
  });
}
