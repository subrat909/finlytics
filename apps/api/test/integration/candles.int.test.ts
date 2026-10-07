/**
 * `GET /v1/candles` and the UDF datafeed end to end (phase 1 plan "REST"; phase-1b "never serve synthetic candles"): a
 * gap is backfilled once from a (non-synthetic) source into Timescale `Candle`, then served from the database; while
 * the simulator drives the feed, paper candles are served on the fly and never stored; UDF answers in TradingView's
 * shapes.
 */
import type { PrismaClient } from "@finlytics/database";
import { CandleListSchema, UdfConfigSchema, UdfHistorySchema, UdfSymbolInfoSchema } from "@finlytics/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { paperCandles } from "../../src/feed/paper/paper-candles";
import { CANDLE_SOURCE_RESOLVER } from "../../src/modules/candles/candle-sources";
import type { CandleRequest, CandleSource, CandleSourceResolver } from "../../src/modules/candles/candle-sources";

import { createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, sessionCookie, uniqueSuffix } from "./fixtures";

/** Monday 2026-10-05, 09:15 and 10:15 IST, in epoch seconds. */
const FROM_S = Date.UTC(2026, 9, 5, 3, 45) / 1_000;
const TO_S = Date.UTC(2026, 9, 5, 4, 45) / 1_000;

describe("candles and the UDF datafeed", () => {
  let testApp: TestApp;
  let fixtures: PrismaClient;
  let cookie: string;
  const key = `NSE_EQ|CANDLE${uniqueSuffix().toUpperCase()}`;

  beforeAll(async () => {
    testApp = await createTestApp({ MARKET_FEED_SOURCE: "paper" }, { probes: false });
    fixtures = fixturesClient();
    const user = await createUser(fixtures);
    cookie = sessionCookie((await createSession(fixtures, user.id)).token);
    await fixtures.instrument.create({
      data: { key, exchange: "NSE", segment: "EQ", symbol: key.slice(7), name: "Candle Test Ltd", brokerTokens: {} },
    });
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.candle.deleteMany({ where: { instrumentKey: key } });
    await fixtures.instrument.deleteMany({ where: { key } });
    await fixtures.$disconnect();
  });

  const get = (url: string, withCookie = true) =>
    testApp.request({ method: "GET", url, headers: withCookie ? { cookie } : {} });

  const candlesUrl = (tf = "M1", from = FROM_S, to = TO_S) =>
    `/v1/candles?key=${encodeURIComponent(key)}&tf=${tf}&from=${String(from)}&to=${String(to)}`;

  it("backfills a range once from a broker source, then serves it from Timescale", async () => {
    const fetch = vi.fn((request: CandleRequest) => Promise.resolve(paperCandles(request, 1)));
    const broker: CandleSource = { name: "TEST", fetch };
    vi.spyOn(testApp.app.get<CandleSourceResolver>(CANDLE_SOURCE_RESOLVER), "forUser").mockResolvedValue(broker);

    const first = await get(candlesUrl());
    expect(first.statusCode).toBe(200);
    const bars = CandleListSchema.parse(first.json());
    expect(bars).toHaveLength(60);
    expect(bars[0]?.ts).toBe(FROM_S * 1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await fixtures.candle.count({ where: { instrumentKey: key, timeframe: "M1" } })).toBe(60);

    const second = await get(candlesUrl());
    expect(second.json()).toEqual(first.json());
    expect(fetch).toHaveBeenCalledTimes(1);

    // A wider range fetches only the uncovered part.
    const wider = await get(candlesUrl("M1", FROM_S - 3_600, TO_S));
    expect(CandleListSchema.parse(wider.json())).toHaveLength(60); // 08:15–09:15 IST is outside the session
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0].to.getTime()).toBe(FROM_S * 1_000);
  });

  it("serves synthetic candles on the fly while the simulator drives the feed, storing nothing", async () => {
    const synthetic = `NSE_EQ|SYNTH${uniqueSuffix().toUpperCase()}`;
    const url = `/v1/candles?key=${encodeURIComponent(synthetic)}&tf=M1&from=${String(FROM_S)}&to=${String(TO_S)}`;

    const first = CandleListSchema.parse((await get(url)).json());
    const second = CandleListSchema.parse((await get(url)).json());

    expect(first).toHaveLength(60);
    expect(second).toEqual(first);
    expect(await fixtures.candle.count({ where: { instrumentKey: synthetic } })).toBe(0);
  });

  it("validates the query and requires a session", async () => {
    expect((await get(candlesUrl(), false)).statusCode).toBe(401);
    const badTimeframe = await get(candlesUrl("M3"));
    expect(badTimeframe.statusCode).toBe(400);
    expect(json(badTimeframe)).toMatchObject({ code: "VALIDATION" });
    expect((await get(candlesUrl("M1", TO_S, FROM_S))).statusCode).toBe(400);
    expect((await get(candlesUrl("M1", FROM_S - 86_400 * 30, TO_S))).statusCode).toBe(400);
  });

  it("answers UDF history as parallel arrays in seconds", async () => {
    const response = await get(
      `/v1/udf/history?symbol=${encodeURIComponent(key)}&resolution=1&from=${String(FROM_S)}&to=${String(TO_S)}`,
    );
    expect(response.statusCode).toBe(200);
    const history = UdfHistorySchema.parse(response.json());
    expect(history.s).toBe("ok");
    expect(history.t).toHaveLength(60);
    expect(history.t?.[0]).toBe(FROM_S);
    for (const series of [history.o, history.h, history.l, history.c, history.v]) {
      expect(series).toHaveLength(60);
      expect(series?.every((value) => typeof value === "number")).toBe(true);
    }

    // Saturday 2026-10-03, 10:00–10:01 IST: no daily bar on a weekend.
    const saturday = Date.UTC(2026, 9, 3, 4, 30) / 1_000;
    const empty = await get(
      `/v1/udf/history?symbol=${encodeURIComponent(key)}&resolution=1D&from=${String(saturday)}&to=${String(saturday + 60)}`,
    );
    expect(empty.json()).toEqual({ s: "no_data" });
  });

  it("serves UDF config, time, symbol info and search", async () => {
    expect(UdfConfigSchema.safeParse((await get("/v1/udf/config")).json()).success).toBe(true);
    const time = (await get("/v1/udf/time")).json<number>();
    expect(Math.abs(time - Date.now() / 1_000)).toBeLessThan(60);

    const symbol = await get(`/v1/udf/symbols?symbol=${encodeURIComponent(key)}`);
    expect(symbol.statusCode).toBe(200);
    expect(UdfSymbolInfoSchema.parse(symbol.json())).toMatchObject({ ticker: key, pricescale: 100, minmov: 5 });
    expect((await get(`/v1/udf/symbols?symbol=${encodeURIComponent("NSE_EQ|NOSUCHTHING")}`)).statusCode).toBe(404);

    const search = await get(`/v1/udf/search?query=${encodeURIComponent(key.slice(7, 15))}&limit=5`);
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual([expect.objectContaining({ ticker: key, type: "stock", exchange: "NSE" })]);
  });
});
