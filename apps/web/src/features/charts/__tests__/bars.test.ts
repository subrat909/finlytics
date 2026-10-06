import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { advancedChartsDatafeed } from "../advanced-charts";
import { IST_OFFSET_S, candleRange, nextBar, tickTime, toBar } from "../lib/bars";
import { withAlpha } from "../lib/theme-colors";

describe("toBar", () => {
  it("reads a wire bar into IST-shifted seconds and numbers", () => {
    expect(
      toBar({ ts: 1_759_895_100_000, open: "100.5", high: "101", low: "99.95", close: "100", volume: 1200 }),
    ).toEqual({ time: 1_759_895_100 + IST_OFFSET_S, open: 100.5, high: 101, low: 99.95, close: 100, volume: 1200 });
  });
});

describe("nextBar", () => {
  const last = { time: 1_000 * 300, open: 10, high: 12, low: 9, close: 11, volume: 50 };

  it("updates the forming bar with a tick inside its period", () => {
    expect(nextBar(last, 13, last.time + 120, 300, 5)).toEqual({ ...last, high: 13, close: 13, volume: 55 });
    expect(nextBar(last, 8, last.time + 299, 300)).toEqual({ ...last, low: 8, close: 8 });
  });

  it("opens the next bar in the server's phase", () => {
    expect(nextBar(last, 14, last.time + 300 * 2 + 10, 300, 3)).toEqual({
      time: last.time + 600,
      open: 14,
      high: 14,
      low: 14,
      close: 14,
      volume: 3,
    });
  });

  it("ignores ticks older than the last bar and starts from nothing on a fresh chart", () => {
    expect(nextBar(last, 1, last.time - 1, 300)).toBe(last);
    expect(nextBar(undefined, 5, 1_000_123, 60)).toEqual({
      time: 1_000_080,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
      volume: 0,
    });
  });

  it("converts tick time and ranges", () => {
    expect(tickTime({ ts: 1_759_895_100_999 })).toBe(1_759_895_100 + IST_OFFSET_S);
    expect(candleRange(2, 1_000_000_000)).toEqual({ from: 1_000_000 - 172_800, to: 1_000_000 });
  });
});

describe("withAlpha", () => {
  it("turns a token hex into rgba, and leaves anything else alone", () => {
    expect(withAlpha("#047857", 0.35)).toBe("rgba(4, 120, 87, 0.35)");
    expect(withAlpha("var(--x)", 0.5)).toBe("var(--x)");
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

  it("is undefined without the library, or without its UDF datafeed", () => {
    dir = mkdtempSync(path.join(tmpdir(), "tv-"));
    expect(advancedChartsDatafeed(dir)).toBeUndefined();
    file("charting_library/charting_library.js");
    expect(advancedChartsDatafeed(dir)).toBeUndefined();
  });

  it("finds the datafeed next to or inside the library", () => {
    dir = mkdtempSync(path.join(tmpdir(), "tv-"));
    file("charting_library/charting_library.js");
    file("datafeeds/udf/dist/bundle.js");
    expect(advancedChartsDatafeed(dir)).toBe("/datafeeds/udf/dist/bundle.js");
    file("charting_library/datafeeds/udf/dist/bundle.js");
    expect(advancedChartsDatafeed(dir)).toBe("/charting_library/datafeeds/udf/dist/bundle.js");
  });

  it("looks in the app's public folder by default", () => {
    expect(advancedChartsDatafeed()).toBeUndefined();
  });
});
