import { afterEach, describe, expect, it, vi } from "vitest";

import { DEPTH_RETRY_MS, FLUSH_INTERVAL_MS, RealtimeClient, resolveParser } from "../client";
import { marketActions, useMarketStore } from "../store";

import { FakeSocket, ManualScheduler, settle } from "./fake-socket";

const NIFTY = "NSE_INDEX|NIFTY 50";
const INFY = "NSE_EQ|INFY";

function setup() {
  const socket = new FakeSocket();
  const scheduler = new ManualScheduler();
  const urls: (string | undefined)[] = [];
  const client = new RealtimeClient({
    url: "http://localhost:4000",
    scheduler,
    createSocket: (url) => {
      urls.push(url);
      return Promise.resolve(socket);
    },
  });
  return { socket, scheduler, client, urls };
}

function row(key: string, ltp: string, ts = 1_700_000_000_000): unknown[] {
  return [key, ltp, "12.5", "0.52", 1_000, ts, "2390", "2410.5", "2385", "2387.5", 5_000, "2399.25"];
}

function book(key: string, bid = "2399.95", t = 1_700_000_000_000) {
  return {
    k: key,
    t,
    bids: [
      [bid, 120, 4],
      ["2399.9", 80, 2],
    ],
    asks: [["2400.05", 50, 1]],
    tbq: 10_000,
    tsq: null,
  };
}

/** Acknowledges every pending `sub` with all its keys accepted. */
function ackSubs(socket: FakeSocket) {
  for (const entry of socket.emitted) {
    if (entry.event !== "sub" || entry.ack === undefined) continue;
    const { keys } = entry.payload as { keys: string[] };
    entry.ack({ ok: keys, rejected: [] });
    entry.ack = undefined;
  }
}

afterEach(() => {
  marketActions.reset();
});

describe("RealtimeClient", () => {
  it("opens no socket until something subscribes", async () => {
    const { client, urls } = setup();
    client.start();
    await settle();
    expect(urls).toEqual([]);
    expect(useMarketStore.getState().connection).toBe("idle");
  });

  it("subscribes a key once however many components want it, and unsubscribes after the last one leaves", async () => {
    const { client, socket, urls } = setup();
    const releaseA = client.subscribe([NIFTY, NIFTY]);
    const releaseB = client.subscribe([NIFTY, INFY]);
    await settle();
    expect(urls).toEqual(["http://localhost:4000"]);
    expect(useMarketStore.getState().connection).toBe("connecting");

    socket.serverConnect();
    expect(useMarketStore.getState().connection).toBe("connected");
    expect(socket.emitsOf("sub")).toEqual([{ keys: [NIFTY, INFY] }]);
    expect(client.countOf(NIFTY)).toBe(2);

    releaseA();
    releaseA(); // a second call releases nothing more
    await settle();
    expect(socket.emitsOf("unsub")).toEqual([]);

    releaseB();
    await settle();
    expect(socket.emitsOf("unsub")).toEqual([{ keys: [NIFTY, INFY] }]);
    expect(client.countOf(NIFTY)).toBe(0);
  });

  it("costs no traffic when a component unmounts and mounts again in the same tick", async () => {
    const { client, socket } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.serverConnect();
    expect(socket.emitsOf("sub")).toHaveLength(1);

    const release = client.subscribe([INFY]);
    release();
    client.subscribe([INFY]);
    await settle();
    expect(socket.emitsOf("sub")).toEqual([{ keys: [NIFTY] }, { keys: [INFY] }]);
    expect(socket.emitsOf("unsub")).toEqual([]);
  });

  it("re-sends every subscription after a reconnect", async () => {
    const { client, socket } = setup();
    client.subscribe([NIFTY, INFY]);
    await settle();
    socket.serverConnect();
    marketActions.setFeed("up");

    socket.serverDisconnect();
    expect(useMarketStore.getState()).toMatchObject({ connection: "reconnecting", feed: "unknown" });
    socket.fire("manager:reconnect_attempt");
    expect(useMarketStore.getState().connection).toBe("reconnecting");

    socket.serverConnect();
    expect(socket.emitsOf("sub")).toEqual([{ keys: [NIFTY, INFY] }, { keys: [NIFTY, INFY] }]);
  });

  it("writes ticks to the store at most every 100 ms, inside an animation frame, latest per key", async () => {
    const { client, socket, scheduler } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.serverConnect();

    socket.fire("q", { t: 1, d: [row(NIFTY, "24000.10")] });
    socket.fire("q", { t: 2, d: [row(NIFTY, "24001.25"), row("NSE_EQ|TCS", "1.00")] });
    expect(useMarketStore.getState().ticks.size).toBe(0);
    scheduler.advance(0);
    expect(scheduler.pendingFrames).toBe(1);
    scheduler.frame();
    const tick = useMarketStore.getState().ticks.get(NIFTY);
    expect(tick).toMatchObject({ ltp: 24001.25, chg: 12.5, chgPct: 0.52, vol: 1_000, receivedAt: scheduler.time });
    expect(tick).toMatchObject({ open: 2390, high: 2410.5, low: 2385, close: 2387.5, oi: 5_000, atp: 2399.25 });
    // Not subscribed: never stored.
    expect(useMarketStore.getState().ticks.has("NSE_EQ|TCS")).toBe(false);

    // The next batch waits for the rest of the 100 ms window.
    socket.fire("q", { t: 3, d: [row(NIFTY, "24002.00")] });
    scheduler.advance(FLUSH_INTERVAL_MS - 1);
    expect(scheduler.pendingFrames).toBe(0);
    scheduler.advance(1);
    scheduler.frame();
    expect(useMarketStore.getState().ticks.get(NIFTY)?.ltp).toBe(24002);
  });

  it("skips malformed rows and messages", async () => {
    const { client, socket, scheduler } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.serverConnect();
    socket.fire("q", "nonsense");
    socket.fire("q", { t: 1, d: [["NSE_INDEX|NIFTY 50", "not a price", "0", "0", 0, 1], row(NIFTY, "10.5")] });
    scheduler.advance(0);
    scheduler.frame();
    expect(useMarketStore.getState().ticks.get(NIFTY)?.ltp).toBe(10.5);
  });

  it("reads rows from a server that still sends six fields, with the day statistics unknown", async () => {
    const { client, socket, scheduler } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.serverConnect();
    socket.fire("q", { t: 1, d: [[NIFTY, "24000", "1", "0.01", 0, 5]] });
    scheduler.advance(0);
    scheduler.frame();
    expect(useMarketStore.getState().ticks.get(NIFTY)).toMatchObject({ ltp: 24000, open: null, oi: null, atp: null });
  });

  it("records which feed drives the prices and whether it is live", async () => {
    const { client, socket } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.serverConnect();
    socket.fire("status", { feed: "up", source: "PAPER", live: false });
    expect(useMarketStore.getState()).toMatchObject({ feed: "up", source: { source: "PAPER", live: false } });
    const before = useMarketStore.getState().source;
    socket.fire("status", { feed: "stale", source: "PAPER", live: false });
    expect(useMarketStore.getState().source).toBe(before);
    socket.fire("status", { feed: "up", source: "UPSTOX", live: true });
    expect(useMarketStore.getState().source).toEqual({ source: "UPSTOX", live: true });
    // A drop keeps the last known source (the footer still says what the prices were); stop forgets it.
    socket.serverDisconnect();
    expect(useMarketStore.getState().source).toEqual({ source: "UPSTOX", live: true });
    client.stop();
    expect(useMarketStore.getState().source).toBeUndefined();
  });

  it("tracks the feed status and the keys the server refused", async () => {
    const { client, socket } = setup();
    client.subscribe([NIFTY, INFY]);
    await settle();
    socket.serverConnect();
    socket.fire("status", { feed: "stale" });
    socket.fire("status", { feed: "sideways" });
    expect(useMarketStore.getState().feed).toBe("stale");

    const ack = socket.emitted.find((entry) => entry.event === "sub")?.ack;
    ack?.({ ok: [NIFTY], rejected: [{ key: INFY, reason: "limit" }] });
    expect(useMarketStore.getState().rejected.get(INFY)).toBe("limit");
  });

  it("marks the socket unavailable when the server refuses it, and retries on demand", async () => {
    const { client, socket } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.active = false;
    socket.fire("connect_error", new Error("UNAUTHENTICATED"));
    expect(useMarketStore.getState().connection).toBe("unavailable");
    socket.fire("manager:reconnect_failed");
    expect(useMarketStore.getState().connection).toBe("unavailable");

    client.retry();
    expect(useMarketStore.getState().connection).toBe("connected");
  });

  it("advances the staleness clock every second while anything is subscribed", async () => {
    const { client, scheduler } = setup();
    const release = client.subscribe([NIFTY]);
    await settle();
    scheduler.advance(3_000);
    expect(useMarketStore.getState().now).toBe(scheduler.time);
    release();
    await settle();
    const frozen = useMarketStore.getState().now;
    scheduler.advance(5_000);
    expect(useMarketStore.getState().now).toBe(frozen);
  });

  it("closes the socket and clears every timer on stop, and resumes on start", async () => {
    const { client, socket, scheduler } = setup();
    client.subscribe([NIFTY]);
    await settle();
    socket.serverConnect();
    socket.fire("q", { t: 1, d: [row(NIFTY, "1")] });

    client.stop();
    expect(socket.closed).toBe(true);
    expect(scheduler.pendingTimers).toBe(0);
    expect(scheduler.pendingFrames).toBe(0);
    expect(useMarketStore.getState().connection).toBe("idle");

    client.start();
    await settle();
    expect(useMarketStore.getState().connection).toBe("connecting");
  });

  it("closes a socket that finishes loading after stop", async () => {
    let resolveSocket: (socket: FakeSocket) => void = () => undefined;
    const socket = new FakeSocket();
    const client = new RealtimeClient({
      scheduler: new ManualScheduler(),
      createSocket: () =>
        new Promise((resolve) => {
          resolveSocket = resolve;
        }),
    });
    client.subscribe([NIFTY]);
    await settle();
    client.stop();
    resolveSocket(socket);
    await settle();
    expect(socket.closed).toBe(true);
  });

  it("reports unavailable when the socket library fails to load", async () => {
    const client = new RealtimeClient({
      scheduler: new ManualScheduler(),
      createSocket: () => Promise.reject(new Error("chunk failed")),
    });
    client.subscribe([NIFTY]);
    await settle();
    expect(useMarketStore.getState().connection).toBe("unavailable");
  });
});

describe("resolveParser", () => {
  it("accepts the module itself or a namespace with it under default", () => {
    const parser = { Encoder: vi.fn(), Decoder: vi.fn() };
    expect(resolveParser(parser)).toBe(parser);
    expect(resolveParser({ default: parser })).toBe(parser);
    expect(() => resolveParser({})).toThrow(TypeError);
  });
});

describe("RealtimeClient market depth", () => {
  it("asks for depth only once the server confirmed the key's quotes, and streams it into the store", async () => {
    const { client, socket, scheduler } = setup();
    const release = client.subscribeDepth(INFY);
    await settle();
    socket.serverConnect();
    expect(socket.emitsOf("sub")).toEqual([{ keys: [INFY] }]);
    expect(socket.emitsOf("dsub")).toEqual([]);
    expect(client.depthCountOf(INFY)).toBe(1);
    expect(client.countOf(INFY)).toBe(1);

    ackSubs(socket);
    await settle();
    expect(socket.emitsOf("dsub")).toEqual([{ key: INFY }]);
    socket.emitted.find((entry) => entry.event === "dsub")?.ack?.({ ok: true });

    socket.fire("depth", book(INFY));
    socket.fire("depth", book(INFY, "2400"));
    socket.fire("depth", { k: INFY, t: 1 }); // malformed: ignored
    socket.fire("depth", book(NIFTY)); // not wanted: ignored
    scheduler.advance(0);
    scheduler.frame();
    const depth = useMarketStore.getState().depth.get(INFY);
    expect(depth).toMatchObject({ tbq: 10_000, tsq: null, receivedAt: scheduler.time });
    expect(depth?.bids[0]).toEqual({ price: 2400, qty: 120, orders: 4 });
    expect(depth?.asks).toEqual([{ price: 2400.05, qty: 50, orders: 1 }]);
    expect(useMarketStore.getState().depth.has(NIFTY)).toBe(false);

    release();
    await settle();
    expect(socket.emitsOf("dunsub")).toEqual([{ key: INFY }]);
    expect(socket.emitsOf("unsub")).toEqual([{ keys: [INFY] }]);
    // dunsub goes before unsub.
    const order = socket.emitted.map((entry) => entry.event);
    expect(order.indexOf("dunsub")).toBeLessThan(order.indexOf("unsub"));
    expect(useMarketStore.getState().depth.has(INFY)).toBe(false);
  });

  it("shares one depth stream between components and keeps the quotes of a key still shown", async () => {
    const { client, socket } = setup();
    const releaseQuotes = client.subscribe([INFY]);
    const releaseA = client.subscribeDepth(INFY);
    const releaseB = client.subscribeDepth(INFY);
    await settle();
    socket.serverConnect();
    ackSubs(socket);
    await settle();
    expect(socket.emitsOf("dsub")).toEqual([{ key: INFY }]);
    releaseA();
    releaseA();
    await settle();
    expect(socket.emitsOf("dunsub")).toEqual([]);
    releaseB();
    await settle();
    expect(socket.emitsOf("dunsub")).toEqual([{ key: INFY }]);
    expect(socket.emitsOf("unsub")).toEqual([]);
    releaseQuotes();
    await settle();
    expect(socket.emitsOf("unsub")).toEqual([{ keys: [INFY] }]);
  });

  it("never asks for depth of a key the server refused to stream", async () => {
    const { client, socket } = setup();
    client.subscribeDepth(INFY);
    await settle();
    socket.serverConnect();
    socket.emitted[0]?.ack?.({ ok: [], rejected: [{ key: INFY, reason: "limit" }] });
    await settle();
    expect(socket.emitsOf("dsub")).toEqual([]);
    expect(useMarketStore.getState().rejected.get(INFY)).toBe("limit");
  });

  it("asks again at the depth limit once another depth key is released", async () => {
    const { client, socket } = setup();
    const releaseNifty = client.subscribeDepth(NIFTY);
    client.subscribeDepth(INFY);
    await settle();
    socket.serverConnect();
    ackSubs(socket);
    await settle();
    expect(socket.emitsOf("dsub")).toEqual([{ key: NIFTY }, { key: INFY }]);
    const infyAck = socket.emitted.filter((entry) => entry.event === "dsub")[1]?.ack;
    infyAck?.({ ok: false, reason: "limit" });
    expect(useMarketStore.getState().depthRejected.get(INFY)).toBe("limit");

    releaseNifty();
    await settle();
    // NIFTY's stream is withdrawn; INFY, refused at the limit, is asked for again (no dunsub for it).
    expect(socket.emitsOf("dunsub")).toEqual([{ key: NIFTY }]);
    expect(socket.emitsOf("dsub")).toEqual([{ key: NIFTY }, { key: INFY }, { key: INFY }]);
    socket.emitted.filter((entry) => entry.event === "dsub")[2]?.ack?.({ ok: true });
    expect(useMarketStore.getState().depthRejected.has(INFY)).toBe(false);
  });

  it("retries depth after a pause when the server was busy, and gives up on a final refusal", async () => {
    const { client, socket, scheduler } = setup();
    client.subscribeDepth(INFY);
    client.subscribeDepth(NIFTY);
    await settle();
    socket.serverConnect();
    ackSubs(socket);
    await settle();
    const acks = socket.emitted.filter((entry) => entry.event === "dsub").map((entry) => entry.ack);
    acks[0]?.({ ok: false, reason: "rate_limited" });
    acks[1]?.({ ok: false, reason: "unknown_instrument" });
    scheduler.advance(DEPTH_RETRY_MS - 1);
    await settle();
    expect(socket.emitsOf("dsub")).toHaveLength(2);
    scheduler.advance(1);
    await settle();
    expect(socket.emitsOf("dsub")).toEqual([{ key: INFY }, { key: NIFTY }, { key: INFY }]);
    scheduler.advance(DEPTH_RETRY_MS * 3);
    await settle();
    expect(socket.emitsOf("dsub")).toHaveLength(3);
  });

  it("re-sends depth after a reconnect, ignores acks from the old connection and clears retries on stop", async () => {
    const { client, socket, scheduler } = setup();
    client.subscribeDepth(INFY);
    await settle();
    socket.serverConnect();
    ackSubs(socket);
    await settle();
    const staleAck = socket.emitted.find((entry) => entry.event === "dsub")?.ack;

    socket.serverDisconnect();
    staleAck?.({ ok: false, reason: "rate_limited" });
    expect(useMarketStore.getState().depthRejected.size).toBe(0);
    expect(scheduler.pendingTimers).toBe(1); // only the staleness clock

    socket.serverConnect();
    expect(socket.emitsOf("sub")).toHaveLength(2);
    ackSubs(socket);
    await settle();
    expect(socket.emitsOf("dsub")).toEqual([{ key: INFY }, { key: INFY }]);
    socket.emitted.filter((entry) => entry.event === "dsub")[1]?.ack?.({ ok: false, reason: "unavailable" });
    expect(scheduler.pendingTimers).toBe(2);

    client.stop();
    expect(scheduler.pendingTimers).toBe(0);
  });
});
