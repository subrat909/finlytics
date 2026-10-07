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

/** The segment `a–b` extended past `a` (left) and/or past `b` (right) to the pane's edges. */
export function extendedSegment(
  a: ScreenPoint,
  b: ScreenPoint,
  size: PaneSize,
  left: boolean,
  right: boolean,
): [ScreenPoint, ScreenPoint] {
  return [left ? rayEnd(b, a, size) : a, right ? rayEnd(a, b, size) : b];
}

/** A parallel channel's second line: `a–b` shifted so it passes through `c` (vertically, in pixels). */
export function channelOffset(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): [ScreenPoint, ScreenPoint] {
  const dx = b.x - a.x;
  const yOnLine = dx === 0 ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / dx;
  const dy = c.y - yOnLine;
  return [
    { x: a.x, y: a.y + dy },
    { x: b.x, y: b.y + dy },
  ];
}

/** Whether `p` is inside the triangle `a b c`. */
export function insideTriangle(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): boolean {
  const sign = (p1: ScreenPoint, p2: ScreenPoint, p3: ScreenPoint) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** Distance from `p` to the ellipse inscribed in `rect` (0 inside when `filled`). */
export function distanceToEllipse(p: ScreenPoint, rect: Rect, filled: boolean): number {
  const rx = Math.max(1, (rect.right - rect.left) / 2);
  const ry = Math.max(1, (rect.bottom - rect.top) / 2);
  const cx = rect.left + rx;
  const cy = rect.top + ry;
  const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
  if (filled && k <= 1) return 0;
  return Math.abs(k - 1) * Math.min(rx, ry);
}

/** A price label's box: a callout to the right of its anchor. */
export function labelBox(anchor: ScreenPoint, text: string, fontSize = 12): Rect {
  const width = Math.max(40, text.length * fontSize * 0.6 + 16);
  const height = fontSize + 12;
  return { left: anchor.x + 8, right: anchor.x + 8 + width, top: anchor.y - height - 6, bottom: anchor.y - 6 };
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
  drawing: Pick<Drawing, "kind" | "text"> & Partial<Pick<Drawing, "fill" | "extendLeft" | "extendRight" | "fontSize">>,
  points: readonly (ScreenPoint | null)[],
  p: ScreenPoint,
  size: PaneSize,
  tolerance = HIT_TOLERANCE,
): HitResult | null {
  const [a, b, c] = points;
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
    case "crossline":
      if (a) gap = Math.min(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
      break;
    case "trend":
    case "arrow":
      if (a && b) {
        const [from, to] = extendedSegment(a, b, size, drawing.extendLeft ?? false, drawing.extendRight ?? false);
        gap = distanceToSegment(p, from, to);
      }
      break;
    case "ray":
      if (a && b) gap = distanceToSegment(p, a, rayEnd(a, b, size));
      break;
    case "extended":
      if (a && b) gap = distanceToSegment(p, rayEnd(b, a, size), rayEnd(a, b, size));
      break;
    case "channel":
      if (a && b) {
        gap = distanceToSegment(p, a, b);
        if (c) {
          const [a2, b2] = channelOffset(a, b, c);
          gap = Math.min(gap, distanceToSegment(p, a2, b2));
          if (insideTriangle(p, a, b, b2) || insideTriangle(p, a, b2, a2)) gap = 0;
        }
      }
      break;
    case "rect":
    case "measure":
    case "daterange":
    case "datepricerange":
      if (a && b && inside(p, rectOf(a, b), tolerance)) gap = 0;
      break;
    case "ellipse":
      if (a && b) gap = distanceToEllipse(p, rectOf(a, b), drawing.fill ?? true);
      break;
    case "triangle":
      if (a && b && c) {
        gap = Math.min(distanceToSegment(p, a, b), distanceToSegment(p, b, c), distanceToSegment(p, c, a));
        if (insideTriangle(p, a, b, c)) gap = 0;
      } else if (a && b) gap = distanceToSegment(p, a, b);
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
      if (a && inside(p, textBox(a, drawing.text ?? "", ((drawing.fontSize ?? 14) / 13) * 7.2), 2)) gap = 0;
      break;
    case "pricelabel":
      if (a && inside(p, labelBox(a, drawing.text ?? "000000.00", drawing.fontSize ?? 12), 2)) gap = 0;
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
