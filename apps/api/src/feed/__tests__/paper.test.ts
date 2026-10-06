import type { Tick } from "@finlytics/broker-sdk";
import { CandleSchema, TickSchema } from "@finlytics/broker-sdk";
import { isOnTick } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { alignToBar, isIstWeekday, isMarketOpen, istDayStart, sessionBounds } from "../market-hours";
import { paperCandles } from "../paper/paper-candles";
import { PaperSimulatorFeed } from "../paper/paper-simulator-feed";
import { anchorPrice, basePrice, hashString, mulberry32, PriceWalk, toPaperPrice } from "../paper/price-model";

const RELIANCE = "NSE_EQ|RELIANCE" as InstrumentKey;
const NIFTY = "NSE_INDEX|NIFTY 50" as InstrumentKey;
const OPTION = "NSE_FO|NIFTY|2026-10-27|24000|CE" as InstrumentKey;

/** Tuesday 2026-10-06 10:00 IST. */
const TUESDAY_10_IST = Date.UTC(2026, 9, 6, 4, 30);

describe("market hours", () => {
  it("opens NSE 09:15–15:30 IST on weekdays only", () => {
    expect(isMarketOpen("NSE", TUESDAY_10_IST)).toBe(true);
    expect(isMarketOpen("NSE", Date.UTC(2026, 9, 6, 3, 44))).toBe(false); // 09:14 IST
    expect(isMarketOpen("NSE", Date.UTC(2026, 9, 6, 10, 0))).toBe(false); // 15:30 IST
    expect(isMarketOpen("NSE", Date.UTC(2026, 9, 4, 4, 30))).toBe(false); // Sunday
    expect(isMarketOpen("MCX", Date.UTC(2026, 9, 6, 17, 0))).toBe(true); // 22:30 IST
  });

  it("aligns bars to IST midnight", () => {
    expect(istDayStart(TUESDAY_10_IST)).toBe(Date.UTC(2026, 9, 5, 18, 30));
    expect(alignToBar(TUESDAY_10_IST + 59_000, 60_000)).toBe(TUESDAY_10_IST);
    expect(alignToBar(TUESDAY_10_IST, 86_400_000)).toBe(Date.UTC(2026, 9, 5, 18, 30));
    expect(isIstWeekday(Date.UTC(2026, 9, 3, 20, 0))).toBe(false); // Sunday 01:30 IST
    expect(sessionBounds("NSE", TUESDAY_10_IST).open).toBe(Date.UTC(2026, 9, 6, 3, 45));
  });
});

describe("paper price model", () => {
  it("is deterministic for a seed and differs between keys", () => {
    expect(hashString("a")).toBe(hashString("a"));
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(basePrice(NIFTY)).toBe(24_000);
    expect(basePrice(RELIANCE)).not.toBe(basePrice("NSE_EQ|TCS"));
    expect(basePrice(OPTION)).toBeGreaterThan(0);
    expect(basePrice("NSE_FO|NIFTY|2026-10-27")).toBeCloseTo(24_072, 0);
    expect(() => basePrice("nope")).toThrow(TypeError);
  });

  it("walks on the 0.05 tick, never below one tick", () => {
    const walk = new PriceWalk(RELIANCE, 7);
    const again = new PriceWalk(RELIANCE, 7);
    for (let step = 0; step < 200; step += 1) {
      expect(walk.step()).toBe(again.step());
      expect(isOnTick(walk.ltp, "0.05")).toBe(true);
    }
    expect(Number(walk.high)).toBeGreaterThanOrEqual(Number(walk.low));
    expect(walk.volume).toBeGreaterThan(0);
    expect(toPaperPrice(-3)).toBe("0.05");
    expect(toPaperPrice(0.01)).toBe("0.05");
  });

  it("gives smooth anchor prices", () => {
    const now = anchorPrice(NIFTY, 1, TUESDAY_10_IST);
    const minuteLater = anchorPrice(NIFTY, 1, TUESDAY_10_IST + 60_000);
    expect(Math.abs(now - minuteLater) / now).toBeLessThan(0.001);
  });
});

describe("paperCandles", () => {
  const query = {
    instrumentKey: RELIANCE,
    timeframe: "M1" as const,
    from: new Date(Date.UTC(2026, 9, 6, 3, 0)), // 08:30 IST
    to: new Date(Date.UTC(2026, 9, 6, 4, 45)), // 10:15 IST
  };

  it("returns valid bars inside the session, the same every time", () => {
    const candles = paperCandles(query, 1);

    expect(candles).toHaveLength(60); // 09:15–10:15
    expect(candles[0]?.ts).toBe(Date.UTC(2026, 9, 6, 3, 45));
    for (const candle of candles) expect(CandleSchema.safeParse(candle).success).toBe(true);
    expect(paperCandles(query, 1)).toEqual(candles);
    expect(paperCandles(query, 2)).not.toEqual(candles);
  });

  it("skips weekends for daily bars and starts at the first whole bar", () => {
    const candles = paperCandles(
      {
        instrumentKey: NIFTY,
        timeframe: "D1",
        from: new Date(Date.UTC(2026, 9, 2, 18, 31)), // just after Saturday 00:00 IST
        to: new Date(Date.UTC(2026, 9, 9, 18, 30)),
      },
      1,
    );
    expect(candles.map((candle) => new Date(candle.ts).toISOString())).toEqual([
      "2026-10-04T18:30:00.000Z",
      "2026-10-05T18:30:00.000Z",
      "2026-10-06T18:30:00.000Z",
      "2026-10-07T18:30:00.000Z",
      "2026-10-08T18:30:00.000Z",
    ]);
  });
});

describe("PaperSimulatorFeed", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a snapshot on subscribe, then ticks every interval while subscribed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TUESDAY_10_IST);
    const feed = new PaperSimulatorFeed({ seed: 1, tickMs: 100, alwaysOn: false });
    const ticks: Tick[] = [];
    feed.on("tick", (tick) => ticks.push(tick));

    await feed.subscribe([RELIANCE], "quote");
    expect(ticks).toHaveLength(1);
    expect(TickSchema.safeParse(ticks[0]).success).toBe(true);
    expect(ticks[0]?.close).toBeDefined();

    await vi.advanceTimersByTimeAsync(350);
    expect(ticks).toHaveLength(4);
    expect([...feed.subscriptions().keys()]).toEqual([RELIANCE]);

    await feed.unsubscribe([RELIANCE]);
    await vi.advanceTimersByTimeAsync(300);
    expect(ticks).toHaveLength(4);
    await feed.close();
  });

  it("stays quiet outside market hours unless always on", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 4, 4, 30)); // Sunday
    const closedHours = new PaperSimulatorFeed({ seed: 1, tickMs: 100, alwaysOn: false });
    const alwaysOn = new PaperSimulatorFeed({ seed: 1, tickMs: 100, alwaysOn: true });
    let quiet = 0;
    let busy = 0;
    closedHours.on("tick", () => (quiet += 1));
    alwaysOn.on("tick", () => (busy += 1));
    await closedHours.subscribe([RELIANCE], "ltp");
    await alwaysOn.subscribe([RELIANCE], "ltp");

    await vi.advanceTimersByTimeAsync(500);

    expect(quiet).toBe(1); // the snapshot only
    expect(busy).toBe(6);
    await closedHours.close();
    await alwaysOn.close();
  });

  it("reports closed and refuses new subscriptions once closed", async () => {
    const feed = new PaperSimulatorFeed({ seed: 1, tickMs: 1_000, alwaysOn: true });
    const statuses: string[] = [];
    feed.on("status", (status) => statuses.push(status));
    expect(feed.status).toBe("up");

    await feed.close();
    await feed.close();

    expect(statuses).toEqual(["closed"]);
    expect(feed.status).toBe("closed");
    await expect(feed.subscribe([RELIANCE], "ltp")).rejects.toThrow(/closed/);
  });
});
