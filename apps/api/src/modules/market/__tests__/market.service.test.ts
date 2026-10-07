import { MARKET_INDEX_KEYS, MarketOverviewSchema, NIFTY_50_KEYS } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import type { FeedSnapshot, FeedSourceReader } from "../../../feed/feed-source";
import type { MarketRepository } from "../market.repository";
import { feedInfo, marketQuote, MarketService, movers } from "../market.service";

/** Tuesday 2026-10-06 10:00 IST: NSE open. */
const NOW = Date.UTC(2026, 9, 6, 4, 30);
const INDEX_KEYS = Object.values(MARKET_INDEX_KEYS);
const [S1, S2, S3, S4] = NIFTY_50_KEYS as unknown as InstrumentKey[];

function quoteHash(ltp: string, chg: string, chgPct: string, vol: string, close = "100"): Record<string, string> {
  return { ltp, chg, chgPct, vol, close, ts: String(NOW - 500) };
}

function setup(snapshot?: Partial<FeedSnapshot>) {
  let now = NOW;
  const hashes = new Map<string, Record<string, string>>([
    [
      MARKET_INDEX_KEYS.NIFTY,
      { ...quoteHash("25000.5", "100.5", "0.4", "0", "24900"), open: "24950", high: "25010", low: "24900" },
    ],
    [S1 ?? "", quoteHash("110", "10", "10", "500")],
    [S2 ?? "", quoteHash("95", "-5", "-5", "900")],
    [S3 ?? "", quoteHash("100", "0", "0", "0")],
    // No previous close: the change the feed wrote ("0") is unknown, so neither unchanged nor a mover.
    [S4 ?? "", { ltp: "50", chg: "0", chgPct: "0", vol: "10", ts: String(NOW) }],
  ]);
  const repository = {
    holidays: vi.fn(() =>
      Promise.resolve([{ date: "2026-10-07", exchange: "NSE", name: "Test holiday", closure: "FULL_DAY" as const }]),
    ),
    labels: vi.fn(() =>
      Promise.resolve(new Map([[MARKET_INDEX_KEYS.NIFTY as string, { symbol: "NIFTY 50", name: "Nifty 50" }]])),
    ),
    quotes: vi.fn((keys: readonly string[]) => Promise.resolve(keys.map((key) => hashes.get(key) ?? {}))),
  };
  const feed = {
    current: vi.fn(() =>
      Promise.resolve<FeedSnapshot>({
        source: { broker: "UPSTOX", live: true, accountId: "acc", since: 0, reason: null },
        status: { status: "up", ts: now - 500, lastTickAt: now - 1_000 },
        ...snapshot,
      }),
    ),
  };
  const service = new MarketService(repository as unknown as MarketRepository, feed as unknown as FeedSourceReader, {
    now: () => new Date(now),
  });
  return { service, repository, feed, advance: (ms: number) => (now += ms) };
}

describe("MarketService.overview", () => {
  it("builds sessions, the feed, indices in order and NIFTY 50 movers", async () => {
    const { service } = setup();

    const overview = await service.overview();

    expect(MarketOverviewSchema.safeParse(overview).success).toBe(true);
    expect(overview.asOf).toBe(new Date(NOW).toISOString());
    expect(overview.exchanges.map((status) => [status.exchange, status.phase])).toEqual([
      ["NSE", "open"],
      ["BSE", "open"],
      ["MCX", "open"],
    ]);
    expect(overview.feed).toEqual({
      state: "up",
      source: "UPSTOX",
      live: true,
      lastTickAt: new Date(NOW - 1_000).toISOString(),
      reason: null,
    });
    expect(overview.indices.map((quote) => quote.key)).toEqual(INDEX_KEYS);
    expect(overview.indices[0]).toEqual({
      key: MARKET_INDEX_KEYS.NIFTY,
      symbol: "NIFTY 50",
      name: "Nifty 50",
      ltp: "25000.5",
      chg: "100.5",
      chgPct: "0.4",
      open: "24950",
      high: "25010",
      low: "24900",
      close: "24900",
      vol: 0,
      ts: NOW - 500,
    });
    // Not in the instrument table: named after the key, every number null without a quote.
    expect(overview.indices[1]).toMatchObject({
      symbol: "NIFTY BANK",
      name: "NIFTY BANK",
      ltp: null,
      chg: null,
      ts: null,
    });
    expect(overview.gainers.map((quote) => quote.key)).toEqual([S1]);
    expect(overview.losers.map((quote) => quote.key)).toEqual([S2]);
    expect(overview.active.map((quote) => quote.key)).toEqual([S2, S1, S4]);
    expect(overview.breadth).toEqual({ advances: 1, declines: 1, unchanged: 1 });
  });

  it("is built at most once a second, with holidays and names cached for 10 minutes", async () => {
    const { service, repository, advance } = setup();
    await Promise.all([service.overview(), service.overview()]);
    expect(repository.quotes).toHaveBeenCalledTimes(1);

    advance(1_000);
    await service.overview();
    expect(repository.quotes).toHaveBeenCalledTimes(2);
    expect(repository.holidays).toHaveBeenCalledTimes(1);
    expect(repository.labels).toHaveBeenCalledTimes(1);

    advance(600_000);
    await service.overview();
    expect(repository.holidays).toHaveBeenCalledTimes(2);
    expect(repository.labels).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache a failure", async () => {
    const { service, repository, feed } = setup();
    repository.quotes.mockRejectedValueOnce(new Error("redis down"));
    repository.holidays.mockRejectedValueOnce(new Error("db down"));
    repository.labels.mockRejectedValueOnce(new Error("db down"));
    await expect(service.overview()).rejects.toThrow();
    feed.current.mockRejectedValueOnce(new Error("redis down"));
    await expect(service.overview()).rejects.toThrow("redis down");
    expect((await service.overview()).indices).toHaveLength(INDEX_KEYS.length);
  });

  it("reports a simulated feed with its reason", async () => {
    const { service } = setup({
      source: {
        broker: "PAPER",
        live: false,
        accountId: null,
        since: 0,
        reason: "No Upstox or Dhan account is connected",
      },
      status: undefined,
    });
    expect((await service.overview()).feed).toEqual({
      state: "down",
      source: "PAPER",
      live: false,
      lastTickAt: null,
      reason: "No Upstox or Dhan account is connected",
    });
  });
});

describe("overview parts", () => {
  const label = { symbol: "X", name: "" };

  it("keeps only valid numbers from a quote hash", () => {
    const quote = marketQuote("NSE_EQ|X" as InstrumentKey, label, {
      ltp: "10",
      ts: "5",
      close: "9",
      chg: "1",
      chgPct: "11.11",
      open: "1e5",
      vol: "-3",
    });
    expect(quote).toMatchObject({ name: "X", ltp: "10", close: "9", chg: "1", open: null, vol: null, ts: 5 });
    expect(marketQuote("NSE_EQ|X" as InstrumentKey, label, { ltp: "10" }).ltp).toBeNull();
  });

  it("ranks movers by change % and volume, five at most", () => {
    const quotes = Array.from({ length: 7 }, (_, index) =>
      marketQuote(`NSE_EQ|S${String(index)}` as InstrumentKey, label, {
        ...quoteHash("1", String(index - 3), String(index - 3), String(index * 10)),
      }),
    );
    const result = movers(quotes);
    expect(result.gainers.map((quote) => quote.chgPct)).toEqual(["3", "2", "1"]);
    expect(result.losers.map((quote) => quote.chgPct)).toEqual(["-3", "-2", "-1"]);
    expect(result.active).toHaveLength(5);
    expect(result.active[0]?.vol).toBe(60);
    expect(result.breadth).toEqual({ advances: 3, declines: 3, unchanged: 1 });
  });

  it("calls the feed stale only while ticks are expected", () => {
    const snapshot: FeedSnapshot = {
      source: { broker: "DHAN", live: true, accountId: null, since: 0, reason: null },
      status: { status: "up", ts: NOW, lastTickAt: NOW - 10_000 },
    };
    expect(feedInfo(snapshot, NOW, true).state).toBe("stale");
    expect(feedInfo(snapshot, NOW, false).state).toBe("up");
    expect(feedInfo({ ...snapshot, status: { status: "up", ts: NOW, lastTickAt: null } }, NOW, true).state).toBe(
      "stale",
    );
  });
});
