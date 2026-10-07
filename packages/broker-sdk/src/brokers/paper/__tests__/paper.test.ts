import { toDecimal, toDecimalString } from "@finlytics/shared";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { Secret } from "../../../credentials";
import { isBrokerError } from "../../../errors";
import type { BrokerOrder, BrokerTrade } from "../../../models";
import { PaperAdapter } from "../adapter";
import { MemoryQuoteSource } from "../quotes";

import { FIXED_NOW, INFY, INSTRUMENTS, NIFTY_CE, order, paperSetup } from "./fixtures";

async function rejection(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isBrokerError(error)) throw new Error("expected a BrokerError");
  return { code: error.code, message: error.message };
}

describe("PaperAdapter fills", () => {
  it("fills a market buy at the ask and a market sell at the bid", async () => {
    const { adapter, ctx } = await paperSetup();
    await adapter.placeOrder(ctx(), order());
    await adapter.placeOrder(ctx(), order({ side: "SELL" }));

    const [buy, sell] = await adapter.getOrderBook(ctx());
    expect(buy).toMatchObject({ status: "FILLED", filledQty: 75, averagePrice: "100.05" });
    expect(sell).toMatchObject({ status: "FILLED", filledQty: 75, averagePrice: "99.95" });
  });

  it("fills at the LTP when the quote has no bid or ask", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    quotes.set(INFY, { ltp: "1500.5" });
    await adapter.placeOrder(ctx(), order({ instrumentKey: INFY, qty: 10 }));
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "FILLED", averagePrice: "1500.5" });
  });

  it("rests a limit order until the market crosses it, then fills at the market price", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), order({ type: "LIMIT", price: "99" }));
    expect((await adapter.getOrderBook(ctx()))[0]?.status).toBe("OPEN");

    quotes.set(NIFTY_CE, { ltp: "98.9", ask: "98.95" });
    const filled = (await adapter.getOrderBook(ctx())).find((candidate) => candidate.brokerOrderId === brokerOrderId);
    expect(filled).toMatchObject({ status: "FILLED", averagePrice: "98.95" });
  });

  it("fills a crossed sell limit at the bid", async () => {
    const { adapter, ctx } = await paperSetup();
    await adapter.placeOrder(ctx(), order({ side: "SELL", type: "LIMIT", price: "99.5" }));
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "FILLED", averagePrice: "99.95" });
  });

  it("triggers a stop-loss buy when the LTP reaches the trigger", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    await adapter.placeOrder(ctx(), order({ type: "SL", price: "106", triggerPrice: "105" }));
    quotes.set(NIFTY_CE, { ltp: "104.95" });
    expect((await adapter.getOrderBook(ctx()))[0]?.status).toBe("OPEN");

    quotes.set(NIFTY_CE, { ltp: "105", ask: "105.1" });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "FILLED", averagePrice: "105.1" });
  });

  it("triggers a stop-loss-market sell when the LTP falls to the trigger", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    await adapter.placeOrder(ctx(), order({ side: "SELL", type: "SL_M", triggerPrice: "95" }));
    quotes.set(NIFTY_CE, { ltp: "95.05" });
    expect((await adapter.getOrderBook(ctx()))[0]?.status).toBe("OPEN");
    quotes.set(NIFTY_CE, { ltp: "94.9" });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "FILLED", averagePrice: "94.9" });
  });

  it("keeps a triggered stop-loss limit resting when the limit is not reached", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    await adapter.placeOrder(ctx(), order({ type: "SL", price: "105", triggerPrice: "104" }));
    quotes.set(NIFTY_CE, { ltp: "104", ask: "105.5" });
    expect((await adapter.getOrderBook(ctx()))[0]?.status).toBe("OPEN");
    quotes.set(NIFTY_CE, { ltp: "103", ask: "104.9" });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "FILLED", averagePrice: "104.9" });
  });

  it("fills in parts when maxFillQtyPerMatch caps each match", async () => {
    const { adapter, ctx, quotes } = await paperSetup({ maxFillQtyPerMatch: 50 });
    await adapter.placeOrder(ctx(), order({ qty: 150 }));
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "PARTIALLY_FILLED", filledQty: 50 });

    quotes.set(NIFTY_CE, { ltp: "101", ask: "101.05" });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ status: "PARTIALLY_FILLED", filledQty: 100 });

    quotes.set(NIFTY_CE, { ltp: "102", ask: "102.05" });
    const done = (await adapter.getOrderBook(ctx()))[0];
    // (50 × 100.05 + 50 × 101.05 + 50 × 102.05) / 150
    expect(done).toMatchObject({ status: "FILLED", filledQty: 150, averagePrice: "101.05" });
  });

  it("cancels what an IOC order can't fill at once", async () => {
    const { adapter, ctx } = await paperSetup({ maxFillQtyPerMatch: 75 });
    await adapter.placeOrder(ctx(), order({ qty: 150, validity: "IOC" }));
    await adapter.placeOrder(ctx(), order({ type: "LIMIT", price: "90", validity: "IOC" }));
    const [partial, unfilled] = await adapter.getOrderBook(ctx());
    expect(partial).toMatchObject({
      status: "CANCELLED",
      filledQty: 75,
      statusMessage: "IOC: unfilled quantity cancelled",
    });
    expect(unfilled).toMatchObject({ status: "CANCELLED", filledQty: 0 });
  });
});

describe("PaperAdapter rejections", () => {
  const cases: [string, Parameters<typeof order>[0], RegExp][] = [
    ["a quantity off the lot size", { qty: 70 }, /multiple of the lot size \(75\)/],
    ["a quantity above the freeze quantity", { qty: 1875 }, /freeze quantity \(1800\)/],
    ["a price off the tick size", { type: "LIMIT", price: "99.03" }, /tick size \(0\.05\)/],
    ["an unknown instrument", { instrumentKey: "NSE_EQ|TCS" as typeof NIFTY_CE }, /Unknown instrument/],
    ["a market order without a quote", { instrumentKey: INFY, qty: 1 }, /No market price/],
    ["an order above the available funds", { qty: 1800, type: "LIMIT", price: "600" }, /Insufficient funds/],
  ];

  it.each(cases)("rejects %s like a broker RMS: the order ends REJECTED", async (_name, overrides, message) => {
    const { adapter, ctx } = await paperSetup();
    await adapter.placeOrder(ctx(), order(overrides));
    const [rejected] = await adapter.getOrderBook(ctx());
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.statusMessage).toMatch(message);
  });

  it("skips instrument checks when no instrument master is configured", async () => {
    const { adapter, ctx } = await paperSetup({ instruments: [] });
    await adapter.placeOrder(ctx(), order({ qty: 7, type: "LIMIT", price: "100.03" }));
    expect((await adapter.getOrderBook(ctx()))[0]?.status).toBe("OPEN");
  });

  it("lets an order that closes a position through even when funds are short", async () => {
    const { adapter, ctx } = await paperSetup({ initialCash: "8000" });
    await adapter.placeOrder(ctx(), order());
    expect((await adapter.getFunds(ctx())).availableMargin).toBe("496.25");
    await adapter.placeOrder(ctx(), order({ side: "SELL" }));
    expect((await adapter.getOrderBook(ctx()))[1]?.status).toBe("FILLED");
  });
});

describe("PaperAdapter order management", () => {
  it("modifies quantity, type and validity of an open order", async () => {
    const { adapter, ctx } = await paperSetup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), order({ type: "LIMIT", price: "90" }));
    await adapter.modifyOrder(ctx(), { brokerOrderId, qty: 150 });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ qty: 150, status: "OPEN" });

    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "SL", price: "120", triggerPrice: "110" });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ type: "SL", price: "120", triggerPrice: "110" });

    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "MARKET" });
    expect((await adapter.getOrderBook(ctx()))[0]).toMatchObject({ type: "MARKET", status: "FILLED" });
  });

  it("cancels the rest when an open order is modified to IOC", async () => {
    const { adapter, ctx } = await paperSetup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), order({ type: "LIMIT", price: "90" }));
    await adapter.modifyOrder(ctx(), { brokerOrderId, validity: "IOC" });
    expect((await adapter.getOrderBook(ctx()))[0]?.status).toBe("CANCELLED");
  });

  it("refuses modifications that don't fit the order", async () => {
    const { adapter, ctx } = await paperSetup({ maxFillQtyPerMatch: 75 });
    const { brokerOrderId } = await adapter.placeOrder(ctx(), order({ type: "LIMIT", price: "90" }));
    expect(await rejection(adapter.modifyOrder(ctx(), { brokerOrderId, type: "SL" }))).toMatchObject({
      code: "BROKER_REJECTED",
      message: expect.stringMatching(/don't fit the order type/) as unknown,
    });
    expect((await rejection(adapter.modifyOrder(ctx(), { brokerOrderId, price: "90.01" }))).message).toMatch(
      /tick size/,
    );

    const partial = await adapter.placeOrder(ctx(), order({ qty: 150 }));
    expect(
      (await rejection(adapter.modifyOrder(ctx(), { brokerOrderId: partial.brokerOrderId, qty: 75 }))).message,
    ).toMatch(/above the filled quantity/);
  });

  it("refuses to modify or cancel an order that is no longer open, and unknown orders", async () => {
    const { adapter, ctx } = await paperSetup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), order());
    expect(await rejection(adapter.cancelOrder(ctx(), brokerOrderId))).toMatchObject({
      code: "BROKER_REJECTED",
      message: "Order is filled, not open",
    });
    expect((await rejection(adapter.modifyOrder(ctx(), { brokerOrderId: "O999", qty: 75 }))).code).toBe("NOT_FOUND");
  });
});

describe("PaperAdapter positions and funds", () => {
  it("derives positions, realised and unrealised P&L, charges and margin from its trades", async () => {
    const { adapter, ctx, quotes } = await paperSetup({
      charges: (fill) => toDecimal(fill.price).times(fill.qty).times("0.001"),
    });
    await adapter.placeOrder(ctx(), order({ qty: 150 })); // buy 150 @ 100.05
    quotes.set(NIFTY_CE, { ltp: "110", bid: "109.95", ask: "110.05" });
    await adapter.placeOrder(ctx(), order({ side: "SELL" })); // sell 75 @ 109.95

    const [position] = await adapter.getPositions(ctx());
    expect(position).toEqual({
      instrumentKey: NIFTY_CE,
      product: "INTRADAY",
      netQty: 75,
      buyQty: 150,
      sellQty: 75,
      buyAvg: "100.05",
      sellAvg: "109.95",
      realisedPnl: "742.5",
      ltp: "110",
      unrealisedPnl: "746.25",
    });
    // charges: 15.0075 + 8.24625; used: 75 × 100.05
    expect(await adapter.getFunds(ctx())).toEqual({
      availableMargin: "993215.4963",
      usedMargin: "7503.75",
      collateral: "0",
      withdrawable: "993215.4963",
    });
  });

  it("reports short positions against the sell average", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    await adapter.placeOrder(ctx(), order({ side: "SELL" }));
    quotes.set(NIFTY_CE, { ltp: "90" });
    expect((await adapter.getPositions(ctx()))[0]).toMatchObject({
      netQty: -75,
      unrealisedPnl: "746.25",
      realisedPnl: "0",
    });
    expect((await adapter.getFunds(ctx())).usedMargin).toBe("7496.25");
  });

  it("omits LTP and unrealised P&L when no quote is known, and closes flat positions", async () => {
    const { adapter, ctx } = await paperSetup();
    const quotes = new MemoryQuoteSource();
    quotes.set(INFY, { ltp: "1500" });
    const other = new PaperAdapter({ quotes, instruments: INSTRUMENTS });
    const creds = await other.exchangeToken({ signal: new AbortController().signal });
    const account = { signal: new AbortController().signal, creds };
    await other.placeOrder(account, order({ instrumentKey: INFY, qty: 2 }));
    await other.placeOrder(account, order({ instrumentKey: INFY, qty: 2, side: "SELL" }));
    expect((await other.getPositions(account))[0]).toMatchObject({ netQty: 0, realisedPnl: "0", unrealisedPnl: "0" });
    expect((await other.getFunds(account)).usedMargin).toBe("0");
    expect(await adapter.getPositions(ctx())).toEqual([]);
  });

  it("keeps total P&L equal to sell value − buy value + net × LTP for any trade sequence", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            buy: fc.boolean(),
            lots: fc.integer({ min: 1, max: 4 }),
            ticks: fc.integer({ min: 1800, max: 2200 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 1800, max: 2200 }),
        async (trades, ltpTicks) => {
          const quotes = new MemoryQuoteSource();
          const adapter = new PaperAdapter({ quotes, initialCash: "100000000", instruments: INSTRUMENTS });
          const creds = await adapter.exchangeToken({ signal: new AbortController().signal });
          const ctx = { signal: new AbortController().signal, creds };
          let flow = toDecimal("0");
          let net = 0;
          for (const trade of trades) {
            const price = toDecimal(String(trade.ticks)).times("0.05");
            quotes.set(NIFTY_CE, { ltp: price.toFixed() });
            const qty = trade.lots * 75;
            await adapter.placeOrder(ctx, order({ side: trade.buy ? "BUY" : "SELL", qty }));
            flow = trade.buy ? flow.minus(price.times(qty)) : flow.plus(price.times(qty));
            net += trade.buy ? qty : -qty;
          }
          const ltp = toDecimal(String(ltpTicks)).times("0.05");
          quotes.set(NIFTY_CE, { ltp: ltp.toFixed() });
          const [position] = await adapter.getPositions(ctx);
          const total = toDecimal(position?.realisedPnl ?? "0").plus(position?.unrealisedPnl ?? "0");
          const expected = flow.plus(ltp.times(net));
          // Each rendered amount is rounded to 4 decimals.
          expect(total.minus(expected).abs().lte("0.0002")).toBe(true);
          expect(position?.netQty).toBe(net);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("PaperAdapter sessions and data", () => {
  it("opens accounts, keeps them apart and refreshes to the same credentials", async () => {
    const { adapter, ctx, creds } = await paperSetup();
    expect(adapter.getAuthUrl()).toEqual({ mode: "none" });
    const second = await adapter.exchangeToken({ signal: new AbortController().signal });
    expect(second.clientId).not.toBe(creds.clientId);
    await adapter.placeOrder(ctx(), order());
    expect(await adapter.getOrderBook({ signal: new AbortController().signal, creds: second })).toEqual([]);
    expect(await adapter.refreshToken(ctx())).toBe(creds);
    expect(await adapter.getProfile(ctx())).toEqual({
      brokerClientId: creds.clientId,
      name: "Paper trader",
      exchanges: ["NSE", "BSE", "MCX", "NFO", "BFO", "CDS"],
    });
  });

  it("asks for a re-login without a client id, and reopens an unknown account after a restart", async () => {
    const { adapter } = await paperSetup();
    const noClient = { signal: new AbortController().signal, creds: { accessToken: Secret.of("token-1") } };
    expect((await rejection(adapter.getFunds(noClient))).code).toBe("NEEDS_RELOGIN");

    const restored = {
      signal: new AbortController().signal,
      creds: { accessToken: Secret.of("token-2"), clientId: "PAPER-OLD1" },
    };
    expect((await adapter.getFunds(restored)).availableMargin).toBe("1000000");
  });

  it("returns configured holdings, and no candles without a source", async () => {
    const holding = { instrumentKey: INFY, qty: 10, avgPrice: "1400" };
    const { adapter, ctx } = await paperSetup({ holdings: [holding] });
    expect(await adapter.getHoldings(ctx())).toEqual([holding]);
    const query = { instrumentKey: INFY, timeframe: "D1" as const, from: new Date(0), to: FIXED_NOW };
    expect(await adapter.getHistoricalCandles(ctx(), query)).toEqual([]);
  });

  it("stops streaming the instrument master when the signal aborts", async () => {
    const { adapter } = await paperSetup();
    const controller = new AbortController();
    const rows: string[] = [];
    await expect(
      (async () => {
        for await (const row of adapter.downloadInstrumentMaster({ signal: controller.signal })) {
          rows.push(row.instrumentKey);
          controller.abort(new Error("stop"));
        }
      })(),
    ).rejects.toThrow("stop");
    expect(rows).toEqual([NIFTY_CE]);
  });

  it("refuses a non-positive maxFillQtyPerMatch", () => {
    expect(() => new PaperAdapter({ quotes: new MemoryQuoteSource(), maxFillQtyPerMatch: 0 })).toThrow(RangeError);
  });

  it("uses random ids and the system clock by default", async () => {
    const quotes = new MemoryQuoteSource();
    quotes.set(INFY, { ltp: "1500" });
    const adapter = new PaperAdapter({ quotes });
    const creds = await adapter.exchangeToken({ signal: new AbortController().signal });
    expect(creds.clientId).toMatch(/^PAPER-[0-9A-F]{8}\d+$/);
    const { brokerOrderId } = await adapter.placeOrder(
      { signal: new AbortController().signal, creds },
      order({ instrumentKey: INFY, qty: 1 }),
    );
    expect(brokerOrderId).toMatch(/^PAPER-[0-9a-f]{6}-1$/);
  });
});

describe("PaperAdapter feeds", () => {
  it("publishes order and trade updates with the account's client id", async () => {
    const { adapter, ctx, creds } = await paperSetup();
    const feed = await adapter.connectOrderFeed(ctx());
    const orders: BrokerOrder[] = [];
    const trades: BrokerTrade[] = [];
    feed.on("order", (update) => {
      expect(update.brokerClientId).toBe(creds.clientId);
      orders.push(update.order);
    });
    feed.on("trade", (update) => trades.push(update.trade));

    await adapter.placeOrder(ctx(), order());
    expect(orders.map((update) => update.status)).toEqual(["OPEN", "FILLED"]);
    expect(trades).toEqual([
      {
        brokerTradeId: "T2",
        brokerOrderId: "O1",
        instrumentKey: NIFTY_CE,
        side: "BUY",
        product: "INTRADAY",
        qty: 75,
        price: "100.05",
        charges: "0",
        executedAt: FIXED_NOW.toISOString(),
      },
    ]);

    await feed.close();
    await feed.close();
    await adapter.placeOrder(ctx(), order());
    expect(orders).toHaveLength(2);
  });

  it("reports matching errors on the order feed", async () => {
    let failing = false;
    const { adapter, ctx, quotes } = await paperSetup({
      charges: () => (failing ? "-1" : "0"),
    });
    const feed = await adapter.connectOrderFeed(ctx());
    const errors: unknown[] = [];
    feed.on("error", (error) => errors.push(error));
    await adapter.placeOrder(ctx(), order({ type: "LIMIT", price: "90" }));
    failing = true;
    quotes.set(NIFTY_CE, { ltp: "89", ask: "89.05" });
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    expect(errors[0]).toBeInstanceOf(RangeError);
  });

  it("streams a snapshot on subscribe, then ticks, and enforces the feed capacity", async () => {
    const { adapter, ctx, quotes } = await paperSetup();
    const feed = await adapter.connectMarketFeed(ctx());
    const ticks: string[] = [];
    feed.on("tick", (tick) => ticks.push(`${tick.instrumentKey}@${tick.ltp}`));
    await feed.subscribe([NIFTY_CE, INFY], "ltp");
    expect(ticks).toEqual([`${NIFTY_CE}@100`]);
    quotes.set(INFY, { ltp: "1500", ts: 1 });
    expect(ticks).toEqual([`${NIFTY_CE}@100`, `${INFY}@1500`]);
    expect(feed.status).toBe("up");

    const keys = Array.from({ length: 5_000 }, (_unused, index) => `NSE_EQ|S${String(index)}` as typeof INFY);
    expect((await rejection(feed.subscribe(keys, "ltp"))).message).toMatch(/at most 5000 instruments/);

    const statuses: string[] = [];
    feed.on("status", (status) => statuses.push(status));
    await feed.close();
    expect(statuses).toEqual(["closed"]);
    expect((await rejection(feed.subscribe([INFY], "ltp"))).code).toBe("BROKER_UNAVAILABLE");
    await feed.unsubscribe([INFY]);
    await feed.close();
    quotes.set(INFY, { ltp: "1501" });
    expect(ticks).toHaveLength(2);
  });

  it("rejects invalid quote prices", () => {
    const quotes = new MemoryQuoteSource();
    expect(() => {
      quotes.set(INFY, { ltp: "1e3" });
    }).toThrow(TypeError);
    expect(toDecimalString("1.50")).toBe("1.5");
  });
});
