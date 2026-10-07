/**
 * Drawings as a Lightweight Charts series primitive: painted on the price pane's canvas in the chart's own render
 * pass (so they scroll, zoom and screenshot with it), with price and time axis labels and a hit test that sets the
 * pointer. It only draws: pointer handling is in ./drawing-interaction, state comes from the workspace.
 */
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
} from "lightweight-charts";

import {
  channelOffset,
  extendedSegment,
  fibLevels,
  hitTest,
  labelBox,
  rangeStats,
  rayEnd,
  rectOf,
} from "../drawings/geometry";
import type { PaneSize, ScreenPoint } from "../drawings/geometry";
import { dashPattern, styleOf } from "../drawings/types";
import type { AnchorPoint, Drawing, DrawingStyle } from "../drawings/types";
import { formatNumber, formatPercent } from "../format";
import type { ChartColors } from "../theme-colors";
import { withAlpha } from "../theme-colors";
import { formatBarTime, formatDuration } from "../time";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** Chart units ↔ pixels on the price pane, supplied by the controller (they change with every scroll and zoom). */
export interface DrawingProjection {
  timeToX(time: number): number | null;
  priceToY(price: number): number | null;
  /** Bars between two times, by the time scale (signed). */
  barsBetween(from: number, to: number): number;
  paneSize(): PaneSize;
  /** The x of the first bar of each trading day in view (session breaks). */
  dayStarts(): number[];
}

export interface DrawingScene {
  drawings: readonly Drawing[];
  draft: Drawing | null;
  selectedId: string | null;
  hoveredId: string | null;
  hidden: boolean;
  locked: boolean;
  /** A drawing tool is active: no hover feedback on existing drawings. */
  creating: boolean;
  sessionBreaks: boolean;
  intraday: boolean;
  precision: number;
  colors: ChartColors;
  fontFamily: string;
}

export interface DrawingHit {
  id: string;
  handle: number | null;
}

export function toScreen(projection: DrawingProjection, point: AnchorPoint): ScreenPoint | null {
  const x = projection.timeToX(point.time);
  const y = projection.priceToY(point.price);
  return x === null || y === null ? null : { x, y };
}

/** The topmost drawing under `p` (handles of the selected drawing first). */
export function findHit(
  drawings: readonly Drawing[],
  projection: DrawingProjection,
  p: ScreenPoint,
  selectedId: string | null,
): DrawingHit | null {
  const size = projection.paneSize();
  const ordered = [...drawings].reverse().sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  for (const drawing of ordered) {
    const points = drawing.points.map((point) => toScreen(projection, point));
    if (drawing.kind === "hline" && points[0] === null) {
      const y = projection.priceToY(drawing.points[0]?.price ?? Number.NaN);
      if (y !== null && Math.abs(p.y - y) <= 6) return { id: drawing.id, handle: null };
      continue;
    }
    const hit = hitTest(drawing, points, p, size);
    if (hit !== null) return { id: drawing.id, handle: drawing.id === selectedId ? hit.handle : null };
  }
  return null;
}

class AxisLabel implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly at: number,
    private readonly label: string,
    private readonly fill: string,
    private readonly ink: string,
  ) {}

  coordinate(): number {
    return this.at;
  }

  text(): string {
    return this.label;
  }

  textColor(): string {
    return this.ink;
  }

  backColor(): string {
    return this.fill;
  }
}

export class DrawingsPrimitive implements ISeriesPrimitive {
  private requestUpdate: (() => void) | undefined;
  private priceLabels: ISeriesPrimitiveAxisView[] = [];
  private timeLabels: ISeriesPrimitiveAxisView[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  constructor(
    private scene: DrawingScene,
    private readonly projection: DrawingProjection,
  ) {
    const top: IPrimitivePaneRenderer = {
      draw: (target) => {
        this.drawTop(target);
      },
    };
    const bottom: IPrimitivePaneRenderer = {
      draw: (target) => {
        this.drawBreaks(target);
      },
    };
    this.views = [
      { zOrder: (): PrimitivePaneViewZOrder => "bottom", renderer: () => bottom },
      { zOrder: (): PrimitivePaneViewZOrder => "top", renderer: () => top },
    ];
  }

  attached(param: SeriesAttachedParameter): void {
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = undefined;
  }

  update(patch: Partial<DrawingScene>): void {
    this.scene = { ...this.scene, ...patch };
    this.updateAllViews();
    this.requestUpdate?.();
  }

  get state(): DrawingScene {
    return this.scene;
  }

  get projectionRef(): DrawingProjection {
    return this.projection;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.priceLabels;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeLabels;
  }

  /** Axis labels: horizontal lines always show their price; the selected drawing shows all its prices and times. */
  updateAllViews(): void {
    const { drawings, draft, selectedId, hidden, colors, precision, intraday } = this.scene;
    const prices: ISeriesPrimitiveAxisView[] = [];
    const times: ISeriesPrimitiveAxisView[] = [];
    const visible = hidden ? [] : drawings;
    for (const drawing of draft === null ? visible : [...visible, draft]) {
      const color = colors.palette[drawing.color];
      const selected = drawing.id === selectedId || drawing === draft;
      const style = styleOf(drawing);
      const always =
        style.labels && (drawing.kind === "hline" || drawing.kind === "hray" || drawing.kind === "crossline");
      for (const point of drawing.points) {
        if (always || (selected && drawing.kind !== "vline")) {
          const y = this.projection.priceToY(point.price);
          if (y !== null) prices.push(new AxisLabel(y, formatNumber(point.price, precision), color, colors.background));
        }
        if (
          (style.labels && (drawing.kind === "vline" || drawing.kind === "crossline")) ||
          (selected && drawing.kind !== "hline")
        ) {
          const x = this.projection.timeToX(point.time);
          if (x !== null) times.push(new AxisLabel(x, formatBarTime(point.time, intraday), color, colors.background));
        }
      }
    }
    this.priceLabels = prices;
    this.timeLabels = times;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const { drawings, hidden, locked, creating, selectedId } = this.scene;
    if (hidden || creating) return null;
    const hit = findHit(drawings, this.projection, { x, y }, selectedId);
    if (hit === null) return null;
    return {
      externalId: hit.id,
      zOrder: "top",
      itemType: "primitive",
      cursorStyle: locked ? "default" : hit.handle === null ? "move" : "grab",
    };
  }

  private drawBreaks(target: RenderTarget): void {
    const { sessionBreaks, intraday, colors } = this.scene;
    if (!sessionBreaks || !intraday) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      context.strokeStyle = withAlpha(colors.text, 0.35);
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      for (const x of this.projection.dayStarts()) {
        context.beginPath();
        context.moveTo(Math.round(x) + 0.5, 0);
        context.lineTo(Math.round(x) + 0.5, mediaSize.height);
        context.stroke();
      }
      context.restore();
    });
  }

  private drawTop(target: RenderTarget): void {
    const { drawings, draft, hidden, selectedId, hoveredId } = this.scene;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const size = { width: mediaSize.width, height: mediaSize.height };
      if (!hidden) {
        for (const drawing of drawings) {
          this.paint(context, drawing, size, drawing.id === selectedId, drawing.id === hoveredId);
        }
      }
      if (draft !== null) this.paint(context, draft, size, true, false);
    });
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    size: PaneSize,
    selected: boolean,
    hovered: boolean,
  ): void {
    const { colors, precision, fontFamily } = this.scene;
    const style = styleOf(drawing);
    const color = colors.palette[drawing.color] || colors.textStrong;
    const points = drawing.points.map((point) => toScreen(this.projection, point));
    const [a, b, c] = points;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = style.width + (selected || hovered ? 0.5 : 0);
    ctx.setLineDash(dashPattern(style.dash, style.width));
    ctx.font = `500 ${String(style.fontSize)}px ${fontFamily}`;

    const line = (from: ScreenPoint, to: ScreenPoint) => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    };
    const area = (path: () => void) => {
      if (!style.fill) return;
      ctx.save();
      ctx.fillStyle = withAlpha(color, style.fillOpacity);
      ctx.beginPath();
      path();
      ctx.fill();
      ctx.restore();
    };

    switch (drawing.kind) {
      case "trend":
      case "arrow":
        if (a && b) {
          const [from, to] = extendedSegment(a, b, size, style.extendLeft, style.extendRight);
          line(from, to);
          if (drawing.kind === "arrow") this.arrowHead(ctx, a, b, style);
        }
        break;
      case "ray":
        if (a && b) line(a, rayEnd(a, b, size));
        break;
      case "extended":
        if (a && b) line(rayEnd(b, a, size), rayEnd(a, b, size));
        break;
      case "hline": {
        const y = this.projection.priceToY(drawing.points[0]?.price ?? Number.NaN);
        if (y !== null) line({ x: 0, y }, { x: size.width, y });
        break;
      }
      case "hray":
        if (a) line(a, { x: size.width, y: a.y });
        break;
      case "vline":
        if (a) line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        break;
      case "crossline":
        if (a) {
          line({ x: 0, y: a.y }, { x: size.width, y: a.y });
          line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        }
        break;
      case "channel":
        if (a && b) {
          if (c) {
            const [a2, b2] = channelOffset(a, b, c);
            area(() => {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.lineTo(b2.x, b2.y);
              ctx.lineTo(a2.x, a2.y);
              ctx.closePath();
            });
            line(a2, b2);
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            line({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 });
            ctx.restore();
          }
          line(a, b);
        }
        break;
      case "rect":
        if (a && b) {
          const rect = rectOf(a, b);
          area(() => {
            ctx.rect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
          });
          ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        }
        break;
      case "ellipse":
        if (a && b) {
          const rect = rectOf(a, b);
          const rx = Math.max(1, (rect.right - rect.left) / 2);
          const ry = Math.max(1, (rect.bottom - rect.top) / 2);
          const shape = () => {
            ctx.ellipse(rect.left + rx, rect.top + ry, rx, ry, 0, 0, Math.PI * 2);
          };
          area(shape);
          ctx.beginPath();
          shape();
          ctx.stroke();
        }
        break;
      case "triangle":
        if (a && b) {
          const third = c ?? b;
          const shape = () => {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(third.x, third.y);
            ctx.closePath();
          };
          area(shape);
          ctx.beginPath();
          shape();
          ctx.stroke();
        }
        break;
      case "fib":
        if (a && b) this.paintFib(ctx, drawing, a, b, color, precision, style);
        break;
      case "measure":
      case "daterange":
      case "datepricerange":
        if (a && b) this.paintMeasure(ctx, drawing, a, b, precision, style);
        break;
      case "text":
        if (a) {
          const text = drawing.text?.trim() || "Text";
          const width = ctx.measureText(text).width + 12;
          const height = style.fontSize + 9;
          ctx.setLineDash([]);
          ctx.fillStyle = withAlpha(colors.background, 0.85);
          ctx.fillRect(a.x, a.y - height / 2, width, height);
          if (selected || hovered) ctx.strokeRect(a.x, a.y - height / 2, width, height);
          ctx.fillStyle = color;
          ctx.textBaseline = "middle";
          ctx.fillText(text, a.x + 6, a.y);
        }
        break;
      case "pricelabel":
        if (a) {
          const price = drawing.points[0]?.price ?? 0;
          const text = drawing.text?.trim() || formatNumber(price, precision);
          const box = labelBox(a, text, style.fontSize);
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(box.left + 6, box.bottom);
          ctx.lineTo(box.left + 16, box.bottom);
          ctx.closePath();
          ctx.fill();
          ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
          ctx.fillStyle = colors.background;
          ctx.textBaseline = "middle";
          ctx.fillText(text, box.left + 8, (box.top + box.bottom) / 2);
        }
        break;
    }

    if (selected) {
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = colors.background;
      for (const [index, point] of points.entries()) {
        const at =
          point ??
          (drawing.kind === "hline" && index === 0
            ? { x: size.width / 2, y: this.projection.priceToY(drawing.points[0]?.price ?? Number.NaN) ?? -10 }
            : null);
        if (at === null) continue;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private arrowHead(ctx: CanvasRenderingContext2D, from: ScreenPoint, to: ScreenPoint, style: DrawingStyle): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 8 + style.width * 2;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 7), to.y - size * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 7), to.y - size * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private paintFib(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    a: ScreenPoint,
    b: ScreenPoint,
    color: string,
    precision: number,
    style: DrawingStyle,
  ): void {
    const [from, to] = drawing.points;
    if (from === undefined || to === undefined) return;
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    let previous: number | null = null;
    ctx.lineWidth = style.width;
    ctx.textBaseline = "bottom";
    for (const [index, level] of fibLevels(from, to).entries()) {
      const y = this.projection.priceToY(level.price);
      if (y === null) continue;
      if (style.fill && previous !== null && index % 2 === 1) {
        ctx.fillStyle = withAlpha(color, style.fillOpacity * 0.7);
        ctx.fillRect(left, Math.min(previous, y), right - left, Math.abs(y - previous));
      }
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = color;
      if (style.labels)
        ctx.fillText(`${String(level.level)} (${formatNumber(level.price, precision)})`, left + 4, y - 2);
      previous = y;
    }
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private paintMeasure(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    a: ScreenPoint,
    b: ScreenPoint,
    precision: number,
    style: DrawingStyle,
  ): void {
    const [from, to] = drawing.points;
    if (from === undefined || to === undefined) return;
    const { colors } = this.scene;
    const stats = rangeStats(from, to, this.projection.barsBetween(from.time, to.time));
    const priced = drawing.kind !== "daterange";
    const dated = drawing.kind !== "measure";
    const tone =
      drawing.kind === "daterange" ? colors.palette[drawing.color] : stats.change >= 0 ? colors.up : colors.down;
    const rect = rectOf(a, b);
    ctx.setLineDash([]);
    ctx.fillStyle = withAlpha(tone, style.fill ? Math.max(0.06, style.fillOpacity) : 0.06);
    ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    ctx.strokeStyle = tone;
    ctx.lineWidth = style.width;
    const middleX = (rect.left + rect.right) / 2;
    const middleY = (rect.top + rect.bottom) / 2;
    const arrow = (from: ScreenPoint, to: ScreenPoint) => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      ctx.beginPath();
      ctx.moveTo(to.x - 7 * Math.cos(angle - Math.PI / 6), to.y - 7 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(to.x, to.y);
      ctx.lineTo(to.x - 7 * Math.cos(angle + Math.PI / 6), to.y - 7 * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    };
    if (priced) arrow({ x: middleX, y: a.y }, { x: middleX, y: b.y });
    if (dated) arrow({ x: a.x, y: middleY }, { x: b.x, y: middleY });
    if (!style.labels) return;

    const lines: string[] = [];
    if (priced) lines.push(`${formatNumber(stats.change, precision, "always")} (${formatPercent(stats.percent)})`);
    lines.push(`${String(Math.round(stats.bars))} bars, ${formatDuration(stats.seconds)}`);
    ctx.font = `600 ${String(style.fontSize)}px ${this.scene.fontFamily}`;
    const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + 16;
    const lineHeight = style.fontSize + 4;
    const height = lines.length * lineHeight + 10;
    const above = !priced || stats.change >= 0;
    const top = above ? rect.top - height - 6 : rect.bottom + 6;
    ctx.fillStyle = tone;
    ctx.fillRect(middleX - width / 2, top, width, height);
    ctx.fillStyle = colors.background;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [index, text] of lines.entries()) {
      ctx.fillText(text, middleX, top + 5 + lineHeight * index + lineHeight / 2);
    }
  }
}
