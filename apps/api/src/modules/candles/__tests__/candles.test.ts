import type { BrokerGateway, Candle } from "@finlytics/broker-sdk";
import type { CandleBar, InstrumentKey } from "@finlytics/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import { CandleCoverageStore, findGaps, mergeIntervals } from "../candle-coverage";
import type { CoverageRedis, Interval } from "../candle-coverage";
import {
  BrokerCandleSource,
  DefaultCandleSourceResolver,
  NO_DEFAULT_BROKER_ACCOUNT,
  PaperCandleSource,
} from "../candle-sources";
import type { CandleRequest, CandleSource, CandleSourceResolver } from "../candle-sources";
import type { CandlesRepository } from "../candles.repository";
import { defaultBrokerAccount } from "../candles.module";
import { CandlesService } from "../candles.service";

const KEY = "NSE_EQ|RELIANCE" as InstrumentKey;
const MIN = 60_000;
/** Tuesday 2026-10-06 09:15 IST. */
const OPEN = Date.UTC(2026, 9, 6, 3, 45);

describe("interval math", () => {
  it("merges overlapping and touching intervals and drops empty ones", () => {
    expect(
      mergeIntervals([
        { start: 5, end: 7 },
        { start: 0, end: 2 },
        { start: 2, end: 3 },
        { start: 6, end: 9 },
        { start: 4, end: 4 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 9 },
    ]);
  });

  it("finds the uncovered parts of a range", () => {
    const covered = [
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ];
    expect(findGaps(covered, { start: 0, end: 50 })).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
      { start: 40, end: 50 },
    ]);
    expect(findGaps(covered, { start: 12, end: 18 })).toEqual([]);
    expect(findGaps(covered, { start: 15, end: 35 })).toEqual([{ start: 20, end: 30 }]);
    expect(findGaps([{ start: 0, end: 5 }], { start: 50, end: 60 })).toEqual([{ start: 50, end: 60 }]);
    expect(findGaps(covered, { start: 5, end: 5 })).toEqual([]);
  });
});

/** A sorted set per key, as Redis keeps it. */
class FakeCoverageRedis implements CoverageRedis {
  readonly sets = new Map<string, Map<string, number>>();

  zrange(key: string): Promise<string[]> {
    const set = this.sets.get(key) ?? new Map<string, number>();
    return Promise.resolve([...set.entries()].toSorted((a, b) => a[1] - b[1]).map(([member]) => member));
  }

  multi() {
    const ops: (() => void)[] = [];
    return {
      del: (key: string) => ops.push(() => this.sets.delete(key)),
      zadd: (key: string, ...scoreMembers: (string | number)[]) =>
        ops.push(() => {
          const set = this.sets.get(key) ?? new Map<string, number>();
          for (let index = 0; index < scoreMembers.length; index += 2) {
            set.set(String(scoreMembers[index + 1]), Number(scoreMembers[index]));
          }
          this.sets.set(key, set);
        }),
      exec: () => {
        for (const op of ops) op();
        return Promise.resolve([]);
      },
    };
  }
}

describe("CandleCoverageStore", () => {
  it("stores merged intervals and reads them back, ignoring malformed members", async () => {
    const redis = new FakeCoverageRedis();
    const store = new CandleCoverageStore(redis);

    await store.add("M1", KEY, [], [{ start: 0, end: 10 }]);
    await store.add("M1", KEY, await store.read("M1", KEY), [
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
    redis.sets.get(`candles:cov:M1:${KEY}`)?.set("junk", 1);

    expect(await store.read("M1", KEY)).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
    await store.add("M1", KEY, [], []);
  });
});

/** An in-memory Candle table. */
class MemoryCandles {
  readonly rows = new Map<number, Candle>();
  inserts = 0;

  findRange(_key: InstrumentKey, _tf: string, from: Date, to: Date): Promise<CandleBar[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.ts >= from.getTime() && row.ts < to.getTime())
        .toSorted((a, b) => a.ts - b.ts)
        .map((row) => ({ ...row })),
    );
  }

  insertMany(_key: InstrumentKey, _tf: string, candles: readonly Candle[]): Promise<number> {
    this.inserts += 1;
    let inserted = 0;
    for (const candle of candles) {
      if (this.rows.has(candle.ts)) continue;
      this.rows.set(candle.ts, candle);
      inserted += 1;
    }
    return Promise.resolve(inserted);
  }
}

function bar(ts: number): Candle {
  return { ts, open: "1", high: "2", low: "0.5", close: "1.5", volume: 10 };
}

function setup(options: { source?: CandleSource | undefined; now?: number } = {}) {
  const repository = new MemoryCandles();
  const coverage = new CandleCoverageStore(new FakeCoverageRedis());
  const fetch = vi.fn((request: CandleRequest) => {
    const bars: Candle[] = [];
    for (let ts = request.from.getTime(); ts < request.to.getTime(); ts += MIN) bars.push(bar(ts));
    return Promise.resolve([...bars, bar(request.to.getTime() + MIN)]); // one bar outside: dropped
  });
  const source: CandleSource = options.source ?? { name: "TEST", fetch };
  const resolver: CandleSourceResolver = {
    forUser: vi.fn(() => Promise.resolve(options.source === undefined && "source" in options ? undefined : source)),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const service = new CandlesService(
    repository as unknown as CandlesRepository,
    coverage,
    resolver,
    { now: () => new Date(options.now ?? OPEN + 24 * 60 * MIN) },
    logger as unknown as PinoLogger,
  );
  return { service, repository, fetch, resolver, logger };
}

const query = (from: number, to: number) => ({ key: KEY, tf: "M1" as const, from: new Date(from), to: new Date(to) });

describe("CandlesService", () => {
  it("backfills a range once, then serves it from the database", async () => {
    const { service, repository, fetch } = setup();

    const first = await service.list("user-1", query(OPEN, OPEN + 10 * MIN));
    const second = await service.list("user-2", query(OPEN, OPEN + 10 * MIN));

    expect(first).toHaveLength(10);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(repository.rows.size).toBe(10);
  });

  it("fetches only the gaps around what is already covered", async () => {
    const { service, fetch } = setup();
    await service.list("u", query(OPEN + 5 * MIN, OPEN + 10 * MIN));

    const bars = await service.list("u", query(OPEN, OPEN + 15 * MIN));

    expect(bars).toHaveLength(15);
    const calls = fetch.mock.calls.map(([request]) => [
      (request.from.getTime() - OPEN) / MIN,
      (request.to.getTime() - OPEN) / MIN,
    ]);
    expect(calls).toEqual([
      [5, 10],
      [0, 5],
      [10, 15],
    ]);
  });

  it("never asks for the current, incomplete bar or the future", async () => {
    const now = OPEN + 10 * MIN + 30_000;
    const { service, fetch } = setup({ now });

    const bars = await service.list("u", query(OPEN, OPEN + 60 * MIN));

    expect(bars).toHaveLength(10);
    expect(fetch.mock.calls[0]?.[0].to.getTime()).toBe(OPEN + 10 * MIN);
    expect(await service.list("u", query(OPEN + 30 * MIN, OPEN + 60 * MIN))).toEqual([]);
  });

  it("widens the range to whole bars", () => {
    const { service } = setup();
    expect(service.completeRange("M5", OPEN + 1_000, OPEN + 5 * MIN + 1)).toEqual({
      start: OPEN,
      end: OPEN + 10 * MIN,
    });
  });

  it("serves the database only when the user has no source", async () => {
    const { service, repository } = setup({ source: undefined });

    expect(await service.list("u", query(OPEN, OPEN + 10 * MIN))).toEqual([]);
    expect(repository.inserts).toBe(0);
  });

  it("serves stored bars when a later backfill fails, and fails when nothing is stored", async () => {
    let fail = false;
    const flakyFetch = vi.fn((request: CandleRequest) => {
      if (fail) return Promise.reject(new Error("broker down"));
      return Promise.resolve([bar(request.from.getTime())]);
    });
    const flaky: CandleSource = { name: "FLAKY", fetch: flakyFetch };
    const { service, logger } = setup({ source: flaky });
    await service.list("u", query(OPEN, OPEN + MIN));
    fail = true;

    expect(await service.list("u", query(OPEN, OPEN + 3 * MIN))).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
    await expect(service.list("u", query(OPEN + 60 * MIN, OPEN + 61 * MIN))).rejects.toThrow("broker down");

    flakyFetch.mockRejectedValueOnce("not an error");
    await expect(service.list("u", query(OPEN + 70 * MIN, OPEN + 71 * MIN))).rejects.toThrow("Candle backfill failed");
  });

  it("shares one backfill between concurrent requests", async () => {
    const { service, fetch } = setup();

    await Promise.all([
      service.list("a", query(OPEN, OPEN + 10 * MIN)),
      service.list("b", query(OPEN, OPEN + 10 * MIN)),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("candle sources", () => {
  it("prefers the user's default broker account, then paper, then none", async () => {
    const gateway = { broker: "UPSTOX", getHistoricalCandles: vi.fn(() => Promise.resolve([bar(0)])) };
    const account = { accountId: "acc", creds: {} };
    const withAccount = new DefaultCandleSourceResolver(
      () => Promise.resolve({ gateway: gateway as unknown as BrokerGateway, account: account as never }),
      new PaperCandleSource(1),
    );
    const source = await withAccount.forUser("u");
    expect(source).toBeInstanceOf(BrokerCandleSource);
    expect(source?.name).toBe("UPSTOX");
    const request = { instrumentKey: KEY, timeframe: "M1" as const, from: new Date(OPEN), to: new Date(OPEN + MIN) };
    expect(await source?.fetch(request)).toEqual([bar(0)]);
    expect(gateway.getHistoricalCandles).toHaveBeenCalledWith(account, request, { signal: undefined });

    const paper = await new DefaultCandleSourceResolver(NO_DEFAULT_BROKER_ACCOUNT, new PaperCandleSource(1)).forUser(
      "u",
    );
    expect(paper?.name).toBe("PAPER");
    expect(await paper?.fetch(request)).toHaveLength(1);

    expect(await new DefaultCandleSourceResolver(NO_DEFAULT_BROKER_ACCOUNT, undefined).forUser("u")).toBeUndefined();
  });
});

describe("Interval type", () => {
  it("is a plain value", () => {
    const interval: Interval = { start: 1, end: 2 };
    expect(interval.end - interval.start).toBe(1);
  });
});

describe("defaultBrokerAccount", () => {
  it("uses the user's default broker account, but not a paper one", async () => {
    const connected = (broker: string) => ({ userId: "u", broker, ref: { accountId: "acc" }, gateway: { broker } });
    const upstox = defaultBrokerAccount({ defaultAccountRef: () => Promise.resolve(connected("UPSTOX") as never) });
    expect((await upstox("u"))?.account).toEqual({ accountId: "acc" });

    const paper = defaultBrokerAccount({ defaultAccountRef: () => Promise.resolve(connected("PAPER") as never) });
    expect(await paper("u")).toBeNull();
    expect(await defaultBrokerAccount({ defaultAccountRef: () => Promise.resolve(null) })("u")).toBeNull();
  });
});
