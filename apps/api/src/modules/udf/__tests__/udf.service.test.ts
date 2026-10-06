import { UdfConfigSchema, UdfHistorySchema, UdfSymbolInfoSchema } from "@finlytics/shared";
import type { CandleBar, InstrumentKey } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../../../common/problem-json/domain-errors";
import type { CandlesService } from "../../candles/candles.service";
import type { UdfInstrumentRow, UdfRepository } from "../udf.repository";
import { priceFormat, symbolInfo, UdfService } from "../udf.service";

const KEY = "NSE_EQ|RELIANCE" as InstrumentKey;
const ROW: UdfInstrumentRow = {
  key: KEY,
  exchange: "NSE",
  segment: "EQ",
  symbol: "RELIANCE",
  name: "Reliance Industries",
  tickSize: { toFixed: () => "0.05" },
};
const NOW = Date.UTC(2026, 9, 6, 12, 0);

function setup(bars: CandleBar[] = []) {
  const repository = {
    findActive: vi.fn((key: string) => Promise.resolve(key === KEY ? ROW : null)),
    search: vi.fn(() => Promise.resolve([ROW])),
  };
  const candles = { list: vi.fn(() => Promise.resolve(bars)) };
  const service = new UdfService(repository as unknown as UdfRepository, candles as unknown as CandlesService, {
    now: () => new Date(NOW),
  });
  return { service, repository, candles };
}

const bar = (ts: number): CandleBar => ({ ts, open: "1.5", high: "2", low: "1", close: "1.75", volume: 7 });

describe("UdfService", () => {
  it("describes the datafeed and the server time", () => {
    const { service } = setup();
    expect(UdfConfigSchema.safeParse(service.config()).success).toBe(true);
    expect(service.config().supported_resolutions).toEqual(["1", "5", "15", "60", "1D"]);
    expect(service.time()).toBe(NOW / 1_000);
  });

  it("resolves a symbol from the instrument master, or 404", async () => {
    const { service } = setup();
    const info = await service.symbol(KEY);

    expect(UdfSymbolInfoSchema.safeParse(info).success).toBe(true);
    expect(info).toMatchObject({ ticker: KEY, session: "0915-1530", minmov: 5, pricescale: 100, type: "stock" });
    await expect(service.symbol("NSE_EQ|NOPE" as InstrumentKey)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("derives minmov and pricescale from the tick size", () => {
    expect(priceFormat({ toFixed: () => "0.05" })).toEqual({ minmov: 5, pricescale: 100 });
    expect(priceFormat({ toFixed: () => "1" })).toEqual({ minmov: 1, pricescale: 1 });
    expect(priceFormat({ toFixed: () => "0.0025" })).toEqual({ minmov: 25, pricescale: 10_000 });
    expect(symbolInfo({ ...ROW, exchange: "MCX", segment: "FUT" })).toMatchObject({
      session: "0900-2330",
      type: "futures",
    });
  });

  it("searches with exchange and type filters", async () => {
    const { service, repository } = setup();

    expect(await service.search({ query: "rel", limit: 5, exchange: "NSE", type: "stock" })).toEqual([
      {
        symbol: "RELIANCE",
        full_name: `NSE:${KEY}`,
        description: "Reliance Industries",
        exchange: "NSE",
        ticker: KEY,
        type: "stock",
      },
    ]);
    expect(repository.search).toHaveBeenCalledWith("rel", 5, { exchange: "NSE", segment: "EQ" });
    await service.search({ query: "", limit: 5, exchange: "LSE", type: "crypto" });
    expect(repository.search).toHaveBeenLastCalledWith("", 5, { exchange: undefined, segment: undefined });
  });

  it("returns history as UDF parallel arrays in seconds", async () => {
    const { service, candles } = setup([bar(NOW - 120_000), bar(NOW - 60_000)]);

    const history = await service.history("user-1", {
      symbol: KEY,
      resolution: "1",
      from: (NOW - 3_600_000) / 1_000,
      to: NOW / 1_000,
    });

    expect(UdfHistorySchema.safeParse(history).success).toBe(true);
    expect(history).toEqual({
      s: "ok",
      t: [(NOW - 120_000) / 1_000, (NOW - 60_000) / 1_000],
      o: [1.5, 1.5],
      h: [2, 2],
      l: [1, 1],
      c: [1.75, 1.75],
      v: [7, 7],
    });
    expect(candles.list).toHaveBeenCalledWith("user-1", {
      key: KEY,
      tf: "M1",
      from: new Date(NOW - 3_600_000),
      to: new Date(NOW),
    });
  });

  it("honours countback, caps the range and answers no_data", async () => {
    const { service, candles } = setup([bar(1), bar(2), bar(3)]);

    const history = await service.history("u", {
      symbol: KEY,
      resolution: "1D",
      from: NOW / 1_000,
      to: NOW / 1_000,
      countback: 2,
    });
    expect(history.t).toEqual([0, 0]);
    const call = candles.list.mock.calls[0] as unknown as [string, { from: Date; to: Date }];
    expect(call[1].to.getTime() - call[1].from.getTime()).toBeGreaterThanOrEqual(2 * 86_400_000);

    await service.history("u", { symbol: KEY, resolution: "1", from: 0, to: NOW / 1_000 });
    const capped = candles.list.mock.calls[1] as unknown as [string, { from: Date; to: Date }];
    expect(capped[1].to.getTime() - capped[1].from.getTime()).toBe(5_000 * 60_000);

    expect(await service.history("u", { symbol: KEY, resolution: "1", from: 10, to: 10 })).toEqual({ s: "no_data" });
    candles.list.mockResolvedValueOnce([]);
    expect(await service.history("u", { symbol: KEY, resolution: "60", from: 0, to: 3_600 })).toEqual({ s: "no_data" });
  });
});
