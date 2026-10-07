/**
 * Pointer handling for drawings, TradingView-style: with a drawing tool, click to place the first point and click
 * again (or drag and release) for the second; one-point tools place on the first click. With the cursor, press on a
 * drawing to select it, drag its body to move it or a handle to reshape it; double-click a text note to edit it. While
 * a drawing is being placed or dragged, the chart's own panning and zooming are paused.
 */
import { distance, translate } from "../drawings/geometry";
import type { ScreenPoint } from "../drawings/geometry";
import { DEFAULT_DRAWING_COLORS, POINT_COUNT, isDrawingKind } from "../drawings/types";
import type { AnchorPoint, Drawing, DrawingKind, DrawingTool } from "../drawings/types";
import { newId } from "../indicators/registry";

import { findHit, toScreen } from "./drawings-primitive";
import type { DrawingsPrimitive } from "./drawings-primitive";

export interface InteractionHost {
  /** Pointer position on the price pane's plot area (or null outside it, unless `clamp`). */
  local(event: PointerEvent | MouseEvent, clamp?: boolean): ScreenPoint | null;
  /** Pixels → chart units, optionally snapped to the bar's OHLC (the magnet). */
  toChart(point: ScreenPoint, magnet: boolean): AnchorPoint | null;
  /** Pauses (false) or resumes the chart's own scrolling and scaling. */
  setChartInteractive(enabled: boolean): void;
}

export interface InteractionCallbacks {
  /** A finished change: the new drawings, and the drawing to select. */
  onCommit(drawings: Drawing[], selectedId: string | null): void;
  onSelect(id: string | null): void;
  /** A drawing was placed: the toolbar goes back to the cursor. */
  onPlaced(kind: DrawingKind): void;
  /** A text note needs its text: a new one at `point`, or an existing one by id. */
  onTextRequest(request: { point: AnchorPoint } | { id: string }): void;
}

interface Drag {
  id: string;
  handle: number | null;
  start: ScreenPoint;
  original: Drawing;
  screen: (ScreenPoint | null)[];
  moved: boolean;
}

/** Below this many pixels a press-and-release is a click, not a drag. */
const CLICK_SLOP = 4;

export class DrawingInteraction {
  private tool: DrawingTool = "crosshair";
  private magnet = false;
  private draft: Drawing | null = null;
  private pressStart: ScreenPoint | null = null;
  private drag: Drag | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly element: HTMLElement,
    private readonly host: InteractionHost,
    private readonly primitive: DrawingsPrimitive,
    private readonly callbacks: InteractionCallbacks,
  ) {
    this.listen("pointerdown", (event) => {
      this.onPointerDown(event);
    });
    this.listen("pointermove", (event) => {
      this.onPointerMove(event);
    });
    this.listen("pointerup", (event) => {
      this.onPointerUp(event);
    });
    this.listen("pointercancel", () => {
      this.cancel();
    });
    this.listen("pointerleave", () => {
      if (this.primitive.state.hoveredId !== null) this.primitive.update({ hoveredId: null });
    });
    this.listen("dblclick", (event) => {
      this.onDoubleClick(event);
    });
  }

  private listen<K extends "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "pointerleave" | "dblclick">(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    // Capture: we see the press before the chart does, so it can be kept from panning.
    this.element.addEventListener(type, handler, { capture: true });
    this.disposers.push(() => {
      this.element.removeEventListener(type, handler, { capture: true });
    });
  }

  setTool(tool: DrawingTool): void {
    if (tool === this.tool) return;
    this.tool = tool;
    this.cancel();
    this.primitive.update({ creating: isDrawingKind(tool), hoveredId: null });
  }

  setMagnet(magnet: boolean): void {
    this.magnet = magnet;
  }

  /** Esc: drops a drawing being placed or dragged. Returns whether there was one. */
  cancel(): boolean {
    const busy = this.draft !== null || this.drag !== null;
    if (this.drag !== null) {
      const { original } = this.drag;
      this.primitive.update({
        drawings: this.primitive.state.drawings.map((drawing) => (drawing.id === original.id ? original : drawing)),
      });
    }
    this.draft = null;
    this.drag = null;
    this.pressStart = null;
    this.primitive.update({ draft: null });
    this.host.setChartInteractive(true);
    return busy;
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.host.setChartInteractive(true);
  }

  private anchor(point: ScreenPoint): AnchorPoint | null {
    return this.host.toChart(point, this.magnet);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const { tool } = this;
    const point = this.host.local(event);
    if (point === null) return;

    if (isDrawingKind(tool)) {
      this.host.setChartInteractive(false);
      if (this.draft !== null) {
        this.finishDraft(point);
        return;
      }
      const anchor = this.anchor(point);
      if (anchor === null) return;
      if (tool === "text") {
        this.callbacks.onTextRequest({ point: anchor });
        this.callbacks.onPlaced(tool);
        return;
      }
      const drawing: Drawing = {
        id: newId("drawing"),
        kind: tool,
        color: DEFAULT_DRAWING_COLORS[tool],
        points: POINT_COUNT[tool] === 1 ? [anchor] : [anchor, anchor],
      };
      if (POINT_COUNT[tool] === 1) {
        this.callbacks.onCommit([...this.primitive.state.drawings, drawing], drawing.id);
        this.callbacks.onPlaced(tool);
        return;
      }
      this.draft = drawing;
      this.pressStart = point;
      this.primitive.update({ draft: drawing });
      return;
    }

    const { drawings, hidden, locked, selectedId } = this.primitive.state;
    if (hidden) return;
    const hit = findHit(drawings, this.projection, point, selectedId);
    if (hit === null) {
      if (selectedId !== null) this.callbacks.onSelect(null);
      return;
    }
    if (hit.id !== selectedId) this.callbacks.onSelect(hit.id);
    const original = drawings.find((drawing) => drawing.id === hit.id);
    if (locked || original === undefined) return;
    this.host.setChartInteractive(false);
    this.drag = {
      id: hit.id,
      handle: hit.handle,
      start: point,
      original,
      screen: original.points.map((anchor) => toScreen(this.projection, anchor)),
      moved: false,
    };
  }

  private get projection() {
    return this.primitive.projectionRef;
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.draft !== null) {
      const point = this.host.local(event, true);
      const anchor = point === null ? null : this.anchor(point);
      if (anchor === null) return;
      const [first] = this.draft.points;
      if (first === undefined) return;
      this.draft = { ...this.draft, points: [first, anchor] };
      this.primitive.update({ draft: this.draft });
      return;
    }
    if (this.drag !== null) {
      const point = this.host.local(event, true);
      if (point === null) return;
      const drag = this.drag;
      if (!drag.moved && distance(point, drag.start) < CLICK_SLOP) return;
      drag.moved = true;
      const moved = this.movedDrawing(drag, point);
      this.primitive.update({
        drawings: this.primitive.state.drawings.map((drawing) => (drawing.id === drag.id ? moved : drawing)),
      });
      return;
    }
    if (this.primitive.state.creating || this.primitive.state.hidden) return;
    const point = this.host.local(event);
    const hit =
      point === null
        ? null
        : findHit(this.primitive.state.drawings, this.projection, point, this.primitive.state.selectedId);
    const hoveredId = hit?.id ?? null;
    if (hoveredId !== this.primitive.state.hoveredId) this.primitive.update({ hoveredId });
  }

  private movedDrawing(drag: Drag, point: ScreenPoint): Drawing {
    const { original } = drag;
    if (drag.handle !== null) {
      const anchor = this.anchor(point);
      if (anchor === null) return original;
      return {
        ...original,
        points: original.points.map((existing, index) => (index === drag.handle ? anchor : existing)),
      };
    }
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    return {
      ...original,
      points: translate(original.points, drag.screen, dx, dy, (screen) => this.host.toChart(screen, false)),
    };
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.draft !== null && this.pressStart !== null) {
      const point = this.host.local(event, true);
      const dragged = point !== null && distance(point, this.pressStart) > CLICK_SLOP;
      this.pressStart = null;
      // Press, drag, release: done. A click leaves the second point following the pointer until the next click.
      if (dragged) this.finishDraft(point);
      this.host.setChartInteractive(true);
      return;
    }
    if (this.drag !== null) {
      const drag = this.drag;
      this.drag = null;
      // The preview already holds the moved drawing: commit it as one undo step.
      if (drag.moved) this.callbacks.onCommit([...this.primitive.state.drawings], drag.id);
    }
    this.host.setChartInteractive(true);
  }

  private finishDraft(point: ScreenPoint): void {
    const draft = this.draft;
    const anchor = this.anchor(point);
    this.draft = null;
    this.pressStart = null;
    this.primitive.update({ draft: null });
    const [first] = draft?.points ?? [];
    if (draft === null || anchor === null || first === undefined) return;
    const drawing: Drawing = { ...draft, points: [first, anchor] };
    this.callbacks.onCommit([...this.primitive.state.drawings, drawing], drawing.id);
    this.callbacks.onPlaced(drawing.kind);
  }

  private onDoubleClick(event: MouseEvent): void {
    if (isDrawingKind(this.tool) || this.primitive.state.locked || this.primitive.state.hidden) return;
    const point = this.host.local(event);
    if (point === null) return;
    const hit = findHit(this.primitive.state.drawings, this.projection, point, this.primitive.state.selectedId);
    const drawing = hit === null ? undefined : this.primitive.state.drawings.find((item) => item.id === hit.id);
    if (drawing?.kind === "text") this.callbacks.onTextRequest({ id: drawing.id });
  }
}
