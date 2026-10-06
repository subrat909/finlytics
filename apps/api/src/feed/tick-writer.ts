/**
 * Writes the feed's ticks to Redis (phase 1 plan "Redis keys"), batched per event-loop turn into one pipeline:
 *
 * - every tick: `XADD ticks:<BROKER> MAXLEN ~ 100000 * k <key> u <json>`
 * - the latest tick per key in the batch: `HSET quote:<key> …` and `PUBLISH q:<key> <json>`
 *
 * Bounded: at most {@link MAX_PENDING} ticks wait for a write; beyond that the oldest are dropped from the stream batch
 * (the latest quote per key is always kept). Failures are logged at most every 10 s and never thrown: a lost tick is
 * replaced by the next one.
 */
import type { Tick } from "@finlytics/broker-sdk";

import { redisKeys } from "../infra/redis/keys";

import { encodeQuoteUpdate, quoteHashFields, toQuoteUpdate } from "./quote-update";
import type { QuoteUpdate } from "./quote-update";

/** The `ticks:<BROKER>` stream's approximate cap. */
export const TICK_STREAM_MAXLEN = 100_000;

const MAX_PENDING = 10_000;
const ERROR_LOG_INTERVAL_MS = 10_000;

/** The ioredis pipeline calls the writer makes. */
export interface TickPipeline {
  xadd(...args: (string | number)[]): unknown;
  hset(key: string, fields: Record<string, string>): unknown;
  publish(channel: string, message: string): unknown;
  exec(): Promise<unknown>;
}

export interface TickWriterTarget {
  pipeline(): TickPipeline;
}

export interface TickWriterLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export class TickWriter {
  #pending: QuoteUpdate[] = [];
  #scheduled = false;
  #flushing: Promise<void> = Promise.resolve();
  #lastErrorAt = Number.NEGATIVE_INFINITY;
  #dropped = 0;

  constructor(
    private readonly redis: TickWriterTarget,
    readonly broker: string,
    private readonly logger: TickWriterLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queues a tick; the batch is written on the next event-loop turn. */
  push(tick: Tick): void {
    let update: QuoteUpdate;
    try {
      update = toQuoteUpdate(tick);
    } catch (error: unknown) {
      this.#logError(error, "dropped a malformed tick");
      return;
    }
    this.#pending.push(update);
    if (this.#pending.length > MAX_PENDING) {
      this.#pending.shift();
      this.#dropped += 1;
    }
    if (!this.#scheduled) {
      this.#scheduled = true;
      setImmediate(() => {
        this.#scheduled = false;
        this.#flushing = this.#flushing.then(() => this.flush());
      });
    }
  }

  /** Writes everything queued so far. Resolves when Redis answered (or failed). */
  async flush(): Promise<void> {
    const batch = this.#pending;
    if (batch.length === 0) return;
    this.#pending = [];
    const latest = new Map<string, QuoteUpdate>();
    const pipeline = this.redis.pipeline();
    const stream = redisKeys.ticks(this.broker);
    for (const update of batch) {
      const json = encodeQuoteUpdate(update);
      pipeline.xadd(stream, "MAXLEN", "~", TICK_STREAM_MAXLEN, "*", "k", update.k, "u", json);
      latest.set(update.k, update);
    }
    for (const update of latest.values()) {
      pipeline.hset(redisKeys.quote(update.k), quoteHashFields(update));
      pipeline.publish(redisKeys.quoteChannel(update.k), encodeQuoteUpdate(update));
    }
    try {
      await pipeline.exec();
    } catch (error: unknown) {
      this.#logError(error, "could not write ticks to redis");
    }
  }

  /** Waits for queued and in-flight writes (shutdown). */
  async drain(): Promise<void> {
    await this.#flushing;
    await this.flush();
  }

  #logError(error: unknown, message: string): void {
    const now = this.now();
    if (now - this.#lastErrorAt < ERROR_LOG_INTERVAL_MS) return;
    this.#lastErrorAt = now;
    this.logger.warn({ err: error, broker: this.broker, dropped: this.#dropped }, message);
  }
}
