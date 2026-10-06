import type { InstrumentKey } from "@finlytics/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isBrokerError } from "../../../errors";
import type { FeedStatus, MarketFeed, OrderFeed } from "../../../feed/feed";
import type { OrderUpdate, Tick } from "../../../models";
import type { UpstoxAdapterOptions } from "../adapter";
import { nativeUpstoxSocket } from "../feed";
import type { UpstoxInstrumentResolver } from "../instruments";
import { UPSTOX_URLS } from "../types";

import { encodeFeed, fixture, fixtureBytes, fixtureText, json, upstoxErrorBody } from "./fake-upstox";
import type { FakeSocket, FakeUpstoxOptions } from "./fake-upstox";
import { NIFTY_CE, NIFTY_CE_TOKEN, NIFTY_INDEX, niftyOrder, UNKNOWN_KEY, upstoxSetup, YESBANK } from "./setup";

const FEED_OPTIONS: Partial<UpstoxAdapterOptions> = {
  feed: { backoff: { baseMs: 100, maxMs: 1000, random: () => 0 }, heartbeatMs: 1000, quietHeartbeatMs: 10_000 },
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function errorCode(error: unknown): string | undefined {
  return isBrokerError(error) ? error.code : undefined;
}

async function marketSetup(options: Partial<UpstoxAdapterOptions> = {}, fakeOptions: FakeUpstoxOptions = {}) {
  const setup = upstoxSetup({ ...FEED_OPTIONS, ...options }, fakeOptions);
  const feed: MarketFeed = await setup.adapter.connectMarketFeed(setup.ctx());
  const ticks: Tick[] = [];
  const statuses: FeedStatus[] = [];
  const errors: unknown[] = [];
  feed.on("tick", (tick) => ticks.push(tick));
  feed.on("status", (status) => statuses.push(status));
  feed.on("error", (error) => errors.push(error));
  return { ...setup, feed, ticks, statuses, errors };
}

function authorizeCount(requests: readonly { url: string }[], url: string): number {
  return requests.filter((request) => request.url.startsWith(url)).length;
}

describe("Upstox market feed", () => {
  it("authorizes, connects to the single-use URL and reports up", async () => {
    const { feed, fake } = await marketSetup();
    expect(feed.status).toBe("up");
    expect(fake.requests.map((request) => request.url)).toEqual([UPSTOX_URLS.marketFeedAuthorize]);
    expect(fake.market().url).toBe("wss://fake.upstox.test/market?code=single-use-1");
    await feed.close();
  });

  it("subscribes in Upstox's modes with JSON requests in binary frames", async () => {
    const { feed, fake } = await marketSetup();
    const socket = fake.market();
    await feed.subscribe([NIFTY_CE, NIFTY_CE], "quote");
    await feed.subscribe([NIFTY_INDEX, YESBANK], "full");
    await feed.subscribe([NIFTY_CE], "quote");
    await feed.subscribe([NIFTY_INDEX], "quote");
    await feed.subscribe([NIFTY_CE], "ltp");
    expect(socket.sent.every((frame) => frame instanceof Uint8Array)).toBe(true);
    expect(socket.requests()).toEqual([
      { guid: "guid-1", method: "sub", data: { mode: "option_greeks", instrumentKeys: [NIFTY_CE_TOKEN] } },
      {
        guid: "guid-2",
        method: "sub",
        data: { mode: "full", instrumentKeys: ["NSE_INDEX|Nifty 50", "NSE_EQ|INE528G01035"] },
      },
      { guid: "guid-3", method: "change_mode", data: { mode: "ltpc", instrumentKeys: [NIFTY_CE_TOKEN] } },
    ]);
    expect(feed.subscriptions()).toEqual(
      new Map([
        [NIFTY_CE, "ltp"],
        [NIFTY_INDEX, "quote"],
        [YESBANK, "full"],
      ]),
    );

    await feed.unsubscribe([NIFTY_CE, UNKNOWN_KEY]);
    await feed.unsubscribe([]);
    expect(socket.requests().at(-1)).toEqual({
      guid: "guid-4",
      method: "unsub",
      data: { instrumentKeys: [NIFTY_CE_TOKEN] },
    });
    expect(socket.sent).toHaveLength(4);
    await feed.close();
  });

  it("refuses keys Upstox doesn't know, subscribing none of the batch", async () => {
    const { feed, fake } = await marketSetup();
    const error = await rejection(feed.subscribe([NIFTY_CE, UNKNOWN_KEY], "ltp"));
    expect(errorCode(error)).toBe("VALIDATION");
    expect((error as Error).message).toContain(UNKNOWN_KEY);
    expect(feed.subscriptions().size).toBe(0);
    expect(fake.market().sent).toHaveLength(0);
    await feed.close();
  });

  it("enforces Upstox's individual and combined subscription limits", async () => {
    const anything: UpstoxInstrumentResolver = {
      byKeys: (keys) =>
        Promise.resolve(new Map(keys.map((key) => [key, { instrumentKey: key, brokerToken: `T|${key}` }]))),
      byTokens: () => Promise.resolve(new Map()),
    };
    const { feed } = await marketSetup({ instruments: anything });
    const keys = (count: number, prefix: string): InstrumentKey[] =>
      Array.from({ length: count }, (_, index) => `NSE_INDEX|${prefix}${String(index)}` as InstrumentKey);

    const tooMany = await rejection(feed.subscribe(keys(2001, "F"), "full"));
    expect(errorCode(tooMany)).toBe("BROKER_REJECTED");
    expect((tooMany as Error).message).toContain("2000");

    await feed.subscribe(keys(1600, "F"), "full");
    const mixed = await rejection(feed.subscribe(keys(1, "L"), "ltp"));
    expect((mixed as Error).message).toContain("1500");
    expect(feed.subscriptions().size).toBe(1600);
    await feed.close();
  });

  it("emits ticks for held keys from binary frames and ignores everything else", async () => {
    const { feed, fake, ticks, errors } = await marketSetup();
    await feed.subscribe([NIFTY_CE, NIFTY_INDEX], "full");
    const socket = fake.market();
    const full = fixtureBytes("feed-full.bin");
    socket.push(full);
    socket.push(new Uint8Array(full).buffer);
    socket.push("text frame");
    socket.push(fixtureBytes("feed-market-info.bin"));
    socket.push(encodeFeed({ type: "live_feed", feeds: { "NSE_FO|0": { ltpc: { ltp: 1 } } } }));
    socket.push(encodeFeed({ feeds: { [NIFTY_CE_TOKEN]: { requestMode: "ltpc" } } }));
    expect(ticks.map((tick) => tick.instrumentKey)).toEqual([NIFTY_CE, NIFTY_INDEX, NIFTY_CE, NIFTY_INDEX]);
    expect(ticks[0]).toMatchObject({ ltp: "219.3", bid: "219.25", greeks: { delta: 0.4521 } });
    expect(ticks[1]).not.toHaveProperty("greeks");
    expect(errors).toEqual([]);

    socket.push(new Uint8Array([0x0a, 0xff, 0xff, 0xff]));
    expect(errors.map(errorCode)).toEqual(["BROKER_UNAVAILABLE"]);

    const noTime = encodeFeed({ feeds: { [NIFTY_CE_TOKEN]: { ltpc: { ltp: 5 } } } });
    const before = Date.now();
    socket.push(noTime);
    expect(ticks.at(-1)?.ts).toBeGreaterThanOrEqual(before);
    await feed.close();
  });

  it("reports socket errors after connecting without dropping the feed", async () => {
    const { feed, fake, errors } = await marketSetup();
    fake.market().handlers.onError(new Error("socket hiccup"));
    expect(errors).toEqual([new Error("socket hiccup")]);
    expect(feed.status).toBe("up");
    await feed.close();
  });

  it("closes for good: idempotent, no requests after, late frames ignored", async () => {
    const { feed, fake, statuses } = await marketSetup();
    await feed.subscribe([NIFTY_CE], "ltp");
    const socket = fake.market();
    await feed.close();
    await feed.close();
    expect(feed.status).toBe("closed");
    expect(statuses).toEqual(["closed"]);
    expect(socket.closeCode).toBe(1000);
    expect(feed.subscriptions().size).toBe(0);
    expect(errorCode(await rejection(feed.subscribe([NIFTY_CE], "ltp")))).toBe("BROKER_UNAVAILABLE");
    await feed.unsubscribe([NIFTY_CE]);
    expect(socket.sent).toHaveLength(1);
  });
});

describe("Upstox market feed: connecting", () => {
  it.each([
    ["the socket is refused", "refuse", "BROKER_UNAVAILABLE"],
    ["the handshake fails", "error", undefined],
  ] as const)("rejects when %s", async (_name, open, code) => {
    const setup = upstoxSetup(FEED_OPTIONS, { socketOpen: () => open });
    const error = await rejection(setup.adapter.connectMarketFeed(setup.ctx()));
    if (code === undefined) expect(error).toEqual(new Error("handshake failed"));
    else expect(errorCode(error)).toBe(code);
  });

  it("wraps a non-Error socket failure", async () => {
    const setup = upstoxSetup({
      ...FEED_OPTIONS,
      webSocket: (_url, handlers) => {
        queueMicrotask(() => {
          handlers.onError("boom");
        });
        return { send: () => undefined, close: () => undefined };
      },
    });
    expect(errorCode(await rejection(setup.adapter.connectMarketFeed(setup.ctx())))).toBe("BROKER_UNAVAILABLE");
  });

  it("asks for a re-login when the token can't authorize the feed", async () => {
    const setup = upstoxSetup(FEED_OPTIONS);
    const error = await rejection(
      setup.adapter.connectMarketFeed({ signal: new AbortController().signal, creds: setup.expiredCreds }),
    );
    expect(errorCode(error)).toBe("NEEDS_RELOGIN");
    expect(setup.fake.sockets).toHaveLength(0);
  });

  it("gives up when the caller aborts while the socket is opening, and closes it", async () => {
    const setup = upstoxSetup(FEED_OPTIONS, { socketOpen: () => "hang" });
    const controller = new AbortController();
    const pending = setup.adapter.connectMarketFeed(setup.ctx(controller.signal));
    await vi.waitFor(() => {
      expect(setup.fake.sockets).toHaveLength(1);
    });
    controller.abort(new Error("timed out"));
    expect(await rejection(pending)).toEqual(new Error("timed out"));
    expect(setup.fake.sockets[0]?.closed).toBe(true);
  });

  it("gives up when the caller aborts during the authorize call", async () => {
    const controller = new AbortController();
    const setup = upstoxSetup({
      ...FEED_OPTIONS,
      fetch: () => {
        controller.abort(new Error("shutdown"));
        return Promise.resolve(json(fixture("market-feed-authorize.json")));
      },
    });
    expect(await rejection(setup.adapter.connectMarketFeed(setup.ctx(controller.signal)))).toEqual(
      new Error("shutdown"),
    );
  });
});

describe("Upstox market feed: reconnect and heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconnects with backoff after a drop and re-subscribes every held key", async () => {
    const { feed, fake, statuses, errors } = await marketSetup();
    await feed.subscribe([NIFTY_CE], "quote");
    await feed.subscribe([NIFTY_INDEX, YESBANK], "full");
    fake.market().drop();
    expect(feed.status).toBe("down");
    expect(errors.map(errorCode)).toEqual(["BROKER_UNAVAILABLE"]);

    await feed.subscribe([CRUDE], "ltp");
    await vi.advanceTimersByTimeAsync(49);
    expect(fake.marketSockets()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(feed.status).toBe("up");
    });
    expect(statuses).toEqual(["down", "connecting", "up"]);
    expect(fake.market().url).toBe("wss://fake.upstox.test/market?code=single-use-2");
    expect(
      fake
        .market()
        .requests()
        .map((request) => request.data),
    ).toEqual([
      { mode: "option_greeks", instrumentKeys: [NIFTY_CE_TOKEN] },
      { mode: "full", instrumentKeys: ["NSE_INDEX|Nifty 50", "NSE_EQ|INE528G01035"] },
      { mode: "ltpc", instrumentKeys: ["MCX_FO|436953"] },
    ]);
    await feed.close();
  });

  it("keeps retrying while Upstox is unavailable and stops once the token is invalid", async () => {
    const { feed, fake, statuses } = await marketSetup();
    const authorize = new URL(UPSTOX_URLS.marketFeedAuthorize).pathname;
    fake.respond(authorize, json({}, 503));
    fake.respond(authorize, json(upstoxErrorBody("UDAPI100050", "Invalid token used to access API"), 401));
    fake.market().drop();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(authorizeCount(fake.requests, UPSTOX_URLS.marketFeedAuthorize)).toBe(3);
    expect(statuses).toEqual(["down", "connecting", "down", "connecting", "down"]);
    expect(feed.status).toBe("down");
    await feed.close();
    expect(feed.status).toBe("closed");
  });

  it("retries when the new socket is refused", async () => {
    let refuse = false;
    const { feed, fake } = await marketSetup({}, { socketOpen: () => (refuse ? "refuse" : "open") });
    refuse = true;
    fake.market().drop();
    await vi.advanceTimersByTimeAsync(50);
    refuse = false;
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(feed.status).toBe("up");
    });
    expect(fake.marketSockets()).toHaveLength(3);
    await feed.close();
  });

  it("does not reconnect after close, even with a retry pending", async () => {
    const { feed, fake } = await marketSetup();
    fake.market().drop();
    await feed.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(authorizeCount(fake.requests, UPSTOX_URLS.marketFeedAuthorize)).toBe(1);
  });

  it("stops a reconnect that is still authorizing when the feed closes", async () => {
    let hold = false;
    const setup = upstoxSetup({
      ...FEED_OPTIONS,
      fetch: (url, init) =>
        hold
          ? new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => {
                reject(new Error("aborted"));
              });
            })
          : setup.fake.fetch(url, init),
    });
    const feed = await setup.adapter.connectMarketFeed(setup.ctx());
    const statuses: FeedStatus[] = [];
    feed.on("status", (status) => statuses.push(status));
    hold = true;
    setup.fake.market().drop();
    await vi.advanceTimersByTimeAsync(50);
    expect(feed.status).toBe("connecting");
    await feed.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(statuses).toEqual(["down", "connecting", "closed"]);
    expect(setup.fake.marketSockets()).toHaveLength(1);
  });

  it("probes a silent feed, reports degraded, and recovers when Upstox answers", async () => {
    const { feed, fake, statuses } = await marketSetup();
    await feed.subscribe([NIFTY_CE], "ltp");
    const socket = fake.market();
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.status).toBe("degraded");
    expect(socket.requests().at(-1)).toMatchObject({ method: "sub", data: { instrumentKeys: [NIFTY_CE_TOKEN] } });
    fake.emitLtpc(NIFTY_CE_TOKEN, 220);
    expect(feed.status).toBe("up");
    expect(statuses).toEqual(["degraded", "up"]);
    await feed.close();
  });

  it("reconnects when the probe goes unanswered", async () => {
    const { feed, fake } = await marketSetup();
    await feed.subscribe([NIFTY_CE], "ltp");
    const socket = fake.market();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.closeCode).toBe(4000);
    expect(feed.status).toBe("down");
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      expect(feed.status).toBe("up");
    });
    expect(fake.market()).not.toBe(socket);
    await feed.close();
  });

  it("allows long silence while every segment is closed, and none is watched without keys", async () => {
    const quiet = await marketSetup();
    await quiet.feed.subscribe([NIFTY_CE], "ltp");
    const socket = quiet.fake.market();
    socket.push(
      encodeFeed({
        type: "market_info",
        marketInfo: { segmentStatus: { NSE_FO: "NORMAL_CLOSE", NSE_EQ: "CLOSING_END" } },
      }),
    );
    const sent = socket.sent.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(socket.sent).toHaveLength(sent);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.sent).toHaveLength(sent + 1);
    expect(quiet.feed.status).toBe("up");
    await quiet.feed.close();

    const idle = await marketSetup();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(idle.fake.market().sent).toHaveLength(0);
    expect(idle.feed.status).toBe("up");
    await idle.feed.close();
  });
});

const CRUDE = "MCX_FO|CRUDEOIL|2025-11-19" as InstrumentKey;

describe("Upstox order feed", () => {
  async function orderSetup(fakeOptions: FakeUpstoxOptions = {}) {
    const setup = upstoxSetup(FEED_OPTIONS, fakeOptions);
    const feed: OrderFeed = await setup.adapter.connectOrderFeed(setup.ctx());
    const updates: OrderUpdate[] = [];
    const errors: unknown[] = [];
    const statuses: FeedStatus[] = [];
    feed.on("order", (update) => updates.push(update));
    feed.on("error", (error) => errors.push(error));
    feed.on("status", (status) => statuses.push(status));
    const socket = (): FakeSocket => {
      const open = setup.fake.orderSockets().filter((candidate) => !candidate.closed);
      const last = open.at(-1);
      if (last === undefined) throw new Error("no order socket");
      return last;
    };
    return { ...setup, feed, updates, errors, statuses, socket };
  }

  it("authorizes the portfolio stream for order updates only", async () => {
    const { feed, fake } = await orderSetup();
    expect(fake.requests[0]?.url).toBe(`${UPSTOX_URLS.portfolioFeedAuthorize}?update_types=order`);
    expect(feed.status).toBe("up");
    await feed.close();
  });

  it("publishes the documented order update", async () => {
    const { feed, updates, socket } = await orderSetup();
    socket().push(new TextEncoder().encode(fixtureText("order-update.json")));
    await vi.waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    expect(updates[0]).toEqual({
      brokerClientId: "******",
      order: {
        brokerOrderId: "240221025997024",
        instrumentKey: "NSE_EQ|NHPC",
        side: "BUY",
        type: "MARKET",
        product: "DELIVERY",
        validity: "DAY",
        qty: 1,
        filledQty: 0,
        status: "PENDING",
        placedAt: "2024-02-21T14:40:02+05:30",
        updatedAt: "2024-02-21T14:40:02+05:30",
      },
    });
    await feed.close();
  });

  it("publishes updates for orders placed through the adapter, in order", async () => {
    const { feed, adapter, ctx, updates } = await orderSetup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), niftyOrder({ type: "LIMIT", price: "50" }));
    await adapter.cancelOrder(ctx(), brokerOrderId);
    await vi.waitFor(() => {
      expect(updates.map((update) => update.order.status)).toEqual(["OPEN", "CANCELLED"]);
    });
    await feed.close();
  });

  it("ignores other update types and unknown instruments, and reports unreadable updates", async () => {
    const { feed, updates, errors, socket } = await orderSetup();
    const update = fixture("order-update.json") as Record<string, unknown>;
    socket().push(JSON.stringify({ update_type: "position", instrument_token: "NSE_EQ|INE848E01016" }));
    socket().push(JSON.stringify([1, 2]));
    socket().push(JSON.stringify({ ...update, instrument_key: "NSE_EQ|INE000000000" }));
    socket().push(JSON.stringify({ ...update, product: "XX" }));
    socket().push("not json");
    socket().push(JSON.stringify({ update_type: "order", order_id: 7 }));
    socket().push(JSON.stringify({ ...update, user_id: null, instrument_key: null }));
    socket().push(JSON.stringify({ ...update, user_id: null, userId: null }));
    await vi.waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[0]?.brokerClientId).toBe("******");
    expect(updates[1]).not.toHaveProperty("brokerClientId");
    expect(errors.map(errorCode)).toEqual(["BROKER_UNAVAILABLE", "BROKER_UNAVAILABLE"]);
    const first = socket();
    await feed.close();
    first.handlers.onMessage(JSON.stringify(update));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updates).toHaveLength(2);
  });

  it("reconnects after a drop", async () => {
    vi.useFakeTimers();
    try {
      const { feed, fake, statuses } = await orderSetup();
      fake.orderSockets()[0]?.drop();
      await vi.advanceTimersByTimeAsync(50);
      await vi.waitFor(() => {
        expect(feed.status).toBe("up");
      });
      expect(statuses).toEqual(["down", "connecting", "up"]);
      expect(fake.orderSockets()).toHaveLength(2);
      await feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops updates that resolve after close", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setup = upstoxSetup({
      ...FEED_OPTIONS,
      instruments: {
        byKeys: () => Promise.resolve(new Map()),
        byTokens: async (tokens) => {
          await gate;
          return new Map(tokens.map((token) => [token, YESBANK]));
        },
      },
    });
    const feed = await setup.adapter.connectOrderFeed(setup.ctx());
    const updates: OrderUpdate[] = [];
    feed.on("order", (update) => updates.push(update));
    setup.fake.orderSockets()[0]?.push(fixtureText("order-update.json"));
    await feed.close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updates).toEqual([]);
  });
});

describe("nativeUpstoxSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires Node's WebSocket: binary as ArrayBuffer, events, send and close", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const instances: FakeWebSocket[] = [];
    class FakeWebSocket {
      binaryType = "blob";
      readonly send = vi.fn();
      readonly close = vi.fn();
      constructor(readonly url: string) {
        instances.push(this);
      }
      addEventListener(type: string, listener: (event: unknown) => void): void {
        listeners.set(type, listener);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const socket = nativeUpstoxSocket("wss://xyz.upstox.com/feed?code=x", handlers);
    const native = instances[0];
    expect(native?.url).toBe("wss://xyz.upstox.com/feed?code=x");
    expect(native?.binaryType).toBe("arraybuffer");

    listeners.get("open")?.({});
    listeners.get("message")?.({ data: "frame" });
    listeners.get("close")?.({ code: 1006, reason: "gone" });
    listeners.get("error")?.({});
    expect(handlers.onOpen).toHaveBeenCalledOnce();
    expect(handlers.onMessage).toHaveBeenCalledWith("frame");
    expect(handlers.onClose).toHaveBeenCalledWith(1006, "gone");
    expect(errorCode(handlers.onError.mock.calls[0]?.[0])).toBe("BROKER_UNAVAILABLE");

    const frame = new Uint8Array([1]);
    socket.send(frame);
    socket.close(1000, "bye");
    expect(native?.send).toHaveBeenCalledWith(frame);
    expect(native?.close).toHaveBeenCalledWith(1000, "bye");
  });
});
