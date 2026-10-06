import type { InstrumentKey } from "@finlytics/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteUpdate } from "../../../feed/quote-update";
import { handshakeClientIp, isAllowedHandshakeOrigin, readCookie, trustedProxies } from "../handshake";
import { QuoteSubscriber } from "../quote-subscriber";
import { feedState, MAX_MESSAGES_PER_SECOND, RealtimeEngine } from "../realtime.engine";
import type { RealtimeEngineOptions, RtNamespace, RtSocket } from "../realtime.engine";
import { TickCoalescer } from "../tick-coalescer";

const A = "NSE_EQ|RELIANCE" as InstrumentKey;
const B = "NSE_EQ|TCS" as InstrumentKey;
const C = "NSE_EQ|INFY" as InstrumentKey;
const IDENTITY = { userId: "user-1", sessionId: "s1", role: "USER" as const };

function update(key: InstrumentKey, ltp: string, ts = 1): QuoteUpdate {
  return { k: key, ltp, chg: "0", chgPct: "0", vol: 0, ts };
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

describe("feedState", () => {
  it("maps the leader's report and tick freshness to up, stale or down", () => {
    const now = 100_000;
    expect(feedState(undefined, now, true, now)).toBe("down");
    expect(feedState({ status: "up", ts: now - 20_000 }, now, true, now)).toBe("down");
    expect(feedState({ status: "up", ts: now }, now, true, now - 1_000)).toBe("up");
    expect(feedState({ status: "up", ts: now }, now, true, now - 6_000)).toBe("stale");
    expect(feedState({ status: "up", ts: now }, now, false, 0)).toBe("up");
    expect(feedState({ status: "degraded", ts: now }, now, true, now)).toBe("stale");
    expect(feedState({ status: "connecting", ts: now }, now, true, now)).toBe("down");
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
  const repository = {
    acquire: vi.fn((_broker: string, keys: readonly InstrumentKey[]) => {
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
      return Promise.resolve();
    }),
    release: vi.fn((keys: readonly InstrumentKey[]) => {
      for (const key of keys) counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
      return Promise.resolve();
    }),
    snapshots: vi.fn((keys: readonly InstrumentKey[]) => Promise.resolve(keys.map((key) => update(key, "9")))),
    feedStatus: vi.fn(() => Promise.resolve<{ status: string; ts: number } | undefined>({ status: "up", ts: now })),
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
    close: vi.fn(() => Promise.resolve()),
  };
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const engine = new RealtimeEngine({ broker: "PAPER", repository, quotes, logger, now: () => now });
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
    expect(connect("s1").events("status")).toEqual([{ feed: "down" }]);
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
    expect(snapshots[0]?.d).toEqual([
      [A, "9", "0", "0", 0, 1],
      [B, "9", "0", "0", 0, 1],
    ]);
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
        d: [
          [A, "2", "0", "0", 0, 1],
          [B, "3", "0", "0", 0, 1],
        ],
      },
    ]);
    expect(s2.events("q")).toEqual([{ t: now(), d: [[B, "3", "0", "0", 0, 1]] }]);
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

  it("broadcasts feed state changes only", async () => {
    const { engine, broadcasts, repository, connect, advance } = harness();
    await engine.refreshStatus();
    await engine.refreshStatus();
    expect(broadcasts).toEqual([{ feed: "up" }]);

    connect("s1");
    await engine.subscribe("s1", { keys: [A] });
    advance(6_000);
    repository.feedStatus.mockResolvedValue({ status: "up", ts: Number.MAX_SAFE_INTEGER });
    await engine.refreshStatus();
    expect(broadcasts).toEqual([{ feed: "up" }, { feed: "stale" }]);

    repository.feedStatus.mockRejectedValue(new Error("redis down"));
    await engine.refreshStatus();
    expect(engine.feedState).toBe("down");
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
    expect(repository.feedStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    await engine.close();
  });
});
