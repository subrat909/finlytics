import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { advancedChartsDatafeed } from "../advanced-charts";
import { distanceToSegment, fibLevels, hitTest, rangeStats, rayEnd, textBox } from "../lib/drawings/geometry";
import { HISTORY_LIMIT, canRedo, canUndo, commit, initHistory, redo, undo } from "../lib/drawings/history";
import type { Drawing } from "../lib/drawings/types";
import {
  MAX_DRAWINGS,
  defaultLayout,
  drawingsKey,
  layoutKey,
  loadDrawings,
  loadLayout,
  saveDrawings,
  saveLayout,
} from "../lib/storage";
import type { KeyValueStore } from "../lib/storage";

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const KEY = "NSE_INDEX|NIFTY 50";
const TREND: Drawing = {
  id: "d1",
  kind: "trend",
  color: "primary",
  points: [
    { time: 100, price: 24_000 },
    { time: 400, price: 24_100 },
  ],
};
const HLINE: Drawing = { id: "d2", kind: "hline", color: "info", points: [{ time: 100, price: 24_050 }] };

describe("drawing history", () => {
  it("commits, undoes and redoes, dropping the redo stack on a new change", () => {
    let history = initHistory([]);
    expect(canUndo(history)).toBe(false);
    history = commit(history, [TREND]);
    history = commit(history, [TREND, HLINE]);
    history = undo(history);
    expect(history.present).toEqual([TREND]);
    expect(canRedo(history)).toBe(true);
    history = redo(history);
    expect(history.present).toEqual([TREND, HLINE]);
    history = undo(undo(history));
    expect(history.present).toEqual([]);
    expect(undo(history)).toBe(history);
    history = commit(history, [HLINE]);
    expect(canRedo(history)).toBe(false);
  });

  it("keeps at most the last HISTORY_LIMIT steps and ignores a no-op commit", () => {
    let history = initHistory([]);
    for (let step = 0; step < HISTORY_LIMIT + 20; step += 1)
      history = commit(history, [{ ...HLINE, id: String(step) }]);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(commit(history, history.present)).toBe(history);
  });
});

describe("drawing persistence", () => {
  it("saves drawings per instrument and reads them back", () => {
    const storage = memoryStorage();
    saveDrawings(KEY, [TREND, HLINE], storage);
    expect(storage.data.has(drawingsKey(KEY))).toBe(true);
    expect(loadDrawings(KEY, storage)).toEqual([TREND, HLINE]);
    expect(loadDrawings("NSE_EQ|RELIANCE", storage)).toEqual([]);
    saveDrawings(KEY, [], storage);
    expect(storage.data.has(drawingsKey(KEY))).toBe(false);
  });

  it("skips invalid entries, reads another version or broken JSON as nothing, and survives a full storage", () => {
    const storage = memoryStorage();
    storage.setItem(
      drawingsKey(KEY),
      JSON.stringify({ v: 1, drawings: [TREND, { ...HLINE, points: [] }, { id: "x", kind: "circle" }] }),
    );
    expect(loadDrawings(KEY, storage)).toEqual([TREND]);
    storage.setItem(drawingsKey(KEY), JSON.stringify({ v: 2, drawings: [TREND] }));
    expect(loadDrawings(KEY, storage)).toEqual([]);
    storage.setItem(drawingsKey(KEY), "{oops");
    expect(loadDrawings(KEY, storage)).toEqual([]);
    const full: KeyValueStore = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => {
      saveDrawings(KEY, [TREND], full);
    }).not.toThrow();
    expect(loadDrawings(KEY, undefined)).toEqual([]);
  });

  it("keeps the newest MAX_DRAWINGS", () => {
    const storage = memoryStorage();
    const many = Array.from({ length: MAX_DRAWINGS + 5 }, (_, index) => ({ ...HLINE, id: `h${String(index)}` }));
    saveDrawings(KEY, many, storage);
    const loaded = loadDrawings(KEY, storage);
    expect(loaded).toHaveLength(MAX_DRAWINGS);
    expect(loaded.at(-1)?.id).toBe(`h${String(MAX_DRAWINGS + 4)}`);
  });
});

describe("layout persistence", () => {
  it("defaults to 5m candles with volume, per user", () => {
    const layout = loadLayout("user-1", memoryStorage());
    expect(layout).toEqual(defaultLayout());
    expect(layout.indicators.map((instance) => instance.kind)).toEqual(["volume"]);
    expect(layoutKey("user-1")).not.toBe(layoutKey("user-2"));
  });

  it("round-trips, and repairs field by field", () => {
    const storage = memoryStorage();
    const layout = { ...defaultLayout(), interval: "H4" as const, chartType: "heikin-ashi" as const, panelOpen: false };
    saveLayout("user-1", layout, storage);
    expect(loadLayout("user-1", storage)).toEqual(layout);
    expect(loadLayout("user-2", storage)).toEqual(defaultLayout());

    storage.setItem(
      layoutKey("user-1"),
      JSON.stringify({
        v: 1,
        interval: "M7",
        chartType: "renko",
        scaleMode: "log",
        autoScale: "yes",
        settings: { gridVertical: false, crosshair: "laser" },
        panelOpen: true,
        indicators: [
          { id: "a", kind: "ema", inputs: { length: 50 }, styles: {}, hidden: false },
          { id: "a", kind: "rsi", inputs: {}, styles: {}, hidden: false },
          { id: "b", kind: "unknown", inputs: {}, styles: {}, hidden: false },
        ],
      }),
    );
    const repaired = loadLayout("user-1", storage);
    expect(repaired.interval).toBe("M5");
    expect(repaired.chartType).toBe("candles");
    expect(repaired.scaleMode).toBe("log");
    expect(repaired.autoScale).toBe(true);
    expect(repaired.settings).toEqual(defaultLayout().settings);
    expect(repaired.indicators.map((instance) => [instance.id, instance.kind, instance.inputs["length"]])).toEqual([
      ["a", "ema", 50],
    ]);
  });
});

describe("drawing geometry", () => {
  const size = { width: 800, height: 400 };

  it("measures distances and where a ray leaves the pane", () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
    expect(rayEnd({ x: 100, y: 200 }, { x: 200, y: 100 }, size)).toEqual({ x: 300, y: 0 });
  });

  it("hits handles before bodies, lines within the tolerance, and boxes inside", () => {
    const points = [
      { x: 100, y: 100 },
      { x: 300, y: 300 },
    ];
    expect(hitTest(TREND, points, { x: 101, y: 102 }, size)).toEqual({ handle: 0, distance: 0 });
    expect(hitTest(TREND, points, { x: 200, y: 204 }, size)?.handle).toBeNull();
    expect(hitTest(TREND, points, { x: 200, y: 240 }, size)).toBeNull();
    expect(hitTest({ kind: "hline" }, [{ x: 50, y: 120 }], { x: 700, y: 124 }, size)?.handle).toBeNull();
    expect(hitTest({ kind: "hray" }, [{ x: 500, y: 120 }], { x: 100, y: 120 }, size)).toBeNull();
    expect(hitTest({ kind: "rect" }, points, { x: 200, y: 150 }, size)).not.toBeNull();
    expect(hitTest({ kind: "text", text: "Breakout" }, [{ x: 10, y: 50 }], { x: 40, y: 52 }, size)).not.toBeNull();
    expect(textBox({ x: 0, y: 0 }, "").right).toBe(24);
  });

  it("computes Fibonacci levels from the second point (0) to the first (1) and price-range statistics", () => {
    const levels = fibLevels({ time: 0, price: 100 }, { time: 60, price: 200 });
    expect(levels.map((level) => [level.level, Number(level.price.toFixed(1))])).toEqual([
      [0, 200],
      [0.236, 176.4],
      [0.382, 161.8],
      [0.5, 150],
      [0.618, 138.2],
      [0.786, 121.4],
      [1, 100],
    ]);
    expect(rangeStats({ time: 0, price: 200 }, { time: 3_600, price: 210 }, 12)).toEqual({
      change: 10,
      percent: 5,
      bars: 12,
      seconds: 3_600,
    });
  });
});

describe("advancedChartsDatafeed", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function file(relative: string) {
    if (dir === undefined) throw new Error("no dir");
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "");
  }

  it("is undefined without the library or its UDF datafeed, and finds the datafeed next to or inside it", () => {
    dir = mkdtempSync(path.join(tmpdir(), "tv-"));
    expect(advancedChartsDatafeed(dir)).toBeUndefined();
    file("charting_library/charting_library.js");
    expect(advancedChartsDatafeed(dir)).toBeUndefined();
    file("datafeeds/udf/dist/bundle.js");
    expect(advancedChartsDatafeed(dir)).toBe("/datafeeds/udf/dist/bundle.js");
    file("charting_library/datafeeds/udf/dist/bundle.js");
    expect(advancedChartsDatafeed(dir)).toBe("/charting_library/datafeeds/udf/dist/bundle.js");
  });

  it("looks in the app's public folder by default", () => {
    expect(advancedChartsDatafeed()).toBeUndefined();
  });
});
