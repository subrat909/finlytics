import { describe, expect, it, vi } from "vitest";

import { DrawingInteraction } from "../lib/chart/drawing-interaction";
import { DrawingsPrimitive, findHit } from "../lib/chart/drawings-primitive";
import type { DrawingProjection, DrawingScene } from "../lib/chart/drawings-primitive";
import { DRAWING_KINDS, POINT_COUNT } from "../lib/drawings/types";
import type { Drawing, DrawingKind } from "../lib/drawings/types";
import { COLOR_TOKENS } from "../lib/indicators/registry";
import type { ColorToken } from "../lib/indicators/registry";
import type { ChartColors } from "../lib/theme-colors";

/** Chart units are pixels here: time = x, price = y. */
const projection: DrawingProjection = {
  timeToX: (time) => time,
  priceToY: (price) => price,
  barsBetween: (from, to) => (to - from) / 10,
  paneSize: () => ({ width: 400, height: 300 }),
  dayStarts: () => [50, 150],
};

const COLORS: ChartColors = {
  background: "#000000",
  text: "#888888",
  textStrong: "#ffffff",
  grid: "#222222",
  border: "#333333",
  up: "#00ff00",
  down: "#ff0000",
  upVolume: "#00ff0044",
  downVolume: "#ff000044",
  crosshair: "#999999",
  crosshairLabel: "#444444",
  palette: Object.fromEntries(COLOR_TOKENS.map((token) => [token, "#123456"])) as Record<ColorToken, string>,
};

function scene(drawings: Drawing[], patch: Partial<DrawingScene> = {}): DrawingScene {
  return {
    drawings,
    draft: null,
    selectedId: null,
    hoveredId: null,
    hidden: false,
    locked: false,
    creating: false,
    sessionBreaks: true,
    intraday: true,
    precision: 2,
    colors: COLORS,
    fontFamily: "Inter",
    ...patch,
  };
}

function drawingOf(kind: DrawingKind, extra: Partial<Drawing> = {}): Drawing {
  const points = [
    { time: 100, price: 100 },
    { time: 200, price: 50 },
    { time: 150, price: 200 },
  ].slice(0, POINT_COUNT[kind]);
  return { id: `d-${kind}`, kind, color: "primary", points, text: kind === "text" ? "Note" : undefined, ...extra };
}

/** A canvas context that records the calls the renderer makes. */
function fakeContext() {
  const calls: string[] = [];
  const target = new Proxy(
    { measureText: () => ({ width: 40 }) },
    {
      get(object, property: string) {
        if (property in object) return object[property as keyof typeof object];
        return (...args: unknown[]) => {
          calls.push(`${property}(${String(args.length)})`);
        };
      },
      set() {
        return true;
      },
    },
  );
  return { context: target as unknown as CanvasRenderingContext2D, calls };
}

function render(primitive: DrawingsPrimitive): string[] {
  const { context, calls } = fakeContext();
  const target = {
    useMediaCoordinateSpace: (
      draw: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void,
    ) => {
      draw({ context, mediaSize: { width: 400, height: 300 } });
    },
  };
  for (const view of primitive.paneViews()) view.renderer()?.draw(target as never);
  return calls;
}

describe("DrawingsPrimitive", () => {
  it("paints every kind, selected and styled, with axis labels", () => {
    const drawings = DRAWING_KINDS.map((kind) =>
      drawingOf(kind, { dash: "dashed", width: 3, extendLeft: true, extendRight: true, fill: true }),
    );
    const primitive = new DrawingsPrimitive(scene(drawings), projection);
    for (const drawing of drawings) {
      primitive.update({ selectedId: drawing.id });
      expect(render(primitive).length).toBeGreaterThan(0);
    }
    expect(primitive.priceAxisViews().length).toBeGreaterThan(0);
    // Labels off and no fill: still paints the outline.
    primitive.update({
      drawings: drawings.map((drawing) => ({ ...drawing, labels: false, fill: false })),
      selectedId: null,
    });
    expect(render(primitive).some((call) => call.startsWith("stroke"))).toBe(true);
    // Hidden drawings paint nothing but the session breaks.
    primitive.update({ hidden: true });
    expect(render(primitive).filter((call) => call.startsWith("fillText"))).toEqual([]);
  });

  it("paints a draft and reports hits with the right cursor", () => {
    const trend = drawingOf("trend");
    const primitive = new DrawingsPrimitive(scene([trend], { draft: drawingOf("channel") }), projection);
    expect(render(primitive).length).toBeGreaterThan(0);
    expect(primitive.hitTest(150, 75)?.externalId).toBe("d-trend");
    primitive.update({ locked: true });
    expect(primitive.hitTest(150, 75)?.cursorStyle).toBe("default");
    expect(
      findHit(
        [drawingOf("hline", { points: [{ time: -5, price: 120 }] })],
        { ...projection, timeToX: () => null },
        { x: 10, y: 121 },
        null,
      )?.id,
    ).toBe("d-hline");
  });
});

describe("DrawingInteraction", () => {
  function setup(drawings: Drawing[] = []) {
    const element = document.createElement("div");
    const primitive = new DrawingsPrimitive(scene(drawings), projection);
    const callbacks = {
      onCommit: vi.fn((next: Drawing[], selectedId: string | null) => {
        primitive.update({ drawings: next, selectedId });
      }),
      onSelect: vi.fn(),
      onPlaced: vi.fn(),
      onTextRequest: vi.fn(),
    };
    const host = {
      local: (event: MouseEvent) => ({ x: event.clientX, y: event.clientY }),
      toChart: (point: { x: number; y: number }) => ({ time: point.x, price: point.y }),
      setChartInteractive: vi.fn(),
    };
    const interaction = new DrawingInteraction(element, host, primitive, callbacks);
    const fire = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
      element.dispatchEvent(event);
    };
    return { interaction, primitive, callbacks, fire, host };
  }

  it("places one, two and three point drawings by clicks", () => {
    const { interaction, callbacks, fire } = setup();
    interaction.setTool("hline");
    fire("pointerdown", 10, 20);
    expect(callbacks.onCommit).toHaveBeenLastCalledWith(
      [expect.objectContaining({ kind: "hline" })],
      expect.any(String),
    );

    interaction.setTool("trend");
    fire("pointerdown", 10, 10);
    fire("pointerup", 10, 10);
    fire("pointermove", 60, 60);
    fire("pointerdown", 60, 60);
    expect(callbacks.onPlaced).toHaveBeenLastCalledWith("trend");

    interaction.setTool("triangle");
    fire("pointerdown", 0, 0);
    fire("pointerup", 0, 0);
    fire("pointerdown", 100, 0);
    expect(callbacks.onPlaced).not.toHaveBeenLastCalledWith("triangle");
    fire("pointermove", 50, 80);
    fire("pointerdown", 50, 80);
    expect(callbacks.onPlaced).toHaveBeenLastCalledWith("triangle");

    interaction.setTool("text");
    fire("pointerdown", 30, 30);
    expect(callbacks.onTextRequest).toHaveBeenCalledWith({ point: { time: 30, price: 30 } });
    interaction.dispose();
  });

  it("selects, drags, reshapes and cancels; locked drawings don't move", () => {
    const trend = drawingOf("trend");
    const locked = drawingOf("rect", {
      id: "locked",
      locked: true,
      points: [
        { time: 300, price: 200 },
        { time: 380, price: 280 },
      ],
    });
    const { interaction, callbacks, fire, primitive } = setup([trend, locked]);
    interaction.setTool("cursor");
    fire("pointermove", 150, 75);
    expect(primitive.state.hoveredId).toBe("d-trend");
    fire("pointerdown", 150, 75);
    expect(callbacks.onSelect).toHaveBeenCalledWith("d-trend");
    fire("pointermove", 170, 95);
    fire("pointerup", 170, 95);
    expect(callbacks.onCommit).toHaveBeenCalled();
    fire("pointerdown", 340, 240);
    fire("pointermove", 360, 260);
    fire("pointerup", 360, 260);
    expect(primitive.state.drawings.find((drawing) => drawing.id === "locked")?.points[0]).toEqual({
      time: 300,
      price: 200,
    });
    fire("pointerdown", 5, 5);
    expect(callbacks.onSelect).toHaveBeenLastCalledWith(null);
    fire("pointerleave", 0, 0);
    interaction.setTool("rect");
    fire("pointerdown", 10, 10);
    expect(interaction.cancel()).toBe(true);
    interaction.setTool("cursor");
    const note = drawingOf("text", { points: [{ time: 20, price: 280 }] });
    primitive.update({ drawings: [note] });
    fire("dblclick", 25, 280);
    expect(callbacks.onTextRequest).toHaveBeenLastCalledWith({ id: "d-text" });
  });
});
