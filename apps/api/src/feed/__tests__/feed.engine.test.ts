import { BrokerRejectedError, NeedsReloginError, TypedEmitter } from "@finlytics/broker-sdk";
import type { FeedLimits, FeedMode, FeedStatus, MarketFeed, MarketFeedEvents, Tick } from "@finlytics/broker-sdk";
import type { InstrumentKey } from "@finlytics/shared";
import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../../config/env.schema";
import { DefaultFeedConnector, planModes, UNAVAILABLE_FEED_ACCOUNT_ACCESS } from "../feed-connector";
import type { FeedConnection, FeedConnector } from "../feed-connector";
import { FeedSourceSelector, NO_ACCOUNT_REASON } from "../feed-selector";
import type { FeedAccountCandidate, FeedAccountDirectory } from "../feed-selector";
import { parseFeedSourceHash, parseFeedStatus } from "../feed-source";
import type { FeedTarget } from "../feed-source";
import { createFeedConnector, createFeedSelector, feedAccountAccess } from "../feed.module";
import { FeedEngine } from "../feed.service";
import type { FeedRedis } from "../feed.service";
import type { LockStore } from "../leader-lock";
import { decodeQuoteUpdate } from "../quote-update";

const A = "NSE_EQ|RELIANCE" as InstrumentKey;
const B = "NSE_EQ|TCS" as InstrumentKey;
const NIFTY = "NSE_INDEX|NIFTY 50" as InstrumentKey;
const PINNED = [NIFTY];

class FakeFeed implements MarketFeed {
  readonly events = new TypedEmitter<MarketFeedEvents>();
  readonly subs = new Map<InstrumentKey, FeedMode>();
  status: FeedStatus = "up";
  closed = false;
  /** Keys the broker refuses. */
  refuse = new Set<InstrumentKey>();

  subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    if (keys.some((key) => this.refuse.has(key))) return Promise.reject(new Error("unknown instrument"));
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
  /** Went down (and won't come back by itself when `error` is a refusal). */
  down(error?: unknown): void {
    this.status = "down";
    this.events.emit("status", "down");
    if (error !== undefined) this.events.emit("error", error);
  }
}

class FakeRedis implements FeedRedis {
  readonly sets = new Map<string, Set<string>>();
  readonly strings = new Map<string, string>();
  readonly hashes = new Map<string, Record<string, string>>();
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
  hset(key: string, fields: Record<string, string>): Promise<unknown> {
    this.hashes.set(key, { ...this.hashes.get(key), ...fields });
    return Promise.resolve(1);
  }
  pipeline() {
    const batch: unknown[][] = [];
    return {
      xadd: (...args: (string | number)[]) => batch.push(["xadd", ...args]),
      hset: (key: string, fields: Record<string, string>) => batch.push(["hset", key, fields]),
      set: (key: string, value: string, px: string, ttl: number) => batch.push(["set", key, value, px, ttl]),
      publish: (channel: string, message: string) => batch.push(["publish", channel, message]),
      exec: () => {
        if (this.failExec) return Promise.reject(new Error("redis down"));
        this.commands.push(...batch);
        return Promise.resolve([]);
      },
    };
  }
  want(...keys: string[]): void {
    this.sets.set("subs:wanted", new Set(keys));
    for (const key of keys) this.strings.set(`subs:${key}`, "1");
  }
  source() {
    return parseFeedSourceHash(this.hashes.get("feed:source") ?? {});
  }
  status(broker: string) {
    return parseFeedStatus(this.strings.get(`feed:status:${broker}`));
  }
}

/** A connector scripted per broker: each connect takes the next result (a feed or an error). */
class ScriptedConnector implements FeedConnector {
  readonly calls: FeedTarget[] = [];
  readonly scripts = new Map<string, (FakeFeed | Error)[]>();
  limits: FeedLimits | undefined;
  capacity = 5_000;
  unmapped = new Set<InstrumentKey>();

  script(broker: string, ...results: (FakeFeed | Error)[]): this {
    this.scripts.set(broker, [...(this.scripts.get(broker) ?? []), ...results]);
    return this;
  }

  connect(target: FeedTarget): Promise<FeedConnection> {
    this.calls.push(target);
    const next = this.scripts.get(target.broker)?.shift();
    if (next === undefined) return Promise.reject(new Error(`${target.broker} down`));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      target,
      feed: next,
      capacity: this.capacity,
      limits: target.broker === "PAPER" ? undefined : this.limits,
      mapKeys: (keys) => Promise.resolve(new Set(keys.filter((key) => !this.unmapped.has(key)))),
    });
  }
}

class FakeDirectory implements FeedAccountDirectory {
  accounts: FeedAccountCandidate[] = [];
  synced = new Set<string>(["UPSTOX", "DHAN"]);

  active(accountId: string): Promise<FeedAccountCandidate | null> {
    return Promise.resolve(this.accounts.find((account) => account.accountId === accountId) ?? null);
  }
  candidates(): Promise<FeedAccountCandidate[]> {
    return Promise.resolve([...this.accounts]);
  }
  hasInstruments(broker: string): Promise<boolean> {
    return Promise.resolve(this.synced.has(broker));
  }
}

const alwaysLeader: LockStore = { hold: () => Promise.resolve(true), release: () => Promise.resolve() };

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

interface SetupOptions {
  mode?: "auto" | "paper" | "upstox" | "dhan";
  accountId?: string;
  graceMs?: number;
  lockStore?: LockStore;
}

function setup(connector: ScriptedConnector, options: SetupOptions = {}) {
  const redis = new FakeRedis();
  const directory = new FakeDirectory();
  const released: string[] = [];
  const log = logger();
  const purge = { goLive: vi.fn(() => Promise.resolve()) };
  const onRefused = vi.fn(() => Promise.resolve());
  const selector = new FeedSourceSelector(options.mode ?? "paper", options.accountId, directory, () => Date.now());
  const engine = new FeedEngine({
    connector,
    selector,
    redis,
    lockStore: options.lockStore ?? alwaysLeader,
    releaseIdle: (key) => {
      released.push(key);
      redis.sets.get("subs:wanted")?.delete(key);
      return Promise.resolve(true);
    },
    purge,
    onRefused,
    graceMs: options.graceMs ?? 30_000,
    logger: log,
    pinned: PINNED,
    owner: "test",
    random: () => 0,
  });
  return { engine, redis, directory, released, log, purge, onRefused, selector };
}

describe("FeedEngine on the simulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes the pinned and wanted keys in full mode once elected, and follows the wanted set", async () => {
    const feed = new FakeFeed();
    const { engine, redis } = setup(new ScriptedConnector().script("PAPER", feed));
    redis.want(A);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isLeader).toBe(true);
    expect(engine.subscribedKeys()).toEqual([NIFTY, A]);
    expect(feed.subs.get(A)).toBe("full");
    expect(redis.source()).toMatchObject({ broker: "PAPER", live: false, accountId: null, reason: null });

    redis.want(A, B);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.subscribedKeys().sort()).toEqual([B, NIFTY, A].sort());
    expect(redis.status("PAPER")).toMatchObject({ status: "up" });
    await engine.stop();
  });

  it("unsubscribes a wanted key only after its count stayed at zero for the grace period; pinned keys stay", async () => {
    const feed = new FakeFeed();
    const { engine, redis, released } = setup(new ScriptedConnector().script("PAPER", feed), { graceMs: 3_000 });
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    redis.strings.set(`subs:${A}`, "0");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.subscribedKeys()).toContain(A);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(released).toEqual([A]);
    expect(engine.subscribedKeys()).toEqual([NIFTY]);
    await engine.stop();
  });

  it("keeps a key whose count came back during the grace period", async () => {
    const feed = new FakeFeed();
    const { engine, redis, released } = setup(new ScriptedConnector().script("PAPER", feed), { graceMs: 3_000 });
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    redis.strings.set(`subs:${A}`, "0");
    await vi.advanceTimersByTimeAsync(2_000);
    redis.strings.set(`subs:${A}`, "2");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(released).toEqual([]);
    expect(engine.subscribedKeys()).toContain(A);
    await engine.stop();
  });

  it("retries the simulator with backoff after a failed connect", async () => {
    const feed = new FakeFeed();
    const connector = new ScriptedConnector().script("PAPER", new Error("x"), new Error("y"), feed);
    const { engine, redis, log } = setup(connector);
    redis.want(A);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.subscribedKeys()).toEqual([]);
    expect(redis.status("PAPER")).toMatchObject({ status: "down" });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(connector.calls).toHaveLength(3);
    expect(engine.subscribedKeys()).toContain(A);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }), "market feed connect failed");
    await engine.stop();
  });

  it("opens a new connection when the feed closes under it", async () => {
    const first = new FakeFeed();
    const second = new FakeFeed();
    const { engine, redis } = setup(new ScriptedConnector().script("PAPER", first, second));
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

  it("writes ticks, the quote with its source, and the book; a tick without volume keeps the last one", async () => {
    const feed = new FakeFeed();
    const { engine, redis } = setup(new ScriptedConnector().script("PAPER", feed));
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    const tick: Tick = {
      instrumentKey: A,
      ltp: "2510.5",
      close: "2500",
      ts: 1_000,
      volume: 7,
      depth: { bids: [{ price: "2510.45", qty: 3, orders: 1 }], asks: [{ price: "2510.5", qty: 4 }] },
      tbq: 30,
      tsq: 40,
    };
    feed.events.emit("tick", tick);
    feed.events.emit("tick", { instrumentKey: A, ltp: "2511", close: "2500", ts: 1_001 });
    await vi.advanceTimersByTimeAsync(0);
    await engine.writer?.drain();

    expect(redis.commands.map((command) => command[0])).toEqual(["xadd", "xadd", "hset", "publish", "set", "publish"]);
    expect(redis.commands[0]?.slice(1, 5)).toEqual(["ticks:PAPER", "MAXLEN", "~", 100_000]);
    expect(redis.commands[2]).toEqual([
      "hset",
      `quote:${A}`,
      { ltp: "2511", chg: "11", chgPct: "0.44", vol: "7", ts: "1001", close: "2500", src: "PAPER" },
    ]);
    expect(decodeQuoteUpdate(String(redis.commands[3]?.[2]))).toMatchObject({ k: A, ltp: "2511", vol: 7 });
    expect(redis.commands[4]?.slice(0, 2)).toEqual(["set", `depth:${A}`]);
    expect(JSON.parse(String(redis.commands[4]?.[2]))).toEqual({
      k: A,
      t: 1_000,
      bids: [["2510.45", 3, 1]],
      asks: [["2510.5", 4, 0]],
      tbq: 30,
      tsq: 40,
    });
    expect(redis.commands[5]?.[1]).toBe(`d:${A}`);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(redis.status("PAPER")?.lastTickAt).toBeTypeOf("number");
    await engine.stop();
  });

  it("closes the connection and reports down when it loses the lock", async () => {
    const feed = new FakeFeed();
    let held = true;
    const lockStore: LockStore = { hold: () => Promise.resolve(held), release: () => Promise.resolve() };
    const { engine, redis } = setup(new ScriptedConnector().script("PAPER", feed), { lockStore });
    redis.want(A);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    held = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(engine.isLeader).toBe(false);
    expect(feed.closed).toBe(true);
    expect(engine.subscribedKeys()).toEqual([]);
    expect(redis.status("PAPER")).toMatchObject({ status: "down" });
    await engine.stop();
  });

  it("logs a failed write and keeps going", async () => {
    const feed = new FakeFeed();
    const { engine, redis, log } = setup(new ScriptedConnector().script("PAPER", feed));
    redis.failExec = true;
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    feed.events.emit("tick", { instrumentKey: A, ltp: "1", ts: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await engine.writer?.drain();

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ broker: "PAPER" }),
      "could not write ticks to redis",
    );
    await engine.stop();
  });

  it("skips a key the broker refuses on its own and subscribes the rest", async () => {
    const feed = new FakeFeed();
    feed.refuse.add(B);
    const { engine, redis } = setup(new ScriptedConnector().script("PAPER", feed));
    redis.want(A, B);
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.subscribedKeys().sort()).toEqual([A, NIFTY].sort());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.subscribedKeys()).not.toContain(B);
    await engine.stop();
  });
});

describe("FeedEngine choosing a broker (auto)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drives the feed from the ACTIVE Upstox account, going live once", async () => {
    const live = new FakeFeed();
    const connector = new ScriptedConnector().script("UPSTOX", live);
    const { engine, redis, directory, purge } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-up", broker: "UPSTOX" }];
    redis.want(A);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.source).toEqual({ broker: "UPSTOX", accountId: "acc-up" });
    expect(redis.source()).toMatchObject({ broker: "UPSTOX", live: true, accountId: "acc-up", reason: null });
    expect(purge.goLive).toHaveBeenCalledTimes(1);
    expect(live.subs.get(A)).toBe("full");
    await engine.stop();
  });

  it("runs the simulator with a reason when no account is connected, and switches when one appears", async () => {
    const paper = new FakeFeed();
    const live = new FakeFeed();
    const connector = new ScriptedConnector().script("PAPER", paper).script("DHAN", live);
    const { engine, redis, directory, purge } = setup(connector, { mode: "auto" });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.source).toEqual({ broker: "PAPER" });
    expect(redis.source()).toMatchObject({ broker: "PAPER", live: false, reason: NO_ACCOUNT_REASON });

    directory.accounts = [{ accountId: "acc-dh", broker: "DHAN" }];
    engine.poke();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.source).toEqual({ broker: "DHAN", accountId: "acc-dh" });
    expect(paper.closed).toBe(true);
    expect(purge.goLive).toHaveBeenCalledTimes(1);
    expect(redis.source()).toMatchObject({ broker: "DHAN", live: true, reason: null });
    await engine.stop();
  });

  it("falls back to the simulator with a reason when the token is refused, flags the account, retries later", async () => {
    const paper = new FakeFeed();
    const live = new FakeFeed();
    const connector = new ScriptedConnector()
      .script("UPSTOX", new NeedsReloginError("expired"), live)
      .script("PAPER", paper);
    const { engine, redis, directory, onRefused } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-up", broker: "UPSTOX" }];

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.source).toEqual({ broker: "PAPER" });
    expect(engine.reason).toMatch(/Upstox session has ended/);
    expect(redis.source()).toMatchObject({ broker: "PAPER", live: false });
    expect(redis.source()?.reason).toMatch(/Upstox/);
    expect(onRefused).toHaveBeenCalledWith({ broker: "UPSTOX", accountId: "acc-up" });

    // Re-chosen every 30 s, but the account waits out its 30 s backoff first.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(engine.source).toEqual({ broker: "UPSTOX", accountId: "acc-up" });
    expect(paper.closed).toBe(true);
    await engine.stop();
  });

  it("skips a broker whose instrument master was never synced", async () => {
    const paper = new FakeFeed();
    const connector = new ScriptedConnector().script("PAPER", paper);
    const { engine, directory } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-up", broker: "UPSTOX" }];
    directory.synced.clear();

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.source).toEqual({ broker: "PAPER" });
    expect(engine.reason).toMatch(/instrument list/);
    expect(connector.calls.map((target) => target.broker)).toEqual(["PAPER"]);
    await engine.stop();
  });

  it("re-opens a refused feed once with fresh credentials, then falls back on a second refusal", async () => {
    const first = new FakeFeed();
    const second = new FakeFeed();
    const paper = new FakeFeed();
    const connector = new ScriptedConnector().script("DHAN", first, second).script("PAPER", paper);
    const { engine, directory, onRefused } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-dh", broker: "DHAN" }];
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    first.down(new NeedsReloginError("807"));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.closed).toBe(true);
    expect(engine.source).toEqual({ broker: "DHAN", accountId: "acc-dh" });
    expect(connector.calls).toHaveLength(2);

    second.down(new NeedsReloginError("808"));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.source).toEqual({ broker: "PAPER" });
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(engine.reason).toMatch(/Dhan access token/);
    await engine.stop();
  });

  it("counts a feed rejected while down as a failure at once", async () => {
    const live = new FakeFeed();
    const paper = new FakeFeed();
    const connector = new ScriptedConnector().script("DHAN", live).script("PAPER", paper);
    const { engine, directory } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-dh", broker: "DHAN" }];
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    live.down(new BrokerRejectedError("806"));
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.source).toEqual({ broker: "PAPER" });
    expect(engine.reason).toMatch(/refused the market feed/);
    await engine.stop();
  });

  it("falls back when a broker feed stays down for a minute", async () => {
    const live = new FakeFeed();
    const paper = new FakeFeed();
    const connector = new ScriptedConnector().script("UPSTOX", live).script("PAPER", paper);
    const { engine, directory } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-up", broker: "UPSTOX" }];
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    live.down();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(engine.source).toEqual({ broker: "UPSTOX", accountId: "acc-up" });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(engine.source).toEqual({ broker: "PAPER" });
    expect(engine.reason).toMatch(/Lost the Upstox market feed/);
    await engine.stop();
  });

  it("closes the current feed before moving to another account of the same broker", async () => {
    const first = new FakeFeed();
    const second = new FakeFeed();
    const connector = new ScriptedConnector().script("UPSTOX", first, second);
    const { engine, directory } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-1", broker: "UPSTOX" }];
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    directory.accounts = [{ accountId: "acc-2", broker: "UPSTOX" }];
    engine.poke();
    await vi.advanceTimersByTimeAsync(0);

    expect(first.closed).toBe(true);
    expect(engine.source).toEqual({ broker: "UPSTOX", accountId: "acc-2" });
    await engine.stop();
  });

  it("plans full mode within the broker's limits and skips keys without a token", async () => {
    const live = new FakeFeed();
    const connector = new ScriptedConnector().script("UPSTOX", live);
    connector.limits = {
      single: { ltp: 5, quote: 2, full: 2 },
      mixed: { ltp: 2, quote: 1, full: 1 },
    };
    connector.unmapped.add(B);
    const { engine, redis, directory } = setup(connector, { mode: "auto" });
    directory.accounts = [{ accountId: "acc-up", broker: "UPSTOX" }];
    const C = "NSE_EQ|INFY" as InstrumentKey;
    const D = "NSE_EQ|WIPRO" as InstrumentKey;
    redis.want(A, B, C, D);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    // NIFTY (pinned), then A, C, D sorted: 4 keys > 2 alone → 1 full + 2 ltp; D left out.
    expect(Object.fromEntries(engine.subscriptionModes())).toEqual({ [NIFTY]: "full", [A]: "ltp", [C]: "ltp" });
    await engine.stop();
  });
});

describe("FeedEngine with an explicit broker source", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never falls back to the simulator: reports down with a reason and retries", async () => {
    const live = new FakeFeed();
    const connector = new ScriptedConnector().script("UPSTOX", new Error("network"), live);
    const { engine, redis } = setup(connector, { mode: "upstox", accountId: "acc-up" });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.source).toBeUndefined();
    expect(redis.source()).toMatchObject({ broker: "UPSTOX", live: true });
    expect(redis.source()?.reason).toMatch(/reach/);
    expect(redis.status("UPSTOX")).toMatchObject({ status: "down" });
    expect(connector.calls.map((target) => target.broker)).toEqual(["UPSTOX"]);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(engine.source).toEqual({ broker: "UPSTOX", accountId: "acc-up" });
    expect(connector.calls.every((target) => target.broker === "UPSTOX")).toBe(true);
    await engine.stop();
  });
});

describe("feed wiring", () => {
  const config = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService<Env, true>;

  it("plans modes from the broker's limits", () => {
    const limits: FeedLimits = {
      single: { ltp: 5000, quote: 2000, full: 2000 },
      mixed: { ltp: 2000, quote: 1500, full: 1500 },
    };
    expect(planModes(100, 5000, limits)).toEqual({ full: 100, ltp: 0 });
    expect(planModes(2000, 5000, limits)).toEqual({ full: 2000, ltp: 0 });
    expect(planModes(2500, 5000, limits)).toEqual({ full: 1500, ltp: 1000 });
    expect(planModes(9000, 5000, limits)).toEqual({ full: 1500, ltp: 2000 });
    expect(planModes(10, 5, undefined)).toEqual({ full: 5, ltp: 0 });
  });

  it("builds the simulator connection and refuses a broker without the vault", async () => {
    const connector = createFeedConnector(
      config({ MARKET_FEED_PAPER_SEED: 1, MARKET_FEED_PAPER_TICK_MS: 1_000, MARKET_FEED_ALWAYS_ON: true }),
      UNAVAILABLE_FEED_ACCOUNT_ACCESS,
    );
    expect(connector).toBeInstanceOf(DefaultFeedConnector);
    const paper = await connector.connect({ broker: "PAPER" }, new AbortController().signal);
    expect(paper.feed.status).toBe("up");
    expect(await paper.mapKeys([A])).toEqual(new Set([A]));
    await paper.feed.close();
    await expect(
      connector.connect({ broker: "UPSTOX", accountId: "acc" }, new AbortController().signal),
    ).rejects.toThrow(/vault/);
    expect(await UNAVAILABLE_FEED_ACCOUNT_ACCESS.mapKeys("UPSTOX", [A])).toEqual(new Set());
    await UNAVAILABLE_FEED_ACCOUNT_ACCESS.markNeedsRelogin("acc");
  });

  it("opens a broker account's feed through its gateway with its capabilities", async () => {
    const feed = new FakeFeed();
    const gateway = {
      capabilities: { maxFeedInstruments: 5000, feedLimits: undefined },
      connectMarketFeed: vi.fn(() => Promise.resolve(feed)),
    };
    const access = {
      open: vi.fn(() => Promise.resolve({ gateway: gateway as never, account: { accountId: "acc" } as never })),
      mapKeys: vi.fn(() => Promise.resolve(new Set([A]))),
      markNeedsRelogin: vi.fn(() => Promise.resolve()),
    };
    const connector = new DefaultFeedConnector({ seed: 1, tickMs: 1_000, alwaysOn: true }, access);
    const connection = await connector.connect({ broker: "DHAN", accountId: "acc" }, new AbortController().signal);
    expect(connection.capacity).toBe(5000);
    expect(await connection.mapKeys([A, B])).toEqual(new Set([A]));
    expect(access.mapKeys).toHaveBeenCalledWith("DHAN", [A, B]);
  });

  it("builds the selector from the configured source", async () => {
    const selector = createFeedSelector(
      config({ MARKET_FEED_SOURCE: "dhan", MARKET_FEED_ACCOUNT_ID: "acc" }),
      new FakeDirectory(),
    );
    expect(await selector.select()).toEqual({ target: { broker: "DHAN", accountId: "acc" }, reason: null });
  });
});

describe("feedAccountAccess", () => {
  const connected = (broker: string) => ({
    userId: "u",
    broker,
    ref: { accountId: "acc", creds: {} },
    gateway: { broker },
  });
  const gateways = { gateway: vi.fn((broker: string) => ({ broker }) as never), mapKeys: vi.fn() };

  it("opens the feed account through the broker vault, and flags it with its owner", async () => {
    const markNeedsRelogin = vi.fn(() => Promise.resolve(true));
    const access = feedAccountAccess(
      { systemAccountRef: () => Promise.resolve(connected("UPSTOX") as never), markNeedsRelogin },
      gateways,
    );
    const opened = await access.open("acc", "UPSTOX");
    expect(opened.account.accountId).toBe("acc");
    expect(gateways.gateway).toHaveBeenCalledWith("UPSTOX");
    await access.markNeedsRelogin("acc");
    await access.markNeedsRelogin("unknown");
    expect(markNeedsRelogin).toHaveBeenCalledTimes(1);
    expect(markNeedsRelogin).toHaveBeenCalledWith("u", "acc");
  });

  it("refuses a missing, inactive or foreign-broker account", async () => {
    const markNeedsRelogin = vi.fn();
    await expect(
      feedAccountAccess({ systemAccountRef: () => Promise.resolve(null), markNeedsRelogin }, gateways).open(
        "acc",
        "UPSTOX",
      ),
    ).rejects.toThrow(/not connected/);
    await expect(
      feedAccountAccess(
        { systemAccountRef: () => Promise.resolve(connected("DHAN") as never), markNeedsRelogin },
        gateways,
      ).open("acc", "UPSTOX"),
    ).rejects.toThrow(/not a UPSTOX account/);
  });
});
