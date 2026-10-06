/**
 * Which time ranges of an instrument's candles were already backfilled (phase 1 plan "Candles": store, never re-fetch
 * stored ranges). A range with no bars (a holiday, a night) is covered too, so it isn't asked for again.
 *
 * Coverage lives in Redis, `candles:cov:<timeframe>:<instrumentKey>`: a sorted set of merged `[start, end)` intervals
 * (member `"<start>:<end>"`, score `start`). Losing it costs one re-fetch per range, whose rows are then skipped as
 * duplicates; the candles themselves are in Timescale.
 */
import type { InstrumentKey } from "@finlytics/shared";

import { redisKeys } from "../../infra/redis/keys";

/** `[start, end)` in epoch milliseconds. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Sorted, non-overlapping, with touching intervals joined. Empty intervals are dropped. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((interval) => interval.end > interval.start).toSorted((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && interval.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** The parts of `range` no interval of `covered` contains. */
export function findGaps(covered: readonly Interval[], range: Interval): Interval[] {
  if (range.end <= range.start) return [];
  const gaps: Interval[] = [];
  let cursor = range.start;
  for (const interval of mergeIntervals(covered)) {
    if (interval.end <= cursor) continue;
    if (interval.start >= range.end) break;
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= range.end) break;
  }
  if (cursor < range.end) gaps.push({ start: cursor, end: range.end });
  return gaps;
}

/** The Redis calls the store makes. */
export interface CoverageRedis {
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  multi(): {
    del(key: string): unknown;
    zadd(key: string, ...scoreMembers: (string | number)[]): unknown;
    exec(): Promise<unknown>;
  };
}

function parseMember(member: string): Interval | undefined {
  const match = /^(\d{1,16}):(\d{1,16})$/.exec(member);
  if (match === null) return undefined;
  const interval = { start: Number(match[1]), end: Number(match[2]) };
  return interval.end > interval.start ? interval : undefined;
}

export class CandleCoverageStore {
  constructor(private readonly redis: CoverageRedis) {}

  async read(timeframe: string, key: InstrumentKey): Promise<Interval[]> {
    const members = await this.redis.zrange(redisKeys.candleCoverage(timeframe, key), 0, -1);
    return mergeIntervals(members.map(parseMember).filter((interval) => interval !== undefined));
  }

  /** Adds `added` to the stored coverage (read, merge, rewrite in one MULTI). */
  async add(
    timeframe: string,
    key: InstrumentKey,
    existing: readonly Interval[],
    added: readonly Interval[],
  ): Promise<void> {
    const merged = mergeIntervals([...existing, ...added]);
    if (merged.length === 0) return;
    const redisKey = redisKeys.candleCoverage(timeframe, key);
    const transaction = this.redis.multi();
    transaction.del(redisKey);
    transaction.zadd(
      redisKey,
      ...merged.flatMap((interval) => [interval.start, `${String(interval.start)}:${String(interval.end)}`]),
    );
    await transaction.exec();
  }
}
