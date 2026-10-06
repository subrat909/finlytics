/**
 * The gateway pod's subscriptions to `q:<key>` (phase 1 plan "Redis keys"): one dedicated ioredis connection in
 * subscriber mode, ref-counted locally so the pod subscribes to a channel once however many of its sockets want it.
 * ioredis re-subscribes every channel by itself after a reconnect.
 */
import type { InstrumentKey } from "@finlytics/shared";
import { Redis } from "ioredis";

import { decodeQuoteUpdate } from "../../feed/quote-update";
import type { QuoteUpdate } from "../../feed/quote-update";
import { reconnectDelayMs } from "../../infra/redis/redis.service";
import { redisKeys } from "../../infra/redis/keys";

/** The channel prefix (`q:`): messages on other channels are ignored. */
const CHANNEL_PREFIX = redisKeys.quoteChannel("NSE_EQ|X").slice(0, 2);

export interface QuoteSubscriberLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

/** The subscriber-mode calls the class makes (a fake in unit tests). */
export interface SubscriberConnection {
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
  readonly status?: string;
}

export class QuoteSubscriber {
  readonly #counts = new Map<InstrumentKey, number>();
  #lastErrorAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly connection: SubscriberConnection,
    onUpdate: (update: QuoteUpdate) => void,
    private readonly logger: QuoteSubscriberLogger,
  ) {
    connection.on("message", (channel, message) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const update = decodeQuoteUpdate(message);
      if (update !== undefined && `${CHANNEL_PREFIX}${update.k}` === channel) onUpdate(update);
    });
    connection.on("error", (error) => {
      const now = Date.now();
      if (now - this.#lastErrorAt < 10_000) return;
      this.#lastErrorAt = now;
      logger.warn({ err: error }, "quote subscriber connection error");
    });
  }

  /** A subscriber connection for `redisUrl`: reconnects forever with the request client's backoff. */
  static connect(redisUrl: string): Redis {
    return new Redis(redisUrl, {
      // Connects on the first subscribe.
      lazyConnect: true,
      connectionName: "finlytics-rt-quotes",
      maxRetriesPerRequest: null,
      retryStrategy: (attempt) => reconnectDelayMs(attempt),
    });
  }

  /** Local subscribers of `key`. */
  count(key: InstrumentKey): number {
    return this.#counts.get(key) ?? 0;
  }

  /** +1 local subscriber per key; the first one subscribes the channel. */
  async add(keys: readonly InstrumentKey[]): Promise<void> {
    const fresh: string[] = [];
    for (const key of keys) {
      const count = this.count(key);
      this.#counts.set(key, count + 1);
      if (count === 0) fresh.push(redisKeys.quoteChannel(key));
    }
    if (fresh.length > 0) await this.connection.subscribe(...fresh);
  }

  /** −1 local subscriber per key; the last one unsubscribes the channel. Returns the keys left with none. */
  async remove(keys: readonly InstrumentKey[]): Promise<InstrumentKey[]> {
    const idle: InstrumentKey[] = [];
    for (const key of keys) {
      const count = this.count(key);
      if (count <= 1) {
        this.#counts.delete(key);
        if (count === 1) idle.push(key);
      } else {
        this.#counts.set(key, count - 1);
      }
    }
    if (idle.length > 0) await this.connection.unsubscribe(...idle.map((key) => redisKeys.quoteChannel(key)));
    return idle;
  }

  async close(): Promise<void> {
    this.#counts.clear();
    if (this.connection.status !== undefined && this.connection.status !== "ready") {
      this.connection.disconnect();
      return;
    }
    try {
      await this.connection.quit();
    } catch {
      this.connection.disconnect();
    }
  }
}
