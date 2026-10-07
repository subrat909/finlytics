import { describe, expect, it, vi } from "vitest";

import { BROKER_CANDLE_ORIGIN, MarketDataPurge } from "../market-purge";
import type { PurgeRedis } from "../market-purge";

/** Strings, hashes and SCAN over them, with the purge script emulated. */
class FakeRedis implements PurgeRedis {
  readonly strings = new Map<string, string>();
  readonly hashes = new Map<string, Record<string, string>>();
  lockHeld = false;

  keys(): string[] {
    return [...this.strings.keys(), ...this.hashes.keys()];
  }
  #scanned: string[] = [];
  scan(cursor: string, _match: "MATCH", pattern: string): Promise<[string, string[]]> {
    // Two pages over the keys as they were when the scan started: the first key, then the rest.
    if (cursor === "0") this.#scanned = this.keys().filter((key) => key.startsWith(pattern.slice(0, -1)));
    return Promise.resolve(cursor === "0" ? ["1", this.#scanned.slice(0, 1)] : ["0", this.#scanned.slice(1)]);
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }
  set(key: string, value: string, ...options: unknown[]): Promise<unknown> {
    if (options.includes("NX")) {
      if (this.lockHeld || this.strings.has(key)) return Promise.resolve(null);
    }
    this.strings.set(key, value);
    return Promise.resolve("OK");
  }
  del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.strings.delete(key) || this.hashes.delete(key)) deleted += 1;
    }
    return Promise.resolve(deleted);
  }
  /** PURGE_SIMULATED_QUOTE_LUA. */
  purgeQuote = (keys: readonly string[], args: readonly (string | number)[]): Promise<unknown> => {
    const [quote = "", depth = ""] = keys;
    const src = this.hashes.get(quote)?.["src"];
    if (src === undefined || src === args[0]) {
      this.hashes.delete(quote);
      this.strings.delete(depth);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  };
}

function setup(options: { purgeCandles: boolean } = { purgeCandles: true }) {
  const redis = new FakeRedis();
  const candles = { deleteAll: vi.fn(() => Promise.resolve(42)) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const purge = new MarketDataPurge(redis, redis.purgeQuote, candles, logger, options);
  return { redis, candles, logger, purge };
}

describe("MarketDataPurge", () => {
  it("never deletes candles in production: a missing marker is only set", async () => {
    const { redis, candles, purge } = setup({ purgeCandles: false });
    redis.strings.set("candles:cov:M1:NSE_EQ|INFY", "x");

    expect(await purge.ensureBrokerCandles()).toBe(false);
    expect(candles.deleteAll).not.toHaveBeenCalled();
    expect(redis.strings.get("candles:cov:M1:NSE_EQ|INFY")).toBe("x");
    expect(redis.strings.get("candles:origin")).toBe("BROKER");
  });

  it("deletes simulated and unlabelled quotes with every stored book, keeping live quotes", async () => {
    const { redis, purge } = setup();
    redis.hashes.set("quote:NSE_EQ|INFY", { ltp: "1", src: "PAPER" });
    redis.hashes.set("quote:NSE_EQ|TCS", { ltp: "1" });
    redis.hashes.set("quote:NSE_EQ|SBIN", { ltp: "1", src: "UPSTOX" });
    redis.strings.set("depth:NSE_EQ|INFY", "{}");
    redis.strings.set("depth:NSE_EQ|SBIN", "{}");

    expect(await purge.purgeSimulatedQuotes()).toBe(2);
    expect(redis.keys().sort()).toEqual(["quote:NSE_EQ|SBIN"]);
  });

  it("purges candles and coverage once, then never again", async () => {
    const { redis, candles, purge, logger } = setup();
    redis.strings.set("candles:cov:M1:NSE_EQ|INFY", "x");

    expect(await purge.ensureBrokerCandles()).toBe(true);
    expect(candles.deleteAll).toHaveBeenCalledTimes(1);
    expect(redis.strings.get("candles:origin")).toBe(BROKER_CANDLE_ORIGIN);
    expect(redis.strings.has("candles:cov:M1:NSE_EQ|INFY")).toBe(false);
    expect(redis.strings.has("lock:candles:purge")).toBe(false);
    expect(logger.info).toHaveBeenCalledWith({ rows: 42, ranges: 1 }, expect.stringMatching(/broker bars only/));

    expect(await purge.ensureBrokerCandles()).toBe(false);
    expect(candles.deleteAll).toHaveBeenCalledTimes(1);
  });

  it("leaves the purge to the process holding the lock", async () => {
    const { redis, candles, purge } = setup();
    redis.lockHeld = true;
    expect(await purge.ensureBrokerCandles()).toBe(false);
    expect(candles.deleteAll).not.toHaveBeenCalled();
  });

  it("logs and goes on when a clean-up fails", async () => {
    const { redis, candles, purge, logger } = setup();
    redis.hashes.set("quote:NSE_EQ|INFY", { ltp: "1" });
    redis.scan = () => Promise.reject(new Error("redis down"));
    candles.deleteAll.mockRejectedValue(new Error("db down"));

    await purge.goLive();

    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "could not delete simulated quotes");
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "could not purge synthetic candles");
  });

  it("goes live: quotes then candles", async () => {
    const { redis, candles, purge, logger } = setup();
    redis.hashes.set("quote:NSE_EQ|INFY", { ltp: "1", src: "PAPER" });
    await purge.goLive();
    expect(redis.hashes.size).toBe(0);
    expect(candles.deleteAll).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ quotes: 1 }, "deleted simulated quotes");
  });
});
