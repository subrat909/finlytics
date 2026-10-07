import type { InstrumentKey } from "@finlytics/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isBrokerError } from "../../../errors";
import type { FeedStatus } from "../../../feed/feed";
import { TickSchema } from "../../../models";
import type { BrokerOrder, Tick, TradeUpdate } from "../../../models";
import {
  disconnectError,
  DhanMarketFeed,
  DhanOrderFeed,
  feedPrice,
  feedTime,
  isFatalDisconnect,
  parseDhanPackets,
} from "../feed";
import type { DhanFeedOptions } from "../feed";
import { DhanInstrumentMap } from "../instruments";

import { CLIENT_ID, FakeSockets, fixture, KEYS, seededInstruments } from "./fake-dhan";
import {
  concatFrames,
  disconnectFrame,
  fullFrame,
  oiFrame,
  prevCloseFrame,
  quoteFrame,
  statusFrame,
  tickerFrame,
} from "./frames";

const LTT = 1_759_722_300; // 2025-10-06T03:45:00Z
const NOW_MS = (LTT + 1) * 1000;
const FAST: DhanFeedOptions = { backoff: { baseMs: 10, maxMs: 40, random: () => 0 }, now: () => NOW_MS };

afterEach(() => {
  vi.useRealTimers();
});

function marketFeed(sockets: FakeSockets, options: DhanFeedOptions = FAST, map = seededInstruments()): DhanMarketFeed {
  return new DhanMarketFeed({
    url: "wss://api-feed.dhan.co?token=REDACTED",
    factory: sockets.factory,
    instruments: map,
    options,
  });
}

async function started(
  sockets = new FakeSockets(),
  options: DhanFeedOptions = FAST,
): Promise<{
  feed: DhanMarketFeed;
  sockets: FakeSockets;
  ticks: Tick[];
  statuses: FeedStatus[];
  errors: unknown[];
}> {
  const feed = marketFeed(sockets, options);
  const ticks: Tick[] = [];
  const statuses: FeedStatus[] = [];
  const errors: unknown[] = [];
  feed.on("tick", (tick) => ticks.push(tick));
  feed.on("status", (status) => statuses.push(status));
  feed.on("error", (error) => errors.push(error));
  await feed.start(new AbortController().signal);
  return { feed, sockets, ticks, statuses, errors };
}

describe("parseDhanPackets", () => {
  it("decodes every documented packet, several per message", () => {
    const depth = [{ bidQty: 75, askQty: 150, bidOrders: 1, askOrders: 2, bid: 101.5, ask: 102 }];
    const packets = parseDhanPackets(
      concatFrames(
        tickerFrame(0, 13, 25_000.05, LTT, 1),
        tickerFrame(2, 52175, 101.55, LTT),
        quoteFrame(2, 52175, {
          ltp: 101.6,
          ltq: 75,
          ltt: LTT,
          atp: 100.25,
          volume: 1_500,
          totalSellQty: 10,
          totalBuyQty: 20,
          open: 99,
          close: 98,
          high: 103,
          low: 97.5,
        }),
        oiFrame(2, 52175, 12_345),
        prevCloseFrame(2, 52175, 98.4, 11_000),
        statusFrame(),
        fullFrame(2, 52175, { ltp: 101.7, ltt: LTT, oi: 12_400, open: 99, close: 98, high: 103, low: 97.5, depth }),
        disconnectFrame(807),
      ),
    );
    expect(packets.map((packet) => packet.kind)).toEqual([
      "ticker",
      "ticker",
      "quote",
      "oi",
      "prevClose",
      "status",
      "full",
      "disconnect",
    ]);
    expect(packets[0]).toMatchObject({ segment: 0, securityId: 13, ltt: LTT });
    expect(packets[2]).toMatchObject({ ltq: 75, volume: 1_500, totalSellQty: 10, totalBuyQty: 20 });
    expect(packets[3]).toMatchObject({ oi: 12_345 });
    expect(packets[4]).toMatchObject({ prevOi: 11_000 });
    const full = packets[6];
    expect(full?.kind === "full" && full.depth?.[0]).toMatchObject({
      bidQty: 75,
      askQty: 150,
      bidOrders: 1,
      askOrders: 2,
    });
    expect(full?.kind === "full" && full.oi).toBe(12_400);
    expect(packets[7]).toMatchObject({ code: 807 });
  });

  it("skips unknown codes by their length and stops at a truncated packet", () => {
    const unknown = new Uint8Array(12);
    unknown[0] = 3;
    new DataView(unknown.buffer).setUint16(1, 12, true);
    const message = concatFrames(unknown.buffer, oiFrame(2, 1, 5), tickerFrame(2, 1, 1, LTT).slice(0, 10));
    expect(parseDhanPackets(new Uint8Array(message)).map((packet) => packet.kind)).toEqual(["oi"]);
    const badLength = new Uint8Array(8);
    badLength[0] = 99;
    expect(parseDhanPackets(badLength)).toEqual([]);
  });
});

describe("feed helpers", () => {
  it("rounds float32 prices to the segment's precision", () => {
    expect(feedPrice(Math.fround(24_000.05), 2)).toBe("24000.05");
    expect(feedPrice(Math.fround(83.2525), 3)).toBe("83.2525");
    expect(feedPrice(Math.fround(83.2525), 7)).toBe("83.2525");
    expect(feedPrice(-1, 1)).toBeUndefined();
    expect(feedPrice(Number.NaN, 1)).toBeUndefined();
  });

  it("reads LTT as UTC epoch seconds, shifting IST wall-clock values that land in the future", () => {
    expect(feedTime(LTT, NOW_MS)).toBe(LTT * 1000);
    expect(feedTime(LTT + 19_800, NOW_MS)).toBe(LTT * 1000);
    expect(feedTime(0, NOW_MS)).toBe(NOW_MS);
  });

  it("maps disconnect codes to typed errors", () => {
    expect(disconnectError(807)).toMatchObject({
      code: "NEEDS_RELOGIN",
      brokerError: { code: "807", message: "Access token is expired" },
    });
    expect(disconnectError(805)).toMatchObject({ code: "RATE_LIMITED" });
    expect(disconnectError(806)).toMatchObject({ code: "BROKER_REJECTED", brokerError: { code: "806" } });
    expect(disconnectError(999)).toMatchObject({ code: "BROKER_UNAVAILABLE", brokerError: { code: "999" } });
    expect([805, 806, 807, 810, 811].map(isFatalDisconnect)).toEqual([false, true, true, true, false]);
  });
});

describe("DhanMarketFeed", () => {
  it("subscribes in batches of 100, per mode, and switches modes by unsubscribing the old one", async () => {
    const map = new DhanInstrumentMap();
    const keys = Array.from({ length: 150 }, (_, index) => {
      const key = `NSE_EQ|S${String(index)}` as InstrumentKey;
      map.set(key, { exchangeSegment: "NSE_EQ", securityId: String(1_000 + index), instrument: "EQUITY" });
      return key;
    });
    const sockets = new FakeSockets();
    const feed = marketFeed(sockets, FAST, map);
    await feed.start(new AbortController().signal);
    const socket = sockets.last();
    expect(socket.binaryType).toBe("arraybuffer");

    await feed.subscribe(keys, "ltp");
    expect(socket.messages().map((message) => [message.RequestCode, message.InstrumentCount])).toEqual([
      [15, 100],
      [15, 50],
    ]);
    expect(socket.messages()[0]?.InstrumentList).toContainEqual({ ExchangeSegment: "NSE_EQ", SecurityId: "1000" });

    socket.sent.length = 0;
    await feed.subscribe(keys.slice(0, 2), "full");
    expect(socket.messages().map((message) => [message.RequestCode, message.InstrumentCount])).toEqual([
      [16, 2],
      [21, 2],
    ]);

    socket.sent.length = 0;
    await feed.subscribe(keys.slice(0, 2), "full"); // no change: nothing sent
    await feed.unsubscribe([keys[0] as InstrumentKey, keys[5] as InstrumentKey, "NSE_EQ|NOPE" as InstrumentKey]);
    expect(
      socket
        .messages()
        .map((message) => message.RequestCode)
        .sort(),
    ).toEqual([16, 22]);
    expect(feed.subscriptions().size).toBe(148);
    await feed.close();
  });

  it("refuses keys the instrument map doesn't know, subscribing none of them", async () => {
    const { feed, sockets } = await started();
    const error: unknown = await feed
      .subscribe([KEYS.niftyCe, "NSE_EQ|UNKNOWN" as InstrumentKey], "quote")
      .catch((reason: unknown) => reason);
    expect(isBrokerError(error) && error.code).toBe("NOT_FOUND");
    expect(feed.subscriptions().size).toBe(0);
    expect(sockets.last().sent).toEqual([]);
    await feed.close();
  });

  it("merges OI and previous close into ticks, with depth from full packets", async () => {
    const { feed, sockets, ticks } = await started();
    await feed.subscribe([KEYS.niftyCe], "full");
    const socket = sockets.last();
    socket.receive(oiFrame(2, 52175, 9_000)); // no LTP yet: nothing to emit
    socket.receive(prevCloseFrame(2, 52175, 98.4, 8_000));
    expect(ticks).toEqual([]);
    socket.receive(tickerFrame(2, 52175, 101.55, LTT));
    socket.receive(
      fullFrame(2, 52175, {
        ltp: 101.7,
        ltq: 75,
        ltt: LTT,
        atp: 100.25,
        volume: 1_500,
        oi: 12_400,
        open: 99,
        close: 0,
        high: 103,
        low: 97.5,
        depth: [
          { bidQty: 75, askQty: 150, bidOrders: 1, askOrders: 2, bid: 101.65, ask: 101.75 },
          { bidQty: 0, askQty: 0, bidOrders: 0, askOrders: 0, bid: 0, ask: 0 },
        ],
      }),
    );
    socket.receive(oiFrame(2, 52175, 12_500));
    socket.receive(prevCloseFrame(2, 52175, 0, 0)); // a zero close is ignored
    // The full packet's day fields stay on every later tick: OI and prev close packets carry nothing else.
    const day = {
      ltq: 75,
      volume: 1_500,
      open: "99",
      high: "103",
      low: "97.5",
      atp: "100.25",
      tbq: 0,
      tsq: 0,
      depth: { bids: [{ price: "101.65", qty: 75, orders: 1 }], asks: [{ price: "101.75", qty: 150, orders: 2 }] },
      bid: "101.65",
      bidQty: 75,
      ask: "101.75",
      askQty: 150,
    };
    expect(ticks).toEqual([
      { instrumentKey: KEYS.niftyCe, ltp: "101.55", ts: LTT * 1000, close: "98.4", oi: 9_000 },
      { instrumentKey: KEYS.niftyCe, ltp: "101.7", ts: LTT * 1000, close: "98.4", oi: 12_400, ...day },
      { instrumentKey: KEYS.niftyCe, ltp: "101.7", ts: LTT * 1000, close: "98.4", oi: 12_500, ...day },
      { instrumentKey: KEYS.niftyCe, ltp: "101.7", ts: LTT * 1000, close: "98.4", oi: 12_500, ...day },
    ]);
    for (const tick of ticks) expect(TickSchema.safeParse(tick).success).toBe(true);
    await feed.close();
  });

  it("gives an index its previous close and day OHLC, leaving out zeros and the post-close Day Close", async () => {
    const { feed, sockets, ticks } = await started();
    await feed.subscribe([KEYS.nifty], "quote");
    const socket = sockets.last();
    socket.receive(prevCloseFrame(0, 13, 24_850.6, 0));
    socket.receive(
      quoteFrame(0, 13, { ltp: 25_000.05, ltt: LTT, open: 24_900, high: 25_010, low: 24_880.25, close: 0, atp: 0 }),
    );
    expect(ticks).toEqual([
      {
        instrumentKey: KEYS.nifty,
        ltp: "25000.05",
        ts: LTT * 1000,
        close: "24850.6",
        ltq: 0,
        volume: 0,
        open: "24900",
        high: "25010",
        low: "24880.25",
        tbq: 0,
        tsq: 0,
      },
    ]);
    // Pre-open: no open, high or low yet.
    socket.receive(quoteFrame(0, 13, { ltp: 25_001, ltt: LTT, close: 25_100 }));
    expect(ticks.at(-1)).toEqual({
      instrumentKey: KEYS.nifty,
      ltp: "25001",
      ts: LTT * 1000,
      close: "24850.6",
      ltq: 0,
      volume: 0,
      tbq: 0,
      tsq: 0,
    });
    await feed.close();
  });

  it("sends the book totals, and forgets what the old mode sent once the mode changes", async () => {
    const { feed, sockets, ticks } = await started();
    await feed.subscribe([KEYS.hdfcBank], "full");
    const socket = sockets.last();
    socket.receive(
      fullFrame(1, 1333, {
        ltp: 1_520.5,
        ltt: LTT,
        totalBuyQty: 20_000,
        totalSellQty: 10_000,
        oi: 0,
        depth: [{ bidQty: 10, askQty: 20, bidOrders: 1, askOrders: 2, bid: 1_520.4, ask: 1_520.6 }],
      }),
    );
    expect(ticks.at(-1)).toMatchObject({ tbq: 20_000, tsq: 10_000, bid: "1520.4", ask: "1520.6" });
    expect(ticks.at(-1)).not.toHaveProperty("oi");
    await feed.subscribe([KEYS.hdfcBank], "ltp");
    socket.receive(tickerFrame(1, 1333, 1_521, LTT));
    expect(ticks.at(-1)).toEqual({ instrumentKey: KEYS.hdfcBank, ltp: "1521", ts: LTT * 1000 });
    await feed.close();
  });

  it("ignores packets for other keys, text frames, other payloads and market status", async () => {
    const { feed, sockets, ticks, errors } = await started();
    await feed.subscribe([KEYS.nifty], "ltp");
    const socket = sockets.last();
    socket.receive(tickerFrame(2, 52175, 1, LTT)); // mapped but not subscribed
    socket.receive(tickerFrame(6, 13, 1, LTT)); // unknown segment byte
    socket.receive(tickerFrame(1, 999, 1, LTT)); // unknown security
    socket.receive("pong");
    socket.receive({ unexpected: true });
    socket.receive(statusFrame());
    socket.receive(new Uint8Array(tickerFrame(0, 13, 25_000.05, LTT, 1)));
    expect(ticks).toEqual([{ instrumentKey: KEYS.nifty, ltp: "25000.05", ts: LTT * 1000 }]);
    expect(errors).toEqual([]);
    await feed.close();
  });

  it("reports a disconnect packet as a typed error, and stops reconnecting when the token is no good", async () => {
    const { feed, sockets, errors, statuses } = await started();
    await feed.subscribe([KEYS.nifty], "ltp");
    sockets.last().receive(disconnectFrame(808));
    expect(isBrokerError(errors[0]) && errors[0].code).toBe("NEEDS_RELOGIN");
    expect(sockets.last().closed).toBe(true);
    expect(feed.status).toBe("down");
    await new Promise((resolve) => setTimeout(resolve, 60)); // well past the backoff
    expect(sockets.sockets).toHaveLength(1);
    expect(statuses).toEqual(["up", "down"]);
    expect(feed.subscriptions().size).toBe(1); // kept for whoever reconnects with a new token
    await feed.close();
    expect(feed.status).toBe("closed");
  });

  it("treats a missing Data API plan as final too, but reconnects after other disconnects", async () => {
    const plan = await started();
    plan.sockets.last().receive(disconnectFrame(806));
    expect(plan.errors[0]).toMatchObject({ code: "BROKER_REJECTED", brokerError: { code: "806" } });
    expect(plan.feed.status).toBe("down");
    await plan.feed.close();

    const busy = await started();
    busy.sockets.last().receive(disconnectFrame(805));
    expect(busy.errors[0]).toMatchObject({ code: "RATE_LIMITED" });
    busy.sockets.last().drop();
    await vi.waitFor(() => {
      expect(busy.sockets.sockets).toHaveLength(2);
      expect(busy.feed.status).toBe("up");
    });
    await busy.feed.close();
  });

  it("reconnects with backoff after a drop and re-subscribes every key by mode", async () => {
    const { feed, sockets, statuses } = await started();
    await feed.subscribe([KEYS.niftyCe], "quote");
    await feed.subscribe([KEYS.nifty], "ltp");
    sockets.last().drop();
    expect(feed.status).toBe("down");
    await vi.waitFor(() => {
      expect(sockets.sockets).toHaveLength(2);
      expect(feed.status).toBe("up");
    });
    expect(
      sockets
        .last()
        .messages()
        .map((message) => message.RequestCode)
        .sort(),
    ).toEqual([15, 17]);
    expect(statuses).toEqual(["up", "down", "connecting", "up"]);
    await feed.close();
  });

  it("keeps retrying while the broker refuses, then recovers; subscriptions made meanwhile go out on connect", async () => {
    const { feed, sockets } = await started();
    sockets.refuse = true;
    sockets.last().drop();
    await vi.waitFor(() => {
      expect(sockets.sockets.length).toBeGreaterThanOrEqual(3);
    });
    await feed.subscribe([KEYS.gold], "quote"); // down: recorded, sent after reconnect
    sockets.refuse = false;
    await vi.waitFor(() => {
      expect(feed.status).toBe("up");
    });
    expect(sockets.last().messages()).toEqual([
      { RequestCode: 17, InstrumentCount: 1, InstrumentList: [{ ExchangeSegment: "MCX_COMM", SecurityId: "440000" }] },
    ]);
    await feed.close();
  });

  it("retries when the socket factory throws", async () => {
    const sockets = new FakeSockets();
    let failures = 1;
    const factory = (url: string) => {
      if (failures > 0 && sockets.sockets.length === 1) {
        failures -= 1;
        throw new Error("boom");
      }
      return sockets.factory(url);
    };
    const feed = new DhanMarketFeed({ url: "wss://x", factory, instruments: seededInstruments(), options: FAST });
    await feed.start(new AbortController().signal);
    sockets.last().drop();
    await vi.waitFor(() => {
      expect(sockets.sockets).toHaveLength(2);
      expect(feed.status).toBe("up");
    });
    await feed.close();
  });

  it("goes degraded after silence while subscribed and back up on the next message", async () => {
    vi.useFakeTimers();
    let now = NOW_MS;
    const { feed, sockets, statuses } = await started(new FakeSockets(), {
      ...FAST,
      now: () => now,
      staleAfterMs: 4_000,
    });
    now += 10_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(feed.status).toBe("up"); // nothing subscribed: silence is fine
    await feed.subscribe([KEYS.nifty], "ltp");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(feed.status).toBe("degraded");
    sockets.last().receive(tickerFrame(0, 13, 25_000, LTT));
    expect(feed.status).toBe("up");
    expect(statuses).toEqual(["up", "degraded", "up"]);
    await feed.close();
  });

  it("reconnects a silent connection when configured to", async () => {
    vi.useFakeTimers();
    let now = NOW_MS;
    const { feed, sockets } = await started(new FakeSockets(), {
      ...FAST,
      now: () => now,
      reconnectAfterSilenceMs: 8_000,
    });
    now += 9_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets.sockets[0]?.closeCode).toBe(4000);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets.sockets).toHaveLength(2);
    expect(feed.status).toBe("up");
    await feed.close();
  });

  it("fails the first connection without retrying, and honours an aborted signal", async () => {
    const refused = new FakeSockets({ refuse: true });
    const feed = marketFeed(refused);
    const error: unknown = await feed.start(new AbortController().signal).catch((reason: unknown) => reason);
    expect(isBrokerError(error) && error.code).toBe("BROKER_UNAVAILABLE");
    expect(refused.sockets).toHaveLength(1);

    const throwing = new DhanMarketFeed({
      url: "wss://x",
      factory: () => {
        throw new Error("boom");
      },
      instruments: seededInstruments(),
    });
    await expect(throwing.start(new AbortController().signal)).rejects.toMatchObject({ code: "BROKER_UNAVAILABLE" });

    const controller = new AbortController();
    const reason = new Error("shutdown");
    controller.abort(reason);
    await expect(marketFeed(new FakeSockets()).start(controller.signal)).rejects.toBe(reason);

    const later = new AbortController();
    const pending = marketFeed(new FakeSockets({ autoOpen: false })).start(later.signal);
    later.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("sends the disconnect request on close, then refuses subscriptions", async () => {
    const { feed, sockets, statuses } = await started();
    const socket = sockets.last();
    await feed.close();
    await feed.close();
    expect(socket.messages().at(-1)).toEqual({ RequestCode: 12 });
    expect(socket.closed).toBe(true);
    expect(feed.status).toBe("closed");
    expect(statuses.at(-1)).toBe("closed");
    expect(() => feed.subscribe([KEYS.nifty], "ltp")).toThrow(/closed/);
    await expect(feed.unsubscribe([KEYS.nifty])).resolves.toBeUndefined();
  });
});

describe("DhanOrderFeed", () => {
  const login = { LoginReq: { MsgCode: 42, ClientId: CLIENT_ID, Token: "REDACTED" }, UserType: "SELF" } as const;

  async function orderFeed(sockets = new FakeSockets()): Promise<{
    feed: DhanOrderFeed;
    sockets: FakeSockets;
    orders: BrokerOrder[];
    trades: TradeUpdate[];
    errors: unknown[];
  }> {
    const feed = new DhanOrderFeed({
      url: "wss://api-order-update.dhan.co",
      factory: sockets.factory,
      instruments: seededInstruments(),
      login,
      now: () => new Date(NOW_MS),
      options: FAST,
    });
    const orders: BrokerOrder[] = [];
    const trades: TradeUpdate[] = [];
    const errors: unknown[] = [];
    feed.on("order", (update) => {
      expect(update.brokerClientId).toBe(CLIENT_ID);
      orders.push(update.order);
    });
    feed.on("trade", (update) => trades.push(update));
    feed.on("error", (error) => errors.push(error));
    await feed.start(new AbortController().signal);
    return { feed, sockets, orders, trades, errors };
  }

  const message = (patch: Record<string, unknown> = {}): string => {
    const docs = fixture("order-update.json") as { Data: Record<string, unknown> };
    return JSON.stringify({ ...docs, Data: { ...docs.Data, ...patch } });
  };

  it("logs in on every connection and publishes orders and fills", async () => {
    const { feed, sockets, orders, trades } = await orderFeed();
    expect(sockets.last().messages()).toEqual([login]);
    const socket = sockets.last();
    socket.receive(message({ Status: "Pending", SecurityId: "1333", Symbol: "HDFCBANK", Quantity: 10, TradedQty: 0 }));
    socket.receive(
      message({ Status: "Part_Traded", SecurityId: "1333", Quantity: 10, TradedQty: 4, TradedPrice: 1520.5 }),
    );
    socket.receive(
      new TextEncoder().encode(
        message({ Status: "Traded", SecurityId: "1333", Quantity: 10, TradedQty: 10, TradedPrice: 1521 }),
      ),
    );
    expect(orders.map((order) => [order.instrumentKey, order.status, order.filledQty])).toEqual([
      [KEYS.hdfcBank, "OPEN", 0],
      [KEYS.hdfcBank, "PARTIALLY_FILLED", 4],
      [KEYS.hdfcBank, "FILLED", 10],
    ]);
    expect(trades.map((update) => [update.trade.brokerTradeId, update.trade.qty, update.trade.price])).toEqual([
      ["1124091136546-4", 4, "1520.5"],
      ["1124091136546-10", 6, "1521"],
    ]);

    socket.drop();
    await vi.waitFor(() => {
      expect(sockets.sockets).toHaveLength(2);
      expect(feed.status).toBe("up");
    });
    expect(sockets.last().messages()).toEqual([login]);
    await feed.close();
    await feed.close();
    expect(feed.status).toBe("closed");
  });

  it("ignores other message types and reports unreadable or unmappable updates", async () => {
    const { feed, sockets, orders, errors } = await orderFeed();
    const socket = sockets.last();
    socket.receive(JSON.stringify({ Type: "heartbeat" }));
    socket.receive(JSON.stringify({ nope: 1 }));
    socket.receive({ not: "text" });
    socket.receive("{not json");
    socket.receive(JSON.stringify({ Type: "order_alert", Data: { OrderNo: "1" } }));
    socket.receive(message({ SecurityId: "777", Symbol: "", Exchange: "NSE", Segment: "E" }));
    expect(orders).toEqual([]);
    expect(errors.map((error) => (isBrokerError(error) ? error.code : "?"))).toEqual([
      "BROKER_UNAVAILABLE",
      "BROKER_UNAVAILABLE",
      "INTERNAL",
    ]);
    await feed.close();
  });
});
