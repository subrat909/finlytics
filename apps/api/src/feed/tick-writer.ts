/**
 * Writes the feed's ticks to Redis (phase 1 plan "Redis keys"; phase-1b "Quotes, depth"), batched per event-loop turn
 * into one pipeline:
 *
 * - every tick: `XADD ticks:<BROKER> MAXLEN ~ 100000 * k <key> u <json>`
 * - the latest tick per key in the batch: `HSET quote:<key> … src <BROKER>` and `PUBLISH q:<key> <json>`
 * - the latest book per key in the batch (ticks that carry one): `SET depth:<key> <json> PX 1 day` and
 *   `PUBLISH d:<key> <json>`
 *
 * Bounded: at most {@link MAX_PENDING} ticks wait for a write; beyond that the oldest are dropped from the stream batch
 * (the latest quote per key is always kept). Failures are logged at most every 10 s and never thrown: a lost tick is
 * replaced by the next one.
 */
import type { Tick } from "@finlytics/broker-sdk";
import type { RtDepth } from "@finlytics/shared";

import { redisKeys } from "../infra/redis/keys";

import { encodeQuoteUpdate, quoteHashFields, toDepth, toQuoteUpdate } from "./quote-update";
import type { QuoteUpdate } from "./quote-update";

/** The `ticks:<BROKER>` stream's approximate cap. */
export const TICK_STREAM_MAXLEN = 100_000;

/** How long a stored book lives without a refresh. */
export const DEPTH_TTL_MS = 86_400_000;

const MAX_PENDING = 10_000;
/** Day volumes remembered per key, to fill ticks without one (`ltp` mode) in the `q` rows. */
const MAX_VOLUMES = 50_000;
const ERROR_LOG_INTERVAL_MS = 10_000;

/** The ioredis pipeline calls the writer makes. */
export interface TickPipeline {
  xadd(...args: (string | number)[]): unknown;
  hset(key: string, fields: Record<string, string>): unknown;
  set(key: string, value: string, px: "PX", ttlMs: number): unknown;
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
  #depths = new Map<string, RtDepth>();
  readonly #volumes = new Map<string, number>();
  #scheduled = false;
  #flushing: Promise<void> = Promise.resolve();
  #lastErrorAt = Number.NEGATIVE_INFINITY;
  #dropped = 0;
  #lastTickAt: number | undefined;

  constructor(
    private readonly redis: TickWriterTarget,
    readonly broker: string,
    private readonly logger: TickWriterLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** When the last tick arrived (our clock, epoch ms), or undefined before the first. */
  get lastTickAt(): number | undefined {
    return this.#lastTickAt;
  }

  /** Queues a tick; the batch is written on the next event-loop turn. */
  push(tick: Tick): void {
    let update: QuoteUpdate;
    let depth: RtDepth | undefined;
    try {
      update = toQuoteUpdate(tick);
      depth = toDepth(tick);
    } catch (error: unknown) {
      this.#logError(error, "dropped a malformed tick");
      return;
    }
    this.#lastTickAt = this.now();
    if (update.vol === undefined) {
      const vol = this.#volumes.get(update.k);
      if (vol !== undefined) update = { ...update, vol };
    } else {
      if (this.#volumes.size >= MAX_VOLUMES && !this.#volumes.has(update.k)) this.#volumes.clear();
      this.#volumes.set(update.k, update.vol);
    }
    this.#pending.push(update);
    if (depth !== undefined) this.#depths.set(depth.k, depth);
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
    const depths = this.#depths;
    if (batch.length === 0 && depths.size === 0) return;
    this.#pending = [];
    this.#depths = new Map();
    const latest = new Map<string, QuoteUpdate>();
    const pipeline = this.redis.pipeline();
    const stream = redisKeys.ticks(this.broker);
    for (const update of batch) {
      const json = encodeQuoteUpdate(update);
      pipeline.xadd(stream, "MAXLEN", "~", TICK_STREAM_MAXLEN, "*", "k", update.k, "u", json);
      latest.set(update.k, update);
    }
    for (const update of latest.values()) {
      pipeline.hset(redisKeys.quote(update.k), quoteHashFields(update, this.broker));
      pipeline.publish(redisKeys.quoteChannel(update.k), encodeQuoteUpdate(update));
    }
    for (const depth of depths.values()) {
      const json = JSON.stringify(depth);
      pipeline.set(redisKeys.depth(depth.k), json, "PX", DEPTH_TTL_MS);
      pipeline.publish(redisKeys.depthChannel(depth.k), json);
    }
    try {
      await pipeline.exec();
    } catch (error: unknown) {
      this.#logError(error, "could not write ticks to redis");
    }
  }

  /** Waits for queued and in-flight writes (shutdown, or a switch of source). */
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
