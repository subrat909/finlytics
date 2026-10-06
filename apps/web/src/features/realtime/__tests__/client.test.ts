import { afterEach, describe, expect, it, vi } from "vitest";

import { FLUSH_INTERVAL_MS, RealtimeClient, resolveParser } from "../client";
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
  return [key, ltp, "12.5", "0.52", 1_000, ts];
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
