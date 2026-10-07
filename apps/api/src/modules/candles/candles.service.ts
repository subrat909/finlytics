/**
 * `GET /v1/candles` (phase 1 plan "REST"): complete bars from Timescale; ranges never backfilled are fetched once from
 * the user's candle source, stored, and recorded as covered, so a later request (from anyone) reads only the database.
 *
 * - The range is widened to whole bars and clipped at the start of the current bar: the live bar is the client's job
 *   (it draws it from ticks), so an incomplete bar is never stored or covered.
 * - A synthetic source (the simulator, while it drives the feed) is served on the fly: never stored, never covered,
 *   so a live feed never serves a synthetic bar (phase-1b).
 * - A broker source that has no token for the instrument is skipped: the request is served from storage.
 * - Concurrent requests for the same instrument and timeframe share one backfill in this process.
 * - A backfill failure is logged; the request is then served from what is stored, or fails when nothing is.
 */
import { CANDLE_TIMEFRAME_MS } from "@finlytics/shared";
import type { CandleBar, CandlesQuery, CandleTimeframe, InstrumentKey } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import { alignToBar } from "../../feed/market-hours";

import { CandleCoverageStore, findGaps } from "./candle-coverage";
import type { Interval } from "./candle-coverage";
import { CANDLE_SOURCE_RESOLVER } from "./candle-sources";
import type { CandleSource, CandleSourceResolver } from "./candle-sources";
import { CandlesRepository } from "./candles.repository";

/** DI token for the coverage store. */
export const CANDLE_COVERAGE = Symbol("CANDLE_COVERAGE");

@Injectable()
export class CandlesService {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly candles: CandlesRepository,
    @Inject(CANDLE_COVERAGE) private readonly coverage: CandleCoverageStore,
    @Inject(CANDLE_SOURCE_RESOLVER) private readonly sources: CandleSourceResolver,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(CandlesService.name);
  }

  /** Bars of `query.key` at `query.tf` in `[from, to)`, ascending. */
  async list(userId: string, query: CandlesQuery): Promise<CandleBar[]> {
    const range = this.completeRange(query.tf, query.from.getTime(), query.to.getTime());
    if (range.end <= range.start) return [];
    const source = await this.sources.forUser(userId);
    if (source?.synthetic === true) return this.synthetic(source, query.key, query.tf, range);
    let failure: Error | undefined;
    try {
      if (source !== undefined) await this.backfill(source, query.key, query.tf, range);
    } catch (error: unknown) {
      failure = error instanceof Error ? error : new Error("Candle backfill failed", { cause: error });
      this.logger.warn({ err: error, timeframe: query.tf }, "candle backfill failed; serving stored bars");
    }
    const bars = await this.candles.findRange(query.key, query.tf, new Date(range.start), new Date(range.end));
    if (bars.length === 0 && failure !== undefined) throw failure;
    return bars;
  }

  /** `[from, to)` widened to whole bars, ending no later than the start of the current (incomplete) bar. */
  completeRange(timeframe: CandleTimeframe, from: number, to: number): Interval {
    const barMs = CANDLE_TIMEFRAME_MS[timeframe];
    const currentBar = alignToBar(this.clock.now().getTime(), barMs);
    const end = Math.min(alignToBar(to - 1, barMs) + barMs, currentBar);
    return { start: alignToBar(from, barMs), end };
  }

  /** Synthetic bars for the range, straight from the source: nothing is read from or written to storage. */
  private async synthetic(
    source: CandleSource,
    key: InstrumentKey,
    timeframe: CandleTimeframe,
    range: Interval,
  ): Promise<CandleBar[]> {
    const bars = await source.fetch({
      instrumentKey: key,
      timeframe,
      from: new Date(range.start),
      to: new Date(range.end),
    });
    return bars
      .filter((bar) => bar.ts >= range.start && bar.ts < range.end)
      .map((bar) => ({
        ts: bar.ts,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        ...(bar.oi === undefined ? {} : { oi: bar.oi }),
      }));
  }

  /** One backfill at a time per instrument and timeframe in this process; a waiter re-reads the coverage after. */
  private async backfill(
    source: CandleSource,
    key: InstrumentKey,
    timeframe: CandleTimeframe,
    range: Interval,
  ): Promise<void> {
    const flightKey = `${timeframe}:${key}`;
    for (let running = this.inflight.get(flightKey); running !== undefined; running = this.inflight.get(flightKey)) {
      await running.catch(() => undefined);
    }
    // No await between the check above and this: the next request for the key waits on this one.
    const run = this.backfillGaps(source, key, timeframe, range).finally(() => {
      this.inflight.delete(flightKey);
    });
    this.inflight.set(flightKey, run);
    await run;
  }

  private async backfillGaps(
    source: CandleSource,
    key: InstrumentKey,
    timeframe: CandleTimeframe,
    range: Interval,
  ): Promise<void> {
    const covered = await this.coverage.read(timeframe, key);
    const gaps = findGaps(covered, range);
    if (gaps.length === 0) return;
    if (source.supports !== undefined && !(await source.supports(key))) return;
    await this.fill(source, key, timeframe, covered, gaps);
  }

  private async fill(
    source: CandleSource,
    key: InstrumentKey,
    timeframe: CandleTimeframe,
    covered: readonly Interval[],
    gaps: readonly Interval[],
  ): Promise<void> {
    const filled: Interval[] = [];
    try {
      for (const gap of gaps) {
        const bars = await source.fetch({
          instrumentKey: key,
          timeframe,
          from: new Date(gap.start),
          to: new Date(gap.end),
        });
        const inRange = bars.filter((bar) => bar.ts >= gap.start && bar.ts < gap.end);
        const inserted = await this.candles.insertMany(key, timeframe, inRange);
        filled.push(gap);
        this.logger.debug(
          { source: source.name, timeframe, from: gap.start, to: gap.end, fetched: bars.length, inserted },
          "candles backfilled",
        );
      }
    } finally {
      // Whatever was stored is covered, even when a later gap failed.
      if (filled.length > 0) await this.coverage.add(timeframe, key, covered, filled);
    }
  }
}
