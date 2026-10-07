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

import { fibLevels, hitTest, rangeStats, rayEnd, rectOf } from "../drawings/geometry";
import type { PaneSize, ScreenPoint } from "../drawings/geometry";
import type { AnchorPoint, Drawing } from "../drawings/types";
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
      const always = drawing.kind === "hline" || drawing.kind === "hray";
      for (const point of drawing.points) {
        if (always || (selected && drawing.kind !== "vline")) {
          const y = this.projection.priceToY(point.price);
          if (y !== null) prices.push(new AxisLabel(y, formatNumber(point.price, precision), color, colors.background));
        }
        if (drawing.kind === "vline" || (selected && drawing.kind !== "hline")) {
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
    const color = colors.palette[drawing.color] || colors.textStrong;
    const points = drawing.points.map((point) => toScreen(this.projection, point));
    const [a, b] = points;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = selected || hovered ? 2 : 1.5;
    ctx.font = `500 12px ${fontFamily}`;

    const line = (from: ScreenPoint, to: ScreenPoint) => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    };

    switch (drawing.kind) {
      case "trend":
        if (a && b) line(a, b);
        break;
      case "ray":
        if (a && b) line(a, rayEnd(a, b, size));
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
      case "rect":
        if (a && b) {
          const rect = rectOf(a, b);
          ctx.fillStyle = withAlpha(color, 0.12);
          ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
          ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        }
        break;
      case "fib":
        if (a && b) this.paintFib(ctx, drawing, a, b, color, precision);
        break;
      case "measure":
        if (a && b) this.paintMeasure(ctx, drawing, a, b, precision);
        break;
      case "text":
        if (a) {
          const text = drawing.text?.trim() || "Text";
          ctx.font = `500 13px ${fontFamily}`;
          const width = ctx.measureText(text).width + 12;
          ctx.fillStyle = withAlpha(colors.background, 0.85);
          ctx.fillRect(a.x, a.y - 11, width, 22);
          if (selected || hovered) ctx.strokeRect(a.x, a.y - 11, width, 22);
          ctx.fillStyle = color;
          ctx.textBaseline = "middle";
          ctx.fillText(text, a.x + 6, a.y);
        }
        break;
    }

    if (selected) {
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

  private paintFib(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    a: ScreenPoint,
    b: ScreenPoint,
    color: string,
    precision: number,
  ): void {
    const [from, to] = drawing.points;
    if (from === undefined || to === undefined) return;
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    let previous: number | null = null;
    ctx.lineWidth = 1;
    ctx.textBaseline = "bottom";
    for (const [index, level] of fibLevels(from, to).entries()) {
      const y = this.projection.priceToY(level.price);
      if (y === null) continue;
      if (previous !== null && index % 2 === 1) {
        ctx.fillStyle = withAlpha(color, 0.08);
        ctx.fillRect(left, Math.min(previous, y), right - left, Math.abs(y - previous));
      }
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = color;
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
  ): void {
    const [from, to] = drawing.points;
    if (from === undefined || to === undefined) return;
    const { colors } = this.scene;
    const stats = rangeStats(from, to, this.projection.barsBetween(from.time, to.time));
    const tone = stats.change >= 0 ? colors.up : colors.down;
    const rect = rectOf(a, b);
    ctx.fillStyle = withAlpha(tone, 0.14);
    ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    const middle = (rect.left + rect.right) / 2;
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(middle, a.y);
    ctx.lineTo(middle, b.y);
    ctx.stroke();
    const head = b.y < a.y ? 6 : -6;
    ctx.beginPath();
    ctx.moveTo(middle - 5, b.y + head);
    ctx.lineTo(middle, b.y);
    ctx.lineTo(middle + 5, b.y + head);
    ctx.stroke();

    const lines = [
      `${formatNumber(stats.change, precision, "always")} (${formatPercent(stats.percent)})`,
      `${String(Math.round(stats.bars))} bars, ${formatDuration(stats.seconds)}`,
    ];
    ctx.font = `600 12px ${this.scene.fontFamily}`;
    const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + 16;
    const height = 38;
    const top = stats.change >= 0 ? rect.top - height - 6 : rect.bottom + 6;
    ctx.fillStyle = tone;
    ctx.fillRect(middle - width / 2, top, width, height);
    ctx.fillStyle = colors.background;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(lines[0] ?? "", middle, top + 11);
    ctx.fillText(lines[1] ?? "", middle, top + 27);
  }
}
