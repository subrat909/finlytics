/**
 * Clean-ups when the feed goes live (phase-1b "Going live"): simulated data must never pass for real data.
 *
 * - Quotes: every `quote:<key>` the simulator wrote (`src` `PAPER`, or no `src`: written before quotes carried one)
 *   is deleted, with its book; live quotes stay. Stored books (`depth:*`) are deleted too: the live feed rewrites
 *   them within a tick for every key it carries.
 * - Candles: until `candles:origin` reads `BROKER`, `Candle` may hold synthetic bars (stored by phase 1's paper
 *   backfill). The first time any feed goes live they are deleted with every `candles:cov:*` range, once (the marker,
 *   under a lock); from then on synthetic candles are generated on the fly and never stored. Production never stored
 *   synthetic bars, so there (`purgeCandles: false`) a missing marker (a new or flushed Redis) only sets it: the
 *   table is never wiped because a Redis key is gone.
 *
 * SCAN in batches, off the request path (the feed leader, once per switch to a broker).
 */
import { isInstrumentKey } from "@finlytics/shared";

import { redisKeyPatterns, redisKeys } from "../infra/redis/keys";
import type { RedisScript } from "../infra/redis/redis.service";

/** Deletes a quote hash whose `src` is missing or ARGV[1] (PAPER), with its book. KEYS: quote, depth. 1 = deleted. */
export const PURGE_SIMULATED_QUOTE_LUA = `
local src = redis.call('HGET', KEYS[1], 'src')
if (not src) or src == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
`;

/** The marker value once `Candle` holds broker bars only. */
export const BROKER_CANDLE_ORIGIN = "BROKER";

const SCAN_COUNT = 500;
const PURGE_LOCK_MS = 120_000;
const QUOTE_PREFIX = "quote:";

/** The Redis calls the purge makes. */
export interface PurgeRedis {
  scan(cursor: string, match: "MATCH", pattern: string, count: "COUNT", size: number): Promise<[string, string[]]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export interface PurgeLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export class MarketDataPurge {
  constructor(
    private readonly redis: PurgeRedis,
    private readonly purgeQuote: RedisScript,
    private readonly candles: { deleteAll(): Promise<number> },
    private readonly logger: PurgeLogger,
    private readonly options: { readonly purgeCandles: boolean } = { purgeCandles: true },
  ) {}

  /** Both clean-ups; failures are logged, never thrown (the live feed runs anyway). */
  async goLive(): Promise<void> {
    try {
      const quotes = await this.purgeSimulatedQuotes();
      if (quotes > 0) this.logger.info({ quotes }, "deleted simulated quotes");
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "could not delete simulated quotes");
    }
    try {
      await this.ensureBrokerCandles();
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "could not purge synthetic candles");
    }
  }

  /** Deletes the simulator's quotes and every stored book. Returns the quotes deleted. */
  async purgeSimulatedQuotes(): Promise<number> {
    let deleted = 0;
    await this.#scan(redisKeyPatterns.quotes, async (keys) => {
      const results = await Promise.all(
        keys
          .map((key) => key.slice(QUOTE_PREFIX.length))
          .filter((instrumentKey) => isInstrumentKey(instrumentKey))
          .map((instrumentKey) =>
            this.purgeQuote([redisKeys.quote(instrumentKey), redisKeys.depth(instrumentKey)], ["PAPER"]),
          ),
      );
      deleted += results.filter((result) => Number(result) === 1).length;
    });
    await this.#scan(redisKeyPatterns.depths, async (keys) => {
      await this.redis.del(...keys);
    });
    return deleted;
  }

  /**
   * Deletes stored candles and coverage unless already done (`candles:origin` = BROKER). Returns true when this call
   * purged; false when it was done before or another process holds the purge lock.
   */
  async ensureBrokerCandles(): Promise<boolean> {
    if ((await this.redis.get(redisKeys.candleOrigin())) === BROKER_CANDLE_ORIGIN) return false;
    if (!this.options.purgeCandles) {
      await this.redis.set(redisKeys.candleOrigin(), BROKER_CANDLE_ORIGIN);
      return false;
    }
    if ((await this.redis.set(redisKeys.candlePurgeLock(), "1", "PX", PURGE_LOCK_MS, "NX")) === null) return false;
    try {
      if ((await this.redis.get(redisKeys.candleOrigin())) === BROKER_CANDLE_ORIGIN) return false;
      const rows = await this.candles.deleteAll();
      let ranges = 0;
      await this.#scan(redisKeyPatterns.candleCoverage, async (keys) => {
        ranges += await this.redis.del(...keys);
      });
      await this.redis.set(redisKeys.candleOrigin(), BROKER_CANDLE_ORIGIN);
      this.logger.info({ rows, ranges }, "purged synthetic candles: Candle now holds broker bars only");
      return true;
    } finally {
      await this.redis.del(redisKeys.candlePurgeLock());
    }
  }

  async #scan(pattern: string, each: (keys: string[]) => Promise<void>): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", SCAN_COUNT);
      cursor = next;
      if (keys.length > 0) await each(keys);
    } while (cursor !== "0");
  }
}
