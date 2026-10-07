import type { InstrumentKey, RtDepth } from "@finlytics/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteUpdate } from "../../../feed/quote-update";
import { handshakeClientIp, isAllowedHandshakeOrigin, readCookie, trustedProxies } from "../handshake";
import { QuoteSubscriber } from "../quote-subscriber";
import type { FeedSnapshot } from "../../../feed/feed-source";
import { DepthThrottle } from "../depth-throttle";
import { depthRoom, MAX_MESSAGES_PER_SECOND, RealtimeEngine, statusOf } from "../realtime.engine";
import type { RealtimeEngineOptions, RtNamespace, RtSocket } from "../realtime.engine";
import { TickCoalescer } from "../tick-coalescer";

const A = "NSE_EQ|RELIANCE" as InstrumentKey;
const B = "NSE_EQ|TCS" as InstrumentKey;
const C = "NSE_EQ|INFY" as InstrumentKey;
const IDENTITY = { userId: "user-1", sessionId: "s1", role: "USER" as const };

function update(key: InstrumentKey, ltp: string, ts = 1): QuoteUpdate {
  return { k: key, ltp, chg: "0", chgPct: "0", vol: 0, ts };
}

/** The 12-tuple row of {@link update}. */
function row(key: InstrumentKey, ltp: string, ts = 1): unknown[] {
  return [key, ltp, "0", "0", 0, ts, null, null, null, null, null, null];
}

function book(key: InstrumentKey, t: number): RtDepth {
  return { k: key, t, bids: [["10", 1, 1]], asks: [["10.05", 2, 1]], tbq: 5, tsq: 6 };
}

function snapshot(status: FeedSnapshot["status"], broker: "PAPER" | "UPSTOX" = "PAPER"): FeedSnapshot {
  return {
    source: { broker, live: broker !== "PAPER", accountId: null, since: 0, reason: null },
    status,
  };
}

describe("TickCoalescer", () => {
  it("keeps only the latest update per key between flushes", () => {
    const coalescer = new TickCoalescer(100);
    coalescer.push(update(A, "1", 1));
    coalescer.push(update(A, "2", 2));
    coalescer.push(update(A, "0.5", 0)); // older by exchange time: ignored
    coalescer.push(update(B, "3", 1));

    const due = coalescer.drain(1_000);

    expect([...due.values()].map((entry) => entry.ltp)).toEqual(["2", "3"]);
    expect(coalescer.size).toBe(0);
  });

  it("sends one key at most once per interval, keeping the rest for later", () => {
    const coalescer = new TickCoalescer(100);
    coalescer.push(update(A, "1"));
    expect(coalescer.drain(1_000).size).toBe(1);

    coalescer.push(update(A, "2"));
    expect(coalescer.drain(1_050).size).toBe(0);
    expect(coalescer.size).toBe(1);
    expect(coalescer.drain(1_095).get(A)?.ltp).toBe("2"); // within the jitter allowance

    coalescer.push(update(A, "3"));
    coalescer.forget(A);
    expect(coalescer.size).toBe(0);
  });

  it("caps any instrument at 10 updates a second however fast it ticks", () => {
    const coalescer = new TickCoalescer(100);
    let sent = 0;
    for (let now = 0; now < 1_000; now += 10) {
      coalescer.push(update(A, String(now + 1), now));
      if (now % 100 === 0) sent += coalescer.drain(now).size;
    }
    expect(sent).toBe(10);
  });
});

describe("handshake checks", () => {
  const allowed = new Set(["http://localhost:3000"]);

  it("allows listed origins, same-site fetches and non-browser clients only", () => {
    expect(isAllowedHandshakeOrigin({ origin: "http://localhost:3000" }, allowed)).toBe(true);
    expect(isAllowedHandshakeOrigin({ origin: "https://evil.example" }, allowed)).toBe(false);
    expect(isAllowedHandshakeOrigin({}, allowed)).toBe(true);
    expect(isAllowedHandshakeOrigin({ "sec-fetch-site": "same-origin" }, allowed)).toBe(true);
    expect(isAllowedHandshakeOrigin({ "sec-fetch-site": "cross-site" }, allowed)).toBe(false);
    expect(isAllowedHandshakeOrigin({ origin: ["http://localhost:3000", "x"] }, allowed)).toBe(false);
  });

  it("reads one cookie from the header", () => {
    expect(readCookie("a=1; authjs.session-token=abc ; b=2", "authjs.session-token")).toBe("abc");
    expect(readCookie("a=1; broken; b=2", "b")).toBe("2");
    expect(readCookie(undefined, "a")).toBeUndefined();
    expect(readCookie(["a=1", "c=3"], "c")).toBe("3");
    expect(readCookie("a=1", "b")).toBeUndefined();
  });

  it("finds the client IP behind trusted proxies only", () => {
    const none = trustedProxies(false);
    expect(handshakeClientIp("::ffff:10.0.0.5", "203.0.113.9", none)).toBe("10.0.0.5");

    const proxies = trustedProxies(["10.0.0.0/8", "fd00::1"]);
    expect(handshakeClientIp("10.0.0.5", "198.51.100.1, 203.0.113.9", proxies)).toBe("203.0.113.9");
    expect(handshakeClientIp("10.0.0.5", "198.51.100.1, 10.1.1.1", proxies)).toBe("198.51.100.1");
    expect(handshakeClientIp("fd00::1", "2001:db8::7", proxies)).toBe("2001:db8::7");
    expect(handshakeClientIp("203.0.113.50", "198.51.100.1", proxies)).toBe("203.0.113.50");
    expect(handshakeClientIp(undefined, undefined, proxies)).toBe("");
    expect(proxies("not-an-ip")).toBe(false);
  });
});

describe("QuoteSubscriber", () => {
  function connection() {
    const listeners = new Map<string, (...args: never[]) => void>();
    const fake = {
      subscribed: new Set<string>(),
      status: "ready",
      subscribe: vi.fn((...channels: string[]) => {
        for (const channel of channels) fake.subscribed.add(channel);
        return Promise.resolve();
      }),
      unsubscribe: vi.fn((...channels: string[]) => {
        for (const channel of channels) fake.subscribed.delete(channel);
        return Promise.resolve();
      }),
      on: (event: string, listener: (...args: never[]) => void) => listeners.set(event, listener),
      quit: vi.fn(() => Promise.reject(new Error("closed"))),
      disconnect: vi.fn(),
      emit: (event: string, ...args: unknown[]) =>
        (listeners.get(event) as ((...a: unknown[]) => void) | undefined)?.(...args),
    };
    return fake;
  }

  it("subscribes a channel once per pod and unsubscribes with the last local subscriber", async () => {
    const conn = connection();
    const subscriber = new QuoteSubscriber(conn, () => undefined, { warn: vi.fn() });

    await subscriber.add([A]);
    await subscriber.add([A, B]);
    expect(conn.subscribe).toHaveBeenCalledTimes(2);
    expect([...conn.subscribed].sort()).toEqual([`q:${A}`, `q:${B}`]);

    expect(await subscriber.remove([A])).toEqual([]);
    expect(await subscriber.remove([A, B, C])).toEqual([A, B]);
    expect(conn.subscribed.size).toBe(0);
    expect(subscriber.count(A)).toBe(0);
  });

  it("ref-counts depth channels apart from quote channels and passes on valid books", async () => {
    const conn = connection();
    const books: RtDepth[] = [];
    const subscriber = new QuoteSubscriber(
      conn,
      () => undefined,
      { warn: vi.fn() },
      (depth) => books.push(depth),
    );

    await subscriber.add([A]);
    await subscriber.addDepth([A]);
    await subscriber.addDepth([A]);
    expect([...conn.subscribed].sort()).toEqual([`d:${A}`, `q:${A}`]);
    expect(subscriber.depthCount(A)).toBe(2);

    conn.emit("message", `d:${A}`, JSON.stringify(book(A, 1)));
    conn.emit("message", `d:${B}`, JSON.stringify(book(A, 1)));
    conn.emit("message", `d:${A}`, "garbage");
    expect(books).toHaveLength(1);

    expect(await subscriber.removeDepth([A])).toEqual([]);
    expect(await subscriber.removeDepth([A])).toEqual([A]);
    expect([...conn.subscribed]).toEqual([`q:${A}`]);
    await subscriber.close();
  });

  it("passes on valid updates for the channel they came from only", () => {
    const conn = connection();
    const received: QuoteUpdate[] = [];
    const logger = { warn: vi.fn() };
    new QuoteSubscriber(conn, (value) => received.push(value), logger);

    conn.emit("message", `q:${A}`, JSON.stringify(update(A, "1")));
    conn.emit("message", `q:${B}`, JSON.stringify(update(A, "1")));
    conn.emit("message", "other", JSON.stringify(update(A, "1")));
    conn.emit("message", `q:${A}`, "garbage");
    conn.emit("error", new Error("down"));
    conn.emit("error", new Error("down again"));

    expect(received).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("disconnects when quitting fails or the connection never opened", async () => {
    const ready = connection();
    await new QuoteSubscriber(ready, () => undefined, { warn: vi.fn() }).close();
    expect(ready.disconnect).toHaveBeenCalledTimes(1);

    const lazy = connection();
    lazy.status = "wait";
    await new QuoteSubscriber(lazy, () => undefined, { warn: vi.fn() }).close();
    expect(lazy.quit).not.toHaveBeenCalled();
    expect(lazy.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("statusOf", () => {
  it("maps the leader's report and tick freshness to up, stale or down, with the source", () => {
    const now = 100_000;
    const up = { status: "up", ts: now, lastTickAt: null };
    expect(statusOf(snapshot(undefined), now, true, now)).toEqual({ feed: "down", source: "PAPER", live: false });
    expect(statusOf(snapshot({ ...up, ts: now - 20_000 }), now, true, now).feed).toBe("down");
    expect(statusOf(snapshot(up, "UPSTOX"), now, true, now - 1_000)).toEqual({
      feed: "up",
      source: "UPSTOX",
      live: true,
    });
    expect(statusOf(snapshot(up), now, true, now - 6_000).feed).toBe("stale");
    expect(statusOf(snapshot(up), now, false, 0).feed).toBe("up");
    expect(statusOf(snapshot({ ...up, status: "degraded" }), now, true, now).feed).toBe("stale");
    expect(statusOf(snapshot({ ...up, status: "connecting" }), now, true, now).feed).toBe("down");
  });
});

describe("DepthThrottle", () => {
  it("keeps the newest book per key and sends each key at most 4 times a second", () => {
    const throttle = new DepthThrottle();
    throttle.push(book(A, 2));
    throttle.push(book(A, 1)); // older: ignored
    expect(throttle.drain(1_000).get(A)?.t).toBe(2);

    throttle.push(book(A, 3));
    expect(throttle.drain(1_100).size).toBe(0);
    expect(throttle.size).toBe(1);
    expect(throttle.drain(1_245).get(A)?.t).toBe(3); // within the jitter allowance

    let sent = 0;
    for (let now = 2_000; now < 3_000; now += 100) {
      throttle.push(book(A, now));
      sent += throttle.drain(now).size;
    }
    expect(sent).toBe(4);
    throttle.sent(B, 5_000);
    throttle.push(book(B, 1));
    expect(throttle.drain(5_100).size).toBe(0);
    throttle.forget(B);
    expect(throttle.size).toBe(0);
  });
});

class FakeSocket implements RtSocket {
  readonly rooms = new Set<string>();
  readonly emitted: { event: string; payload: unknown }[] = [];

  constructor(readonly id: string) {}

  join(room: string): void {
    this.rooms.add(room);
  }
  leave(room: string): void {
    this.rooms.delete(room);
  }
  emit(event: string, payload: unknown): boolean {
    this.emitted.push({ event, payload });
    return true;
  }
  events(name: string): unknown[] {
    return this.emitted.filter((entry) => entry.event === name).map((entry) => entry.payload);
  }
}

function harness(overrides: Partial<RealtimeEngineOptions["repository"]> = {}) {
  let now = 1_000_000;
  const counts = new Map<string, number>();
  const sockets = new Map<string, FakeSocket>();
  const broadcasts: unknown[] = [];
  const backedUp = new Set<string>();
  let feed: FeedSnapshot = snapshot({ status: "up", ts: now, lastTickAt: null });
  const repository = {
    acquire: vi.fn((keys: readonly InstrumentKey[]) => {
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
      return Promise.resolve();
    }),
    release: vi.fn((keys: readonly InstrumentKey[]) => {
      for (const key of keys) counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
      return Promise.resolve();
    }),
    snapshots: vi.fn((keys: readonly InstrumentKey[]) => Promise.resolve(keys.map((key) => update(key, "9")))),
    feedSnapshot: vi.fn(() =>
      Promise.resolve({ ...feed, status: feed.status === undefined ? undefined : { ...feed.status, ts: now } }),
    ),
    depthSnapshot: vi.fn((key: InstrumentKey) => Promise.resolve<RtDepth | undefined>(book(key, 1))),
    activeInstrumentKeys: vi.fn((keys: readonly InstrumentKey[]) =>
      Promise.resolve(new Set(keys.filter((key) => key !== C))),
    ),
  };
  if (overrides.acquire !== undefined) repository.acquire.mockImplementation(overrides.acquire);
  if (overrides.activeInstrumentKeys !== undefined) {
    repository.activeInstrumentKeys.mockImplementation(overrides.activeInstrumentKeys);
  }
  const quotes = {
    add: vi.fn(() => Promise.resolve()),
    remove: vi.fn((keys: readonly InstrumentKey[]) => Promise.resolve([...keys])),
    addDepth: vi.fn(() => Promise.resolve()),
    removeDepth: vi.fn((keys: readonly InstrumentKey[]) => Promise.resolve([...keys])),
    close: vi.fn(() => Promise.resolve()),
  };
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const engine = new RealtimeEngine({ repository, quotes, logger, now: () => now });
  const namespace: RtNamespace = {
    roomMembers: (room) => {
      const members = new Set(
        [...sockets.values()].filter((socket) => socket.rooms.has(room)).map((socket) => socket.id),
      );
      return members.size === 0 ? undefined : members;
    },
    socket: (id) => sockets.get(id),
    broadcastLocal: (_event, payload) => broadcasts.push(payload),
    backedUp: (id) => backedUp.has(id),
  };
  engine.attach(namespace);
  const connect = (id: string, max = 100): FakeSocket => {
    const socket = new FakeSocket(id);
    sockets.set(id, socket);
    engine.register(socket, IDENTITY, max);
    return socket;
  };
  return {
    engine,
    repository,
    quotes,
    logger,
    counts,
    broadcasts,
    backedUp,
    connect,
    advance: (ms: number) => (now += ms),
    now: () => now,
    setFeed: (next: FeedSnapshot) => {
      feed = next;
    },
  };
}

describe("RealtimeEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setImmediate"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells a new socket the feed state", () => {
    const { connect } = harness();
    expect(connect("s1").events("status")).toEqual([{ feed: "down", source: "PAPER", live: false }]);
  });

  it("subscribes valid active keys, counts them in Redis and sends a snapshot after the ack", async () => {
    const { engine, connect, counts, quotes } = harness();
    const socket = connect("s1");

    const ack = await engine.subscribe("s1", { keys: [A, B, "bad key", C, A] });

    expect(ack).toEqual({
      ok: [A, B],
      rejected: [
        { key: "bad key", reason: "invalid_key" },
        { key: C, reason: "unknown_instrument" },
      ],
    });
    expect(counts.get(A)).toBe(1);
    expect(socket.rooms).toEqual(new Set([A, B]));
    expect(quotes.add).toHaveBeenCalledWith([A, B]);
    expect(socket.events("q")).toEqual([]);
    vi.runAllTicks();
    await vi.runAllTimersAsync();
    const snapshots = socket.events("q") as { t: number; d: unknown[] }[];
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.d).toEqual([row(A, "9"), row(B, "9")]);
  });

  it("answers an already subscribed key as ok without counting it twice", async () => {
    const { engine, connect, counts } = harness();
    connect("s1");
    await engine.subscribe("s1", { keys: [A] });

    expect(await engine.subscribe("s1", { keys: [A] })).toEqual({ ok: [A], rejected: [] });
    expect(counts.get(A)).toBe(1);
  });

  it("rejects keys beyond the plan's limit", async () => {
    const { engine, connect } = harness();
    connect("s1", 1);

    expect(await engine.subscribe("s1", { keys: [A, B] })).toEqual({
      ok: [A],
      rejected: [{ key: B, reason: "limit" }],
    });
    expect(engine.keysOf("s1")).toEqual([A]);
  });

  it("rejects malformed messages, unknown sockets and message floods", async () => {
    const { engine, connect } = harness();
    connect("s1");

    expect(await engine.subscribe("s1", { keys: "x" })).toEqual({ ok: [], rejected: [] });
    expect(await engine.subscribe("s1", { keys: [1, A] })).toEqual({
      ok: [],
      rejected: [{ key: A, reason: "invalid_key" }],
    });
    expect(await engine.subscribe("nobody", { keys: [A] })).toEqual({ ok: [], rejected: [] });
    expect(await engine.unsubscribe("nobody", { keys: [A] })).toEqual({ ok: [] });
    for (let index = 0; index < MAX_MESSAGES_PER_SECOND; index += 1) await engine.subscribe("s1", { keys: [A] });
    expect(await engine.subscribe("s1", { keys: [B] })).toEqual({
      ok: [],
      rejected: [{ key: B, reason: "rate_limited" }],
    });
    expect(await engine.unsubscribe("s1", { keys: [A] })).toEqual({ ok: [] });
  });

  it("refuses keys as unavailable when Redis or the database fails", async () => {
    const failingRedis = harness({ acquire: () => Promise.reject(new Error("redis down")) });
    failingRedis.connect("s1");
    expect(await failingRedis.engine.subscribe("s1", { keys: [A] })).toEqual({
      ok: [],
      rejected: [{ key: A, reason: "unavailable" }],
    });
    expect(failingRedis.engine.keysOf("s1")).toEqual([]);

    const failingDb = harness({ activeInstrumentKeys: () => Promise.reject(new Error("db down")) });
    failingDb.connect("s1");
    expect(await failingDb.engine.subscribe("s1", { keys: [A] })).toEqual({
      ok: [],
      rejected: [{ key: A, reason: "unavailable" }],
    });
  });

  it("caches known instruments instead of asking the database every time", async () => {
    const { engine, connect, repository } = harness();
    connect("s1");
    connect("s2");
    await engine.subscribe("s1", { keys: [A] });
    await engine.subscribe("s2", { keys: [A] });

    expect(repository.activeInstrumentKeys).toHaveBeenCalledTimes(1);
  });

  it("keeps the subscription when the quote channel subscribe fails", async () => {
    const { engine, connect, quotes, logger } = harness();
    quotes.add.mockRejectedValueOnce(new Error("redis down"));
    connect("s1");

    expect((await engine.subscribe("s1", { keys: [A] })).ok).toEqual([A]);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "could not subscribe to quote channels");
  });

  it("unsubscribes only keys the socket holds and releases their counts", async () => {
    const { engine, connect, counts, quotes } = harness();
    const socket = connect("s1");
    await engine.subscribe("s1", { keys: [A, B] });

    expect(await engine.unsubscribe("s1", { keys: [A, C, "bad"] })).toEqual({ ok: [A] });
    expect(await engine.unsubscribe("s1", { nope: true })).toEqual({ ok: [] });
    expect(counts.get(A)).toBe(0);
    expect(socket.rooms).toEqual(new Set([B]));
    expect(quotes.remove).toHaveBeenCalledWith([A]);
  });

  it("releases everything a socket held when it disconnects", async () => {
    const { engine, connect, counts, logger, repository } = harness();
    connect("s1");
    await engine.subscribe("s1", { keys: [A, B] });
    repository.release.mockRejectedValueOnce(new Error("redis down"));

    await engine.unregister("s1");
    await engine.unregister("s1");

    expect(engine.keysOf("s1")).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "could not release subscriptions");
    expect(counts.get(A)).toBe(1); // the failed release is left to the operator: logged, not retried
  });

  it("flushes one coalesced q per socket with only its keys", async () => {
    const { engine, connect, advance, now, backedUp } = harness();
    const s1 = connect("s1");
    const s2 = connect("s2");
    const s3 = connect("s3");
    await engine.subscribe("s1", { keys: [A, B] });
    await engine.subscribe("s2", { keys: [B] });
    await engine.subscribe("s3", { keys: [A] });
    backedUp.add("s3");

    engine.onQuote(update(A, "1"));
    engine.onQuote(update(A, "2"));
    engine.onQuote(update(B, "3"));
    engine.onQuote(update(C, "4")); // nobody here holds it
    engine.flush(now());

    expect(s1.events("q")).toEqual([
      {
        t: now(),
        d: [row(A, "2"), row(B, "3")],
      },
    ]);
    expect(s2.events("q")).toEqual([{ t: now(), d: [row(B, "3")] }]);
    expect(s3.events("q")).toEqual([]);

    engine.onQuote(update(A, "5"));
    advance(50);
    engine.flush(now());
    expect(s1.events("q")).toHaveLength(1);
    advance(50);
    engine.flush(now());
    expect(s1.events("q")).toHaveLength(2);
    engine.flush(now()); // nothing pending
  });

  it("broadcasts status changes only: the state, the source and whether it is live", async () => {
    const { engine, broadcasts, repository, connect, advance, setFeed } = harness();
    await engine.refreshStatus();
    await engine.refreshStatus();
    expect(broadcasts).toEqual([{ feed: "up", source: "PAPER", live: false }]);

    connect("s1");
    await engine.subscribe("s1", { keys: [A] });
    advance(6_000);
    await engine.refreshStatus();
    expect(broadcasts.at(-1)).toEqual({ feed: "stale", source: "PAPER", live: false });

    engine.onQuote(update(A, "1"));
    setFeed(snapshot({ status: "up", ts: 0, lastTickAt: null }, "UPSTOX"));
    await engine.refreshStatus();
    expect(broadcasts.at(-1)).toEqual({ feed: "up", source: "UPSTOX", live: true });
    expect(engine.status.live).toBe(true);

    repository.feedSnapshot.mockRejectedValue(new Error("redis down"));
    await engine.refreshStatus();
    expect(engine.feedState).toBe("down");
    expect(engine.status.source).toBe("UPSTOX");
  });

  it("releases every socket and closes the quote connection on shutdown", async () => {
    const { engine, connect, counts, quotes } = harness();
    connect("s1");
    connect("s2");
    await engine.subscribe("s1", { keys: [A] });
    await engine.subscribe("s2", { keys: [A] });

    await engine.close();

    expect(counts.get(A)).toBe(0);
    expect(quotes.close).toHaveBeenCalledTimes(1);
  });

  it("starts its timers once, and stops them on close", async () => {
    vi.useFakeTimers();
    const { engine, repository } = harness();
    engine.start();
    engine.start();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(repository.feedSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    await engine.close();
  });
});

describe("RealtimeEngine depth", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setImmediate"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams depth only for keys the socket holds, sends the stored book after the ack", async () => {
    const { engine, connect, quotes, repository } = harness();
    const socket = connect("s1");
    await engine.subscribe("s1", { keys: [A] });

    expect(await engine.depthSubscribe("s1", { key: B })).toEqual({ ok: false, reason: "invalid_key" });
    expect(await engine.depthSubscribe("s1", { key: "bad key" })).toEqual({ ok: false, reason: "invalid_key" });
    expect(await engine.depthSubscribe("s1", { nope: 1 })).toEqual({ ok: false, reason: "invalid_key" });
    expect(await engine.depthSubscribe("nobody", { key: A })).toEqual({ ok: false, reason: "invalid_key" });

    expect(await engine.depthSubscribe("s1", { key: A })).toEqual({ ok: true });
    expect(await engine.depthSubscribe("s1", { key: A })).toEqual({ ok: true });
    expect(quotes.addDepth).toHaveBeenCalledTimes(1);
    expect(socket.rooms.has(depthRoom(A))).toBe(true);
    expect(engine.depthKeysOf("s1")).toEqual([A]);
    vi.runAllTicks();
    await vi.runAllTimersAsync();
    expect(socket.events("depth")).toEqual([book(A, 1)]);
    expect(repository.depthSnapshot).toHaveBeenCalledWith(A);
  });

  it("holds at most three depth streams per socket", async () => {
    const { engine, connect } = harness();
    connect("s1");
    const keys = ["NSE_EQ|A1", "NSE_EQ|A2", "NSE_EQ|A3", "NSE_EQ|A4"] as InstrumentKey[];
    await engine.subscribe("s1", { keys });
    for (const key of keys.slice(0, 3)) expect(await engine.depthSubscribe("s1", { key })).toEqual({ ok: true });
    expect(await engine.depthSubscribe("s1", { key: keys[3] })).toEqual({ ok: false, reason: "limit" });
  });

  it("counts depth messages against the per-socket rate limit", async () => {
    const { engine, connect } = harness();
    connect("s1");
    await engine.subscribe("s1", { keys: [A] });
    for (let index = 1; index < MAX_MESSAGES_PER_SECOND; index += 1) await engine.depthSubscribe("s1", { key: A });
    expect(await engine.depthSubscribe("s1", { key: A })).toEqual({ ok: false, reason: "rate_limited" });
    expect(await engine.depthUnsubscribe("s1", { key: A })).toEqual({ ok: false });
  });

  it("refuses depth as unavailable when the channel can't be subscribed", async () => {
    const { engine, connect, quotes } = harness();
    connect("s1");
    await engine.subscribe("s1", { keys: [A] });
    quotes.addDepth.mockRejectedValueOnce(new Error("redis down"));
    expect(await engine.depthSubscribe("s1", { key: A })).toEqual({ ok: false, reason: "unavailable" });
    expect(engine.depthKeysOf("s1")).toEqual([]);
  });

  it("flushes books to the key's depth room at most 4 times a second, skipping slow sockets", async () => {
    const { engine, connect, advance, now, backedUp } = harness();
    const s1 = connect("s1");
    const s2 = connect("s2");
    const s3 = connect("s3");
    for (const id of ["s1", "s2", "s3"]) await engine.subscribe(id, { keys: [A] });
    await engine.depthSubscribe("s1", { key: A });
    await engine.depthSubscribe("s3", { key: A });
    backedUp.add("s3");
    vi.runAllTicks();
    await vi.runAllTimersAsync();
    const before = s1.events("depth").length;

    engine.onDepth(book(A, 2));
    engine.onDepth(book(B, 2)); // nobody streams it here
    engine.flush(now());
    expect(s1.events("depth").slice(before)).toEqual([book(A, 2)]);
    expect(s2.events("depth")).toEqual([]);
    expect(s3.events("depth")).toEqual([book(A, 1)]); // the snapshot only: its transport is backed up

    engine.onDepth(book(A, 3));
    advance(100);
    engine.flush(now());
    expect(s1.events("depth").length).toBe(before + 1);
    advance(150);
    engine.flush(now());
    expect(s1.events("depth").length).toBe(before + 2);
  });

  it("stops a depth stream on dunsub, on unsub of the key and on disconnect", async () => {
    const { engine, connect, quotes } = harness();
    const socket = connect("s1");
    const C2 = "NSE_EQ|C2" as InstrumentKey;
    await engine.subscribe("s1", { keys: [A, B, C2] });
    await engine.depthSubscribe("s1", { key: A });
    await engine.depthSubscribe("s1", { key: B });
    await engine.depthSubscribe("s1", { key: C2 });

    expect(await engine.depthUnsubscribe("s1", { key: A })).toEqual({ ok: true });
    expect(await engine.depthUnsubscribe("s1", { key: A })).toEqual({ ok: false });
    expect(await engine.depthUnsubscribe("s1", { bad: true })).toEqual({ ok: false });
    expect(socket.rooms.has(depthRoom(A))).toBe(false);

    await engine.unsubscribe("s1", { keys: [B] });
    expect(engine.depthKeysOf("s1")).toEqual([C2]);
    expect(quotes.removeDepth).toHaveBeenCalledWith([B]);

    quotes.removeDepth.mockRejectedValueOnce(new Error("redis down"));
    await engine.unregister("s1");
    expect(engine.depthKeysOf("s1")).toEqual([]);
    expect(quotes.removeDepth).toHaveBeenCalledWith([C2]);
  });

  it("skips a missing or failed depth snapshot", async () => {
    const { engine, connect, repository, logger } = harness();
    const socket = connect("s1");
    await engine.subscribe("s1", { keys: [A, B] });
    repository.depthSnapshot.mockResolvedValueOnce(undefined);
    repository.depthSnapshot.mockRejectedValueOnce(new Error("redis down"));
    await engine.depthSubscribe("s1", { key: A });
    await engine.depthSubscribe("s1", { key: B });
    vi.runAllTicks();
    await vi.runAllTimersAsync();
    expect(socket.events("depth")).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith(expect.anything(), "depth snapshot failed");
  });
});
