import { TypedEmitter } from "@finlytics/broker-sdk";
import type { FeedMode, FeedStatus, MarketFeed, MarketFeedEvents, Tick } from "@finlytics/broker-sdk";
import type { InstrumentKey } from "@finlytics/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.schema";
import { BrokerFeedConnector, PaperFeedConnector, UNAVAILABLE_FEED_ACCOUNT_ACCESS } from "../feed-connector";
import type { FeedConnector } from "../feed-connector";
import { createFeedConnector, feedAccountAccess } from "../feed.module";
import { FeedEngine } from "../feed.service";
import type { FeedRedis } from "../feed.service";
import type { LockStore } from "../leader-lock";
import { decodeQuoteUpdate } from "../quote-update";

const A = "NSE_EQ|RELIANCE" as InstrumentKey;
const B = "NSE_EQ|TCS" as InstrumentKey;

class FakeFeed implements MarketFeed {
  readonly events = new TypedEmitter<MarketFeedEvents>();
  readonly subs = new Map<InstrumentKey, FeedMode>();
  status: FeedStatus = "up";
  closed = false;

  subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    for (const key of keys) this.subs.set(key, mode);
    return Promise.resolve();
  }
  unsubscribe(keys: readonly InstrumentKey[]): Promise<void> {
    for (const key of keys) this.subs.delete(key);
    return Promise.resolve();
  }
  subscriptions(): ReadonlyMap<InstrumentKey, FeedMode> {
    return new Map(this.subs);
  }
  on<E extends keyof MarketFeedEvents>(event: E, listener: (payload: MarketFeedEvents[E]) => void) {
    return this.events.on(event, listener);
  }
  close(): Promise<void> {
    this.closed = true;
    this.status = "closed";
    return Promise.resolve();
  }
  /** The connection dropped for good (as a broker feed reports it). */
  drop(): void {
    this.status = "closed";
    this.events.emit("status", "closed");
  }
}

class FakeRedis implements FeedRedis {
  readonly sets = new Map<string, Set<string>>();
  readonly strings = new Map<string, string>();
  readonly commands: unknown[][] = [];
  failExec = false;

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }
  mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((key) => this.strings.get(key) ?? null));
  }
  set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return Promise.resolve("OK");
  }
  pipeline() {
    const batch: unknown[][] = [];
    return {
      xadd: (...args: (string | number)[]) => batch.push(["xadd", ...args]),
      hset: (key: string, fields: Record<string, string>) => batch.push(["hset", key, fields]),
      publish: (channel: string, message: string) => batch.push(["publish", channel, message]),
      exec: () => {
        if (this.failExec) return Promise.reject(new Error("redis down"));
        this.commands.push(...batch);
        return Promise.resolve([]);
      },
    };
  }
  want(...keys: string[]): void {
    this.sets.set("subs:wanted:PAPER", new Set(keys));
    for (const key of keys) this.strings.set(`subs:${key}`, "1");
  }
}

function createFeedConnectorForTests(source: "paper" | "upstox"): FeedConnector {
  const values: Record<string, unknown> = {
    MARKET_FEED_SOURCE: source,
    MARKET_FEED_PAPER_SEED: 1,
    MARKET_FEED_PAPER_TICK_MS: 1_000,
    MARKET_FEED_ALWAYS_ON: true,
    MARKET_FEED_ACCOUNT_ID: "cm-feed-account",
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  return createFeedConnector(config, UNAVAILABLE_FEED_ACCOUNT_ACCESS);
}

const alwaysLeader: LockStore = { hold: () => Promise.resolve(true), release: () => Promise.resolve() };

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function setup(connector: FeedConnector, options: { graceMs?: number; lockStore?: LockStore } = {}) {
  const redis = new FakeRedis();
  const released: string[] = [];
  const log = logger();
  const engine = new FeedEngine({
    broker: "PAPER",
    connector,
    redis,
    lockStore: options.lockStore ?? alwaysLeader,
    releaseIdle: (key) => {
      released.push(key);
      redis.sets.get("subs:wanted:PAPER")?.delete(key);
      return Promise.resolve(true);
    },
    graceMs: options.graceMs ?? 30_000,
    logger: log,
    owner: "test",
    random: () => 0,
  });
  return { engine, redis, released, log };
}

function connectorOf(...feeds: FakeFeed[]): FeedConnector & { calls: number } {
  const queue = [...feeds];
  return {
    broker: "PAPER",
    calls: 0,
    connect() {
      this.calls += 1;
      const next = queue.shift();
      return next === undefined ? Promise.reject(new Error("broker down")) : Promise.resolve(next);
    },
  };
}

describe("FeedEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes the wanted keys once elected, and follows the wanted set", async () => {
    const feed = new FakeFeed();
    const { engine, redis } = setup(connectorOf(feed));
    redis.want(A);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isLeader).toBe(true);
    expect(engine.subscribedKeys()).toEqual([A]);
    expect(feed.subs.get(A)).toBe("quote");

    redis.want(A, B);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.subscribedKeys().sort()).toEqual([A, B]);
    expect(JSON.parse(redis.strings.get("feed:status:PAPER") ?? "{}")).toMatchObject({ status: "up" });
    await engine.stop();
  });

  it("unsubscribes a key only after its count stayed at zero for the grace period", async () => {
    const feed = new FakeFeed();
    const { engine, redis, released } = setup(connectorOf(feed), { graceMs: 3_000 });
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    redis.strings.set(`subs:${A}`, "0");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.subscribedKeys()).toEqual([A]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(released).toEqual([A]);
    expect(engine.subscribedKeys()).toEqual([]);
    await engine.stop();
  });

  it("keeps a key whose count came back during the grace period", async () => {
    const feed = new FakeFeed();
    const { engine, redis, released } = setup(connectorOf(feed), { graceMs: 3_000 });
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    redis.strings.set(`subs:${A}`, "0");
    await vi.advanceTimersByTimeAsync(2_000);
    redis.strings.set(`subs:${A}`, "2");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(released).toEqual([]);
    expect(engine.subscribedKeys()).toEqual([A]);
    await engine.stop();
  });

  it("reconnects with backoff after a failed connect and re-subscribes everything", async () => {
    const feed = new FakeFeed();
    const connector = connectorOf();
    let attempts = 0;
    connector.connect = () => {
      attempts += 1;
      return attempts < 3 ? Promise.reject(new Error("broker down")) : Promise.resolve(feed);
    };
    const { engine, redis, log } = setup(connector);
    redis.want(A, B);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.subscribedKeys()).toEqual([]);
    expect(JSON.parse(redis.strings.get("feed:status:PAPER") ?? "{}")).toMatchObject({ status: "down" });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toBe(3);
    expect(engine.subscribedKeys().sort()).toEqual([A, B]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }), "market feed connect failed");
    await engine.stop();
  });

  it("opens a new connection when the feed closes under it, then re-subscribes", async () => {
    const first = new FakeFeed();
    const second = new FakeFeed();
    const { engine, redis } = setup(connectorOf(first, second));
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    first.drop();
    await vi.advanceTimersByTimeAsync(0);

    expect(second.subs.has(A)).toBe(true);
    expect(engine.feedStatus).toBe("up");
    await engine.stop();
    expect(second.closed).toBe(true);
  });

  it("writes ticks to the stream, the quote hash and the channel", async () => {
    const feed = new FakeFeed();
    const { engine, redis } = setup(connectorOf(feed));
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    const tick: Tick = { instrumentKey: A, ltp: "2510.5", close: "2500", ts: 1_000, volume: 7 };
    feed.events.emit("tick", tick);
    feed.events.emit("tick", { ...tick, ltp: "2511", ts: 1_001 });
    await vi.advanceTimersByTimeAsync(0);
    await engine.writer.drain();

    const kinds = redis.commands.map((command) => command[0]);
    expect(kinds).toEqual(["xadd", "xadd", "hset", "publish"]);
    expect(redis.commands[0]?.slice(1, 5)).toEqual(["ticks:PAPER", "MAXLEN", "~", 100_000]);
    expect(redis.commands[2]).toEqual([
      "hset",
      `quote:${A}`,
      { ltp: "2511", chg: "11", chgPct: "0.44", vol: "7", ts: "1001", close: "2500" },
    ]);
    expect(decodeQuoteUpdate(String(redis.commands[3]?.[2]))).toMatchObject({ k: A, ltp: "2511" });
    await engine.stop();
  });

  it("closes the connection and reports down when it loses the lock", async () => {
    const feed = new FakeFeed();
    let held = true;
    const lockStore: LockStore = { hold: () => Promise.resolve(held), release: () => Promise.resolve() };
    const { engine, redis } = setup(connectorOf(feed), { lockStore });
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    held = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(engine.isLeader).toBe(false);
    expect(feed.closed).toBe(true);
    expect(engine.subscribedKeys()).toEqual([]);
    expect(JSON.parse(redis.strings.get("feed:status:PAPER") ?? "{}")).toMatchObject({ status: "down" });
    await engine.stop();
  });

  it("logs a failed write and keeps going", async () => {
    const feed = new FakeFeed();
    const { engine, redis, log } = setup(connectorOf(feed));
    redis.failExec = true;
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    feed.events.emit("tick", { instrumentKey: A, ltp: "1", ts: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await engine.writer.drain();

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ broker: "PAPER" }),
      "could not write ticks to redis",
    );
    await engine.stop();
  });

  it("builds connectors for paper and broker sources", async () => {
    const paper = createFeedConnectorForTests("paper");
    expect(paper).toBeInstanceOf(PaperFeedConnector);
    const feed = await paper.connect(new AbortController().signal);
    expect(feed.status).toBe("up");
    await feed.close();

    const broker = createFeedConnectorForTests("upstox");
    expect(broker).toBeInstanceOf(BrokerFeedConnector);
    expect(broker.broker).toBe("UPSTOX");
    await expect(broker.connect(new AbortController().signal)).rejects.toThrow(/vault/);
  });
});

describe("feedAccountAccess", () => {
  const connected = (broker: string) => ({
    userId: "u",
    broker,
    ref: { accountId: "acc", creds: {} },
    gateway: { broker },
  });

  it("opens the platform feed account through the broker vault", async () => {
    const access = feedAccountAccess({
      systemAccountRef: () => Promise.resolve(connected("UPSTOX") as never),
    });
    const opened = await access.open("acc", "UPSTOX");
    expect(opened.account.accountId).toBe("acc");
  });

  it("refuses a missing, inactive or foreign-broker account", async () => {
    await expect(
      feedAccountAccess({ systemAccountRef: () => Promise.resolve(null) }).open("acc", "UPSTOX"),
    ).rejects.toThrow(/not connected/);
    await expect(
      feedAccountAccess({ systemAccountRef: () => Promise.resolve(connected("DHAN") as never) }).open("acc", "UPSTOX"),
    ).rejects.toThrow(/not a UPSTOX account/);
  });
});
