import { describe, expect, it } from "vitest";

import {
  bucketStart,
  clampToSession,
  dayBarFromTick,
  exchangeOfKey,
  mergeTick,
  normalizeBars,
  resample,
  sessionOf,
  toBar,
} from "../lib/bars";
import type { Bar, LiveTick } from "../lib/bars";
import { logicalToTime, snapToBar, timeToLogical } from "../lib/chart/projection";
import { baselineLevel, mainPoint, plotPoint } from "../lib/chart/series-data";
import { directionOf, formatCompact, formatNumber, formatPercent, precisionOf } from "../lib/format";
import { heikinAshi } from "../lib/heikin-ashi";
import { INDICATORS } from "../lib/indicators/registry";
import { rangeStart } from "../lib/ranges";
import { screenshotFileName } from "../lib/screenshot";
import { withAlpha } from "../lib/theme-colors";
import type { ChartColors } from "../lib/theme-colors";
import {
  IST_OFFSET_S,
  dayStart,
  formatBarTime,
  formatClock,
  formatDuration,
  toChartTime,
  weekStart,
  weekdaysBack,
  yearStart,
} from "../lib/time";
import { isResampled, maxRequestSpan } from "../schemas";

/** Tuesday 2026-10-06 00:00 IST, as chart time. */
const TUE = Date.UTC(2026, 9, 6) / 1_000;
const at = (hours: number, minutes = 0) => TUE + hours * 3_600 + minutes * 60;
const NSE = sessionOf("NSE");

function bar(time: number, close: number, volume = 10): Bar {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume };
}

function tick(time: number, price: number, extra: Partial<LiveTick> = {}): LiveTick {
  return { price, time, volumeDelta: 0, dayVolume: null, dayOpen: null, dayHigh: null, dayLow: null, ...extra };
}

describe("time and sessions", () => {
  it("shifts epoch ms to IST chart seconds and finds days, weeks and years", () => {
    expect(toChartTime(Date.UTC(2026, 9, 5, 18, 30))).toBe(TUE);
    expect(IST_OFFSET_S).toBe(19_800);
    expect(dayStart(at(10, 15))).toBe(TUE);
    expect(weekStart(at(10))).toBe(TUE - 86_400);
    expect(yearStart(at(10))).toBe(Date.UTC(2026, 0, 1) / 1_000);
    expect(weekdaysBack(at(10), 4)).toBe(TUE - 6 * 86_400);
  });

  it("formats the clock, bar times and spans without Intl", () => {
    expect(formatClock(Date.UTC(2026, 9, 6, 4, 45, 32))).toBe("10:15:32");
    expect(formatBarTime(at(10, 15), true)).toBe("Tue 06 Oct '26 10:15");
    expect(formatBarTime(TUE, false)).toBe("Tue 06 Oct '26");
    expect([formatDuration(2_700), formatDuration(12_000), formatDuration(352_800), formatDuration(8_467_200)]).toEqual(
      ["45m", "3h 20m", "4d 2h", "14w"],
    );
  });

  it("reads the exchange from a key and clamps times into its session", () => {
    expect(exchangeOfKey("NSE_INDEX|NIFTY 50")).toBe("NSE");
    expect(exchangeOfKey("MCX_FO|CRUDEOIL|2026-10-19")).toBe("MCX");
    expect(exchangeOfKey("NSE_CD|USDINR|2026-10-28")).toBe("CDS");
    expect(clampToSession(at(9, 2), NSE)).toBe(at(9, 15));
    expect(clampToSession(at(15, 45), NSE)).toBe(at(15, 30) - 1);
    expect(clampToSession(at(11), NSE)).toBe(at(11));
  });
});

describe("wire bars and resampling", () => {
  it("reads wire bars and keeps one bar per time in order", () => {
    expect(
      toBar({ ts: Date.UTC(2026, 9, 6, 3, 45), open: "100.5", high: "101", low: "99.95", close: "100", volume: 12 }),
    ).toEqual({
      time: at(9, 15),
      open: 100.5,
      high: 101,
      low: 99.95,
      close: 100,
      volume: 12,
    });
    expect(normalizeBars([bar(at(10), 2), bar(at(9, 15), 1), bar(at(10), 3)]).map((item) => item.close)).toEqual([
      1, 3,
    ]);
  });

  it("knows which intervals are built in the browser and how far one request reaches", () => {
    expect(["M1", "M3", "M30", "H4", "W1"].map((interval) => isResampled(interval as "M1"))).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(maxRequestSpan("M1")).toBe(300_000);
  });

  it("builds 3-minute bars from 1-minute bars", () => {
    const source = [bar(at(9, 15), 10, 1), bar(at(9, 16), 12, 2), bar(at(9, 17), 11, 3), bar(at(9, 18), 13, 4)];
    expect(resample(source, "M3", NSE)).toEqual([
      { time: at(9, 15), open: 9, high: 13, low: 8, close: 11, volume: 6 },
      { time: at(9, 18), open: 12, high: 14, low: 11, close: 13, volume: 4 },
    ]);
  });

  it("anchors 30-minute and 4-hour bars to the session open (09:15)", () => {
    const quarter = [bar(at(9, 15), 1), bar(at(9, 30), 2), bar(at(9, 45), 3)];
    expect(resample(quarter, "M30", NSE).map((item) => item.time)).toEqual([at(9, 15), at(9, 45)]);
    // Hour bars stamped on the IST hour (09:00 holds 09:15–10:00) count from the open.
    const hours = [9, 10, 11, 12, 13, 14, 15].map((hour) => bar(at(hour), hour));
    const fourHours = resample(hours, "H4", NSE);
    expect(fourHours.map((item) => [item.time, item.volume])).toEqual([
      [at(9, 15), 50],
      [at(13, 15), 20],
    ]);
    expect(bucketStart(at(10, 20), "M30", NSE.open)).toBe(at(10, 15));
  });

  it("builds weekly bars from Monday", () => {
    const days = [0, 1, 2, 3, 4, 7].map((offset) => bar(weekStart(TUE) + offset * 86_400, offset + 10));
    expect(resample(days, "W1", NSE).map((item) => [item.time, item.close])).toEqual([
      [weekStart(TUE), 14],
      [weekStart(TUE) + 7 * 86_400, 17],
    ]);
  });

  it("turns bars into Heikin Ashi bars", () => {
    expect(
      heikinAshi([
        { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 0 },
        { time: 2, open: 11, high: 13, low: 10, close: 12, volume: 0 },
      ]),
    ).toEqual([
      { time: 1, open: 10.5, high: 12, low: 9, close: 10.5, volume: 0 },
      { time: 2, open: 10.5, high: 13, low: 10, close: 11.5, volume: 0 },
    ]);
  });
});

describe("mergeTick", () => {
  const last = { time: at(10), open: 100, high: 105, low: 99, close: 101, volume: 50 };

  it("updates the forming bar, opens the next bucket in the server's phase and ignores older ticks", () => {
    expect(mergeTick([last], tick(at(10, 2), 106, { volumeDelta: 5 }), { interval: "M5", session: NSE })).toEqual({
      bar: { ...last, high: 106, close: 106, volume: 55 },
      replace: true,
    });
    expect(mergeTick([last], tick(at(10, 7), 98, { volumeDelta: 3 }), { interval: "M5", session: NSE })).toEqual({
      bar: { time: at(10, 5), open: 98, high: 98, low: 98, close: 98, volume: 3 },
      replace: false,
    });
    expect(mergeTick([last], tick(at(9, 58), 1), { interval: "M5", session: NSE })).toBeNull();
    const phased = { ...last, time: at(10, 15) };
    expect(mergeTick([phased], tick(at(11, 20), 1), { interval: "H1", session: NSE })?.bar.time).toBe(at(11, 15));
  });

  it("counts post-close ticks in the session's last bar and resampled ticks in session buckets", () => {
    expect(mergeTick([], tick(at(15, 45), 7), { interval: "M1", session: NSE })?.bar.time).toBe(at(15, 29));
    expect(mergeTick([], tick(at(10, 20), 7), { interval: "M30", session: NSE })?.bar.time).toBe(at(10, 15));
  });

  it("builds today's daily bar from the exchange's day values", () => {
    const update = mergeTick(
      [bar(TUE - 86_400, 90)],
      tick(at(11), 101, { dayOpen: 95, dayHigh: 104, dayLow: 94, dayVolume: 900 }),
      {
        interval: "D1",
        session: NSE,
      },
    );
    expect(update).toEqual({
      bar: { time: TUE, open: 95, high: 104, low: 94, close: 101, volume: 900 },
      replace: false,
      liveDay: { time: TUE, open: 95, high: 104, low: 94, close: 101, volume: 900 },
    });
    expect(dayBarFromTick(update?.liveDay, tick(at(11, 1), 106, { volumeDelta: 4 }))).toMatchObject({
      open: 95,
      high: 106,
      close: 106,
      volume: 904,
    });
  });

  it("builds the weekly bar from the week's completed days plus today", () => {
    const monday = weekStart(TUE);
    const dailySource = [{ time: monday, open: 80, high: 90, low: 79, close: 88, volume: 100 }];
    const update = mergeTick(
      [{ ...dailySource[0], time: monday } as Bar],
      tick(at(11), 92, { dayOpen: 89, dayHigh: 93, dayLow: 87, dayVolume: 40 }),
      { interval: "W1", session: NSE, dailySource },
    );
    expect(update?.replace).toBe(true);
    expect(update?.bar).toEqual({ time: monday, open: 80, high: 93, low: 79, close: 92, volume: 140 });
  });
});

describe("projection and series data", () => {
  const bars = [bar(0, 1), bar(60, 2), bar(120, 3)];

  it("maps times to logical indexes, interpolating gaps and extrapolating past the ends", () => {
    expect([60, 90, 180, -60].map((time) => timeToLogical(bars, 60, time))).toEqual([1, 1.5, 3, -1]);
    expect([2.4, 4, -2].map((logical) => logicalToTime(bars, 60, logical))).toEqual([120, 240, -120]);
    expect(timeToLogical([], 60, 0)).toBeNull();
    expect(snapToBar(bars[1], 2.6)).toBe(3);
  });

  const colors = { up: "#047857", down: "#be123c", upVolume: "u", downVolume: "d" } as ChartColors;

  it("draws hollow candles hollow on up closes, coloured by the previous close", () => {
    expect(mainPoint("hollow", bar(60, 2), bar(0, 1), colors)).toMatchObject({
      color: "transparent",
      borderColor: colors.up,
    });
    expect(mainPoint("line", bar(60, 2), undefined, colors)).toEqual({ time: 60, value: 2 });
    expect(baselineLevel(bars)).toBe(2);
  });

  it("colours volume by direction and MACD by sign, with whitespace for missing values", () => {
    const [volume] = INDICATORS.volume.plots;
    const [histogram] = INDICATORS.macd.plots;
    if (volume === undefined || histogram === undefined) throw new Error("plots");
    expect(plotPoint(volume, bar(0, 5), 5, colors, "x")).toEqual({ time: 0, value: 5, color: "u" });
    expect(plotPoint(histogram, bar(0, 5), -1, colors, "x")).toEqual({
      time: 0,
      value: -1,
      color: withAlpha("#be123c", 0.6),
    });
    expect(plotPoint(histogram, bar(0, 5), null, colors, "x")).toEqual({ time: 0 });
  });
});

describe("ranges, formatting and file names", () => {
  it("starts each range from the latest bar", () => {
    const last = at(15, 25);
    expect(rangeStart("1D", last)).toBe(TUE);
    expect(rangeStart("5D", last)).toBe(TUE - 6 * 86_400);
    expect(rangeStart("1M", last)).toBe(TUE - 30 * 86_400);
    expect(rangeStart("YTD", last)).toBe(Date.UTC(2026, 0, 1) / 1_000);
    expect(rangeStart("ALL", last)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("formats prices with Indian grouping, compact volumes and tick-size precision", () => {
    expect(formatNumber(1_234_567.891)).toBe("12,34,567.89");
    expect(formatNumber(-3.05, 2, "always")).toBe("-3.05");
    expect(formatNumber(0.001, 2, "always")).toBe("0.00");
    expect(formatPercent(0.523)).toBe("+0.52%");
    expect(formatCompact(1_230_000)).toBe("12.3 L");
    expect(formatCompact(45_600_000)).toBe("4.56 Cr");
    expect(formatCompact(null)).toBe("—");
    expect([precisionOf("0.05"), precisionOf("0.0025"), precisionOf(undefined)]).toEqual([2, 4, 2]);
    expect(directionOf(-1)).toBe("down");
    expect(screenshotFileName({ symbol: "NIFTY 50", interval: "5m", bar: null }, at(10, 15))).toBe(
      "NIFTY-50_5m_2026-10-06_1015.png",
    );
  });
});
