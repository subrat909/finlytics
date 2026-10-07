/**
 * The gateway pod's subscriptions to `q:<key>` (phase 1 plan "Redis keys") and `d:<key>` (phase-1b depth): one
 * dedicated ioredis connection in subscriber mode, ref-counted locally so the pod subscribes to a channel once however
 * many of its sockets want it. ioredis re-subscribes every channel by itself after a reconnect.
 */
import { RtUserEventSchema } from "@finlytics/shared";
import type { InstrumentKey, RtDepth, RtUserEvent } from "@finlytics/shared";
import { Redis } from "ioredis";
import { z } from "zod";

import { decodeDepth, decodeQuoteUpdate } from "../../feed/quote-update";
import type { QuoteUpdate } from "../../feed/quote-update";
import { reconnectDelayMs } from "../../infra/redis/redis.service";
import { redisKeys } from "../../infra/redis/keys";

/** The channel prefixes (`q:`, `d:`): messages on other channels are ignored. */
const QUOTE_PREFIX = redisKeys.quoteChannel("NSE_EQ|X").slice(0, 2);
const DEPTH_PREFIX = redisKeys.depthChannel("NSE_EQ|X").slice(0, 2);

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

/** Local ref-counts of one kind of channel. */
class ChannelCounts {
  readonly #counts = new Map<InstrumentKey, number>();

  constructor(readonly channel: (key: InstrumentKey) => string) {}

  count(key: InstrumentKey): number {
    return this.#counts.get(key) ?? 0;
  }

  /** +1 per key; returns the channels to subscribe (first local holder). */
  add(keys: readonly InstrumentKey[]): string[] {
    const fresh: string[] = [];
    for (const key of keys) {
      const count = this.count(key);
      this.#counts.set(key, count + 1);
      if (count === 0) fresh.push(this.channel(key));
    }
    return fresh;
  }

  /** −1 per key; returns the keys left with no local holder. */
  remove(keys: readonly InstrumentKey[]): InstrumentKey[] {
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
    return idle;
  }

  clear(): void {
    this.#counts.clear();
  }
}

const USER_EVENTS_CHANNEL = redisKeys.userEventsChannel();

/** A message on the user-event channel (published by UserEventsRelay). */
export interface UserEventMessage {
  readonly userId: string;
  readonly kind: RtUserEvent["kind"];
}

const UserEventMessageSchema = z.strictObject({
  userId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  kind: RtUserEventSchema.shape.kind,
});

/** Parses a user-event message; anything malformed is dropped. */
export function decodeUserEvent(message: string): UserEventMessage | undefined {
  try {
    const parsed = UserEventMessageSchema.safeParse(JSON.parse(message));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export class QuoteSubscriber {
  readonly #quotes = new ChannelCounts((key) => redisKeys.quoteChannel(key));
  readonly #depths = new ChannelCounts((key) => redisKeys.depthChannel(key));
  #lastErrorAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly connection: SubscriberConnection,
    onUpdate: (update: QuoteUpdate) => void,
    private readonly logger: QuoteSubscriberLogger,
    onDepth: (depth: RtDepth) => void = () => undefined,
    private readonly onUserEvent: (event: UserEventMessage) => void = () => undefined,
  ) {
    connection.on("message", (channel, message) => {
      if (channel === USER_EVENTS_CHANNEL) {
        const event = decodeUserEvent(message);
        if (event !== undefined) this.onUserEvent(event);
      } else if (channel.startsWith(QUOTE_PREFIX)) {
        const update = decodeQuoteUpdate(message);
        if (update !== undefined && `${QUOTE_PREFIX}${update.k}` === channel) onUpdate(update);
      } else if (channel.startsWith(DEPTH_PREFIX)) {
        const depth = decodeDepth(message);
        if (depth !== undefined && `${DEPTH_PREFIX}${depth.k}` === channel) onDepth(depth);
      }
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

  /** Subscribes the user-event channel once (the gateway's `user:<id>` rooms). */
  async subscribeUserEvents(): Promise<void> {
    await this.connection.subscribe(USER_EVENTS_CHANNEL);
  }

  /** Local quote subscribers of `key`. */
  count(key: InstrumentKey): number {
    return this.#quotes.count(key);
  }

  /** Local depth subscribers of `key`. */
  depthCount(key: InstrumentKey): number {
    return this.#depths.count(key);
  }

  /** +1 local subscriber per key; the first one subscribes the channel. */
  async add(keys: readonly InstrumentKey[]): Promise<void> {
    const fresh = this.#quotes.add(keys);
    if (fresh.length > 0) await this.connection.subscribe(...fresh);
  }

  /** −1 local subscriber per key; the last one unsubscribes the channel. Returns the keys left with none. */
  async remove(keys: readonly InstrumentKey[]): Promise<InstrumentKey[]> {
    const idle = this.#quotes.remove(keys);
    if (idle.length > 0) await this.connection.unsubscribe(...idle.map((key) => redisKeys.quoteChannel(key)));
    return idle;
  }

  /** Depth channels, ref-counted like quotes. */
  async addDepth(keys: readonly InstrumentKey[]): Promise<void> {
    const fresh = this.#depths.add(keys);
    if (fresh.length > 0) await this.connection.subscribe(...fresh);
  }

  async removeDepth(keys: readonly InstrumentKey[]): Promise<InstrumentKey[]> {
    const idle = this.#depths.remove(keys);
    if (idle.length > 0) await this.connection.unsubscribe(...idle.map((key) => redisKeys.depthChannel(key)));
    return idle;
  }

  async close(): Promise<void> {
    this.#quotes.clear();
    this.#depths.clear();
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
