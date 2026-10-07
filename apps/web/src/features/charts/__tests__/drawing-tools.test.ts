import { describe, expect, it } from "vitest";

import {
  channelOffset,
  distanceToEllipse,
  extendedSegment,
  hitTest,
  insideTriangle,
  labelBox,
} from "../lib/drawings/geometry";
import { DrawingSchema, POINT_COUNT, dashPattern, styleOf } from "../lib/drawings/types";
import type { Drawing } from "../lib/drawings/types";
import { createWorkspaceStore } from "../store/workspace-store";
import { defaultLayout } from "../lib/storage";

const SIZE = { width: 400, height: 300 };

describe("drawing geometry", () => {
  it("extends a segment to the pane's edges on request", () => {
    const [from, to] = extendedSegment({ x: 100, y: 100 }, { x: 200, y: 100 }, SIZE, true, true);
    expect(from).toEqual({ x: 0, y: 100 });
    expect(to).toEqual({ x: 400, y: 100 });
  });

  it("puts a channel's second line through the third point", () => {
    const [a2, b2] = channelOffset({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 50, y: 90 });
    expect(a2).toEqual({ x: 0, y: 140 });
    expect(b2).toEqual({ x: 100, y: 40 });
  });

  it("knows the inside of triangles and ellipses", () => {
    expect(insideTriangle({ x: 10, y: 10 }, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 })).toBe(true);
    expect(insideTriangle({ x: 39, y: 39 }, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 })).toBe(false);
    const rect = { left: 0, top: 0, right: 100, bottom: 50 };
    expect(distanceToEllipse({ x: 50, y: 25 }, rect, true)).toBe(0);
    expect(distanceToEllipse({ x: 100, y: 25 }, rect, false)).toBeCloseTo(0);
  });

  it("hits the new shapes by their outline or area", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(hitTest({ kind: "triangle" }, points, { x: 20, y: 20 }, SIZE)).toEqual({ handle: null, distance: 0 });
    expect(hitTest({ kind: "crossline" }, [{ x: 50, y: 50 }], { x: 300, y: 52 }, SIZE)?.handle).toBeNull();
    expect(
      hitTest(
        { kind: "extended" },
        [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
        { x: 5, y: 101 },
        SIZE,
      ),
    ).not.toBeNull();
    const box = labelBox({ x: 10, y: 100 }, "24,000.00");
    expect(
      hitTest(
        { kind: "pricelabel", text: "24,000.00" },
        [{ x: 10, y: 100 }],
        { x: box.left + 5, y: box.top + 5 },
        SIZE,
      ),
    ).not.toBeNull();
  });
});

describe("drawing styles", () => {
  const base: Drawing = {
    id: "d1",
    kind: "rect",
    color: "primary",
    points: [
      { time: 1, price: 1 },
      { time: 2, price: 2 },
    ],
  };

  it("fills in defaults, so drawings saved before styles existed still load", () => {
    expect(DrawingSchema.safeParse(base).success).toBe(true);
    expect(styleOf(base)).toMatchObject({ width: 2, dash: "solid", fill: true, labels: true, locked: false });
    expect(styleOf({ ...base, kind: "trend" }).fill).toBe(false);
    expect(dashPattern("solid", 2)).toEqual([]);
    expect(dashPattern("dashed", 2).length).toBe(2);
  });

  it("needs three points for channels and triangles", () => {
    expect(POINT_COUNT.channel).toBe(3);
    expect(DrawingSchema.safeParse({ ...base, kind: "triangle" }).success).toBe(false);
  });

  it("restyles, clones and removes through the workspace store, one undo step each", () => {
    const store = createWorkspaceStore(defaultLayout(), [base]);
    store.getState().updateDrawing("d1", { color: "loss", width: 3, dash: "dashed" });
    expect(store.getState().history.present[0]).toMatchObject({ color: "loss", width: 3, dash: "dashed" });
    store.getState().cloneDrawing("d1");
    const present = store.getState().history.present;
    expect(present).toHaveLength(2);
    expect(store.getState().selectedId).toBe(present[1]?.id);
    expect(present[1]?.points[0]?.time).toBeGreaterThan(1);
    store.getState().undo();
    expect(store.getState().history.present).toHaveLength(1);
    store.getState().removeAllIndicators();
    expect(store.getState().indicators).toEqual([]);
  });
});
