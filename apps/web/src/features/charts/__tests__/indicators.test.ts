import { describe, expect, it } from "vitest";

import type { Bar } from "../lib/bars";
import { ema, highest, lowest, rma, sma, source, stdev, trueRange, wma } from "../lib/indicators/core";
import { adx, atr, macd, obv, rsi, stochastic } from "../lib/indicators/oscillators";
import { bollinger, donchian, parabolicSar, supertrend, vwap } from "../lib/indicators/overlays";
import {
  INDICATORS,
  INDICATOR_LIST,
  createInstance,
  describeInputs,
  placementOf,
  sanitizeInputs,
  sanitizeInstance,
} from "../lib/indicators/registry";

const DAY = Date.UTC(2026, 9, 6) / 1_000;

function bar(time: number, open: number, high: number, low: number, close: number, volume = 0): Bar {
  return { time, open, high, low, close, volume };
}

/** Four bars with known true ranges (2, 2, 3, 3) and closes 9, 10, 12, 10. */
const BARS = [
  bar(DAY + 33_300, 9, 10, 8, 9, 100),
  bar(DAY + 33_360, 9, 11, 9, 10, 200),
  bar(DAY + 33_420, 10, 13, 10, 12, 300),
  bar(DAY + 33_480, 12, 12, 9, 10, 400),
];

/** A steady climb: highs and lows up by 1 every bar, the range always 2. */
const RISING = Array.from({ length: 12 }, (_, index) =>
  bar(DAY + index * 60, index + 1, index + 2, index, index + 1, 10),
);

function rounded(values: readonly (number | null)[], digits = 4): (number | null)[] {
  return values.map((value) => (value === null ? null : Number(value.toFixed(digits))));
}

describe("moving averages", () => {
  it("computes the simple, exponential, Wilder and weighted averages like TradingView's ta.*", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([2, 4, 6, 8, 4], 2)).toEqual([null, 3, 5, 7, 5]);
    expect(rma([2, 4, 6, 8, 4], 2)).toEqual([null, 3, 4.5, 6.25, 5.125]);
    expect(rounded(wma([1, 2, 3, 4], 3))).toEqual([null, null, 2.3333, 3.3333]);
  });

  it("restarts its window after a missing value, so derived series warm up after their source", () => {
    expect(sma([null, 1, 2, 3], 2)).toEqual([null, null, 1.5, 2.5]);
    expect(ema([null, null, 2, 4], 2)).toEqual([null, null, null, 3]);
  });

  it("measures the window's population deviation and extremes", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9], 8).at(-1)).toBe(2);
    expect(highest([1, 3, 2, 5], 2)).toEqual([null, 3, 3, 5]);
    expect(lowest([1, 3, 2, 5], 2)).toEqual([null, 1, 2, 2]);
  });

  it("reads price sources and true range", () => {
    expect(source(BARS.slice(0, 1), "hlc3")).toEqual([9]);
    expect(source(BARS.slice(0, 1), "ohlc4")).toEqual([9]);
    expect(trueRange(BARS)).toEqual([2, 2, 3, 3]);
  });
});

describe("oscillators", () => {
  it("RSI: Wilder's smoothing, 100 with no losses", () => {
    expect(rsi([1, 2, 3, 2, 1], 2)).toEqual([null, null, 100, 50, 25]);
    expect(rsi([1, 2, 3, 4], 2).at(-1)).toBe(100);
  });

  it("MACD: line, signal and histogram", () => {
    const result = macd([2, 4, 6, 8, 4], 1, 2, 2);
    expect(result.macd).toEqual([null, 1, 1, 1, -1]);
    expect(rounded(result.signal)).toEqual([null, null, 1, 1, -0.3333]);
    expect(rounded(result.histogram)).toEqual([null, null, 0, 0, -0.6667]);
  });

  it("ATR and Stochastic on known bars", () => {
    expect(atr(BARS, 2)).toEqual([null, 2, 2.5, 2.75]);
    const stoch = stochastic(BARS, 2, 1, 2);
    expect(rounded(stoch.k)).toEqual([null, 66.6667, 75, 25]);
    expect(rounded(stoch.d)).toEqual([null, null, 70.8333, 50]);
  });

  it("ADX reaches 100 in a one-way trend, with +DI above −DI", () => {
    const result = adx(RISING, 2, 2);
    expect(result.plus.at(-1)).toBe(50);
    expect(result.minus.at(-1)).toBe(0);
    expect(result.adx.slice(0, 3)).toEqual([null, null, null]);
    expect(result.adx.at(-1)).toBe(100);
  });

  it("OBV adds volume on up closes and subtracts it on down closes", () => {
    expect(obv(BARS)).toEqual([0, 200, 500, 100]);
  });
});

describe("overlays", () => {
  it("VWAP restarts every IST day and is undefined without volume", () => {
    const nextDay = bar(DAY + 86_400 + 33_300, 20, 21, 19, 20, 50);
    expect(rounded(vwap([...BARS.slice(0, 2), nextDay]))).toEqual([9, 9.6667, 20]);
    expect(vwap([bar(DAY, 1, 2, 0, 1, 0)])).toEqual([null]);
  });

  it("Bollinger Bands and Donchian channels", () => {
    const bands = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect([bands.basis.at(-1), bands.upper.at(-1), bands.lower.at(-1)]).toEqual([5, 9, 1]);
    const channel = donchian(BARS, 2);
    expect(channel.upper).toEqual([null, 11, 13, 13]);
    expect(channel.lower).toEqual([null, 8, 9, 9]);
    expect(channel.basis).toEqual([null, 9.5, 11, 11]);
  });

  it("SuperTrend starts down and flips up once the close clears the band", () => {
    const result = supertrend(RISING, 2, 1);
    expect(result.down.slice(0, 5)).toEqual([null, 4, 4, 4, null]);
    expect(result.up.slice(0, 6)).toEqual([null, null, null, null, 3, 4]);
    expect(result.direction.at(-1)).toBe(-1);
  });

  it("Parabolic SAR trails below a rising market", () => {
    const sar = parabolicSar(RISING, 0.02, 0.02, 0.2);
    expect(sar[0]).toBeNull();
    expect(sar[1]).toBe(0);
    expect(sar[3]).toBeCloseTo(0.16);
    RISING.forEach((item, index) => {
      if (index > 0) expect(sar[index] ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(item.low);
    });
  });
});

describe("indicator registry", () => {
  it("computes every catalogue entry over the bars, one value per bar and plot", () => {
    for (const definition of INDICATOR_LIST) {
      const instance = createInstance(definition.kind);
      const values = definition.compute(RISING, instance.inputs);
      for (const plot of definition.plots) expect(values[plot.key]).toHaveLength(RISING.length);
    }
  });

  it("sanitises inputs: defaults fill in, numbers clamp and round, unknown keys go", () => {
    expect(sanitizeInputs("sma", { length: 9_999, source: "hlc3", extra: 1 })).toEqual({ length: 500, source: "hlc3" });
    expect(sanitizeInputs("bb", { length: 2.6, mult: "x" })).toEqual({ length: 3, mult: 2, source: "close" });
    expect(sanitizeInstance({ id: "x", kind: "nope", inputs: {}, styles: {}, hidden: false })).toBeUndefined();
    expect(
      sanitizeInstance({
        id: "r",
        kind: "rsi",
        inputs: { length: 0 },
        styles: { value: { color: "loss", width: 9 } },
        hidden: true,
      }),
    ).toEqual({
      id: "r",
      kind: "rsi",
      inputs: { length: 1, source: "close" },
      styles: { value: { color: "loss", width: 1 } },
      hidden: true,
    });
  });

  it("places overlays on the price pane, oscillators in panes, volume at the bottom unless asked", () => {
    expect(placementOf(createInstance("ema"))).toBe("overlay");
    expect(placementOf(createInstance("macd"))).toBe("pane");
    expect(placementOf(createInstance("volume"))).toBe("volume");
    expect(placementOf({ kind: "volume", inputs: { separatePane: true } })).toBe("pane");
    expect(describeInputs(createInstance("macd"))).toBe("12 26 9 close");
    expect(INDICATORS.rsi.levels).toEqual([70, 50, 30]);
  });
});
