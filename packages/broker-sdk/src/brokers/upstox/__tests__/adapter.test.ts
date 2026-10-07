import { afterEach, describe, expect, it, vi } from "vitest";

import { Secret } from "../../../credentials";
import { isBrokerError } from "../../../errors";
import type { BrokerError } from "../../../errors";
import { UPSTOX_CAPABILITIES, UpstoxAdapter } from "../adapter";
import { UpstoxInstrumentMap } from "../instruments";
import { UPSTOX_URLS } from "../types";

import { fixture, json, upstoxErrorBody, VALID_CODE } from "./fake-upstox";
import {
  BANKNIFTY_PE,
  CRUDE_FUT,
  fixtureRows,
  NIFTY_CE,
  NIFTY_INDEX,
  niftyOrder,
  NOW,
  UNKNOWN_KEY,
  upstoxSetup,
  YESBANK,
} from "./setup";

async function brokerError(promise: Promise<unknown>): Promise<BrokerError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isBrokerError(error)) throw new Error(`Expected a BrokerError, got ${String(error)}`);
  return error;
}

function path(url: string): string {
  return new URL(url).pathname;
}

/** The first row of a `{ status, data: [...] }` fixture. */
function firstData(name: string): Record<string, unknown> {
  return (fixture(name) as { data: Record<string, unknown>[] }).data[0] ?? {};
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpstoxAdapter: login", () => {
  it("is an OAuth broker without refresh, with an account-scoped order feed", () => {
    const { adapter } = upstoxSetup();
    expect(adapter.code).toBe("UPSTOX");
    expect(adapter.capabilities).toBe(UPSTOX_CAPABILITIES);
    expect(UPSTOX_CAPABILITIES).toEqual({
      authMode: "oauth",
      refreshable: false,
      maxFeedInstruments: 5000,
      // V3 limits (per user, so per connection): `quote` is the stricter of full and option_greeks.
      feedLimits: {
        single: { ltp: 5000, quote: 2000, full: 2000 },
        mixed: { ltp: 2000, quote: 1500, full: 1500 },
      },
      orderFeedScope: "account",
    });
  });

  it("builds the authorization dialog URL with the platform app or the user's own key", () => {
    const { adapter } = upstoxSetup();
    const start = adapter.getAuthUrl({
      state: "nonce-1",
      redirectUri: "https://app.finlytics.in/v1/brokers/upstox/callback",
    });
    expect(start.mode).toBe("oauth");
    const url = new URL(start.mode === "oauth" ? start.url : "");
    expect(url.origin + url.pathname).toBe(UPSTOX_URLS.authorize);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "redacted-api-key",
      redirect_uri: "https://app.finlytics.in/v1/brokers/upstox/callback",
      response_type: "code",
      state: "nonce-1",
    });
    const own = adapter.getAuthUrl({ state: "s", redirectUri: "https://x.in/cb", apiKey: "users-own-key" });
    expect(own.mode === "oauth" && new URL(own.url).searchParams.get("client_id")).toBe("users-own-key");
  });

  it("refuses to build a login URL without an API key", () => {
    const { adapter } = upstoxSetup({ appCredentials: undefined });
    expect(() => adapter.getAuthUrl({ state: "s", redirectUri: "https://x.in/cb" })).toThrow(
      expect.objectContaining({ code: "VALIDATION" }) as Error,
    );
  });

  it("exchanges the code for a token that ends at 03:30 IST", async () => {
    const { adapter, fake } = upstoxSetup();
    const creds = await adapter.exchangeToken(
      { signal: new AbortController().signal },
      { code: VALID_CODE, redirectUri: "https://x.in/cb" },
    );
    expect(creds.accessToken.reveal()).toBe("redacted-access-token");
    expect(creds.clientId).toBe("******");
    expect(creds.expiresAt?.toISOString()).toBe("2025-10-06T22:00:00.000Z");
    expect(creds.extra).toBeUndefined();
    const request = fake.requests.at(-1);
    expect(request?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(request?.body))).toEqual({
      code: VALID_CODE,
      client_id: "redacted-api-key",
      client_secret: "redacted-api-secret",
      redirect_uri: "https://x.in/cb",
      grant_type: "authorization_code",
    });
  });

  it("uses the user's own app and keeps it with the credentials", async () => {
    const { adapter, fake } = upstoxSetup({ appCredentials: undefined });
    fake.respond(
      path(UPSTOX_URLS.token),
      json({ status: "success", data: { user_id: "AB1234", access_token: "t-1" } }),
    );
    const creds = await adapter.exchangeToken(
      { signal: new AbortController().signal },
      { code: "c", redirectUri: "https://x.in/cb", fields: { apiKey: "own-key", apiSecret: "own-secret" } },
    );
    expect(creds.extra?.apiKey?.reveal()).toBe("own-key");
    expect(creds.extra?.apiSecret?.reveal()).toBe("own-secret");
    expect(new URLSearchParams(fake.requests.at(-1)?.body).get("client_secret")).toBe("own-secret");
  });

  it.each([
    ["no code", { redirectUri: "https://x.in/cb" }, {}],
    ["no redirect URI", { code: "c" }, {}],
    ["no app", { code: "c", redirectUri: "https://x.in/cb" }, { appCredentials: undefined }],
    [
      "a user key without its secret",
      { code: "c", redirectUri: "https://x.in/cb", fields: { apiKey: "k" } },
      { appCredentials: undefined },
    ],
  ])("refuses the exchange with %s", async (_name, input, options) => {
    const { adapter, fake } = upstoxSetup(options);
    const error = await brokerError(adapter.exchangeToken({ signal: new AbortController().signal }, input));
    expect(error.code).toBe("VALIDATION");
    expect(fake.requests).toHaveLength(0);
  });

  it("reports an invalid code as a rejection", async () => {
    const { adapter } = upstoxSetup();
    const error = await brokerError(
      adapter.exchangeToken({ signal: new AbortController().signal }, { code: "used", redirectUri: "https://x.in/cb" }),
    );
    expect(error.code).toBe("BROKER_REJECTED");
    expect(error.brokerError).toEqual({ code: "UDAPI100057", message: "Invalid authorization code" });
  });

  it("can't refresh: the user logs in again", async () => {
    const error = await brokerError(upstoxSetup().adapter.refreshToken());
    expect(error.code).toBe("NEEDS_RELOGIN");
  });
});

describe("UpstoxAdapter: errors", () => {
  it.each([
    ["401 without a body", new Response("unauthorised", { status: 401 }), "NEEDS_RELOGIN", "HTTP_401"],
    ["an extended token", json(upstoxErrorBody("UDAPI100067", "Not permitted"), 403), "NEEDS_RELOGIN", "UDAPI100067"],
    ["429", json(upstoxErrorBody("UDAPI10005", "Too many"), 429, { "retry-after": "2" }), "RATE_LIMITED", "UDAPI10005"],
    ["UDAPI10005 on a 400", json(upstoxErrorBody("UDAPI10005", "Too many"), 400), "RATE_LIMITED", "UDAPI10005"],
    ["a 503", json({}, 503), "BROKER_UNAVAILABLE", "HTTP_503"],
    ["service hours", json(upstoxErrorBody("UDAPI100072", "Closed"), 423), "BROKER_UNAVAILABLE", "UDAPI100072"],
    ["a 404", json({ status: "error", errors: [{ error_code: "UDAPI10000" }] }, 404), "NOT_FOUND", "UDAPI10000"],
    ["any other 4xx", json(upstoxErrorBody("UDAPI100036", "Invalid input"), 400), "BROKER_REJECTED", "UDAPI100036"],
    ["an error on a 200", json(upstoxErrorBody("UDAPI100036", "Invalid input"), 200), "BROKER_REJECTED", "UDAPI100036"],
    [
      "an unexpected shape",
      json({ status: "success", data: { equity: null } }),
      "BROKER_UNAVAILABLE",
      "UNEXPECTED_RESPONSE",
    ],
  ])("maps %s", async (_name, response, code, brokerCode) => {
    const { adapter, fake, ctx } = upstoxSetup();
    fake.respond(path(UPSTOX_URLS.funds), response);
    const error = await brokerError(adapter.getFunds(ctx()));
    expect(error.code).toBe(code);
    expect(error.brokerError?.code).toBe(brokerCode);
    expect(error.operation).toBe("getFunds");
    expect(error.outcomeUnknown).toBe(false);
  });

  it("passes on Retry-After, defaulting to one second", async () => {
    const { adapter, fake, ctx } = upstoxSetup();
    fake.respond(path(UPSTOX_URLS.funds), json({}, 429, { "retry-after": "2" }));
    fake.respond(path(UPSTOX_URLS.funds), json({}, 429));
    expect((await brokerError(adapter.getFunds(ctx()))).retryAfterMs).toBe(2000);
    expect((await brokerError(adapter.getFunds(ctx()))).retryAfterMs).toBe(1000);
  });

  it("leaves the outcome of an order unknown when Upstox fails mid-call", async () => {
    const { adapter, fake, ctx } = upstoxSetup();
    fake.respond(path(UPSTOX_URLS.placeOrder), json({}, 502));
    fake.respond(path(UPSTOX_URLS.placeOrder), json({ status: "success", data: {} }));
    for (const expected of ["HTTP_502", "UNEXPECTED_RESPONSE"]) {
      const error = await brokerError(adapter.placeOrder(ctx(), niftyOrder()));
      expect(error.code).toBe("BROKER_UNAVAILABLE");
      expect(error.brokerError?.code).toBe(expected);
      expect(error.outcomeUnknown).toBe(true);
    }
  });

  it("maps network failures and cut-off answers to unavailable", async () => {
    const failing = upstoxSetup({ fetch: () => Promise.reject(new TypeError("fetch failed")) });
    const network = await brokerError(failing.adapter.placeOrder(failing.ctx(), niftyOrder()));
    expect(network).toMatchObject({ code: "BROKER_UNAVAILABLE", outcomeUnknown: true });
    expect(network.brokerError?.code).toBe("NETWORK");

    const cut = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("socket hang up"));
        },
      }),
    );
    const cutOff = upstoxSetup({ fetch: () => Promise.resolve(cut) });
    const error = await brokerError(cutOff.adapter.getProfile(cutOff.ctx()));
    expect(error).toMatchObject({ code: "BROKER_UNAVAILABLE", outcomeUnknown: false });
  });

  it("rethrows the caller's abort reason, before or during the call", async () => {
    const reason = new Error("caller went away");
    const controller = new AbortController();
    const aborting = upstoxSetup({
      fetch: () => {
        controller.abort(reason);
        return Promise.reject(new DOMException("aborted", "AbortError"));
      },
    });
    await expect(aborting.adapter.getProfile(aborting.ctx(controller.signal))).rejects.toBe(reason);

    const late = new AbortController();
    const body = new ReadableStream({
      pull(stream) {
        late.abort(reason);
        stream.error(new Error("aborted"));
      },
    });
    const reading = upstoxSetup({ fetch: () => Promise.resolve(new Response(body)) });
    await expect(reading.adapter.getProfile(reading.ctx(late.signal))).rejects.toBe(reason);
  });

  it("asks for a re-login with an invalid token, without leaking it", async () => {
    const { adapter, expiredCreds } = upstoxSetup();
    const error = await brokerError(adapter.getProfile({ signal: new AbortController().signal, creds: expiredCreds }));
    expect(error.code).toBe("NEEDS_RELOGIN");
    expect(JSON.stringify(error)).not.toContain("expired-access-token");
  });
});

describe("UpstoxAdapter: account reads", () => {
  it("reads the profile, funds, positions and holdings", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    expect(await adapter.getProfile(ctx())).toMatchObject({
      brokerClientId: "******",
      exchanges: ["NSE", "NFO", "BSE", "CDS", "BFO"],
    });
    expect(await adapter.getFunds(ctx())).toEqual({ availableMargin: "15507.46", usedMargin: "0.8", collateral: "0" });
    expect(await adapter.getPositions(ctx())).toEqual([
      expect.objectContaining({ instrumentKey: BANKNIFTY_PE, product: "MARGIN", netQty: 15 }),
    ]);
    expect(await adapter.getHoldings(ctx())).toEqual([expect.objectContaining({ instrumentKey: YESBANK, qty: 36 })]);
    expect(fake.requests.every((request) => request.headers.Authorization === "Bearer redacted-access-token")).toBe(
      true,
    );
  });

  it("skips rows it can't map instead of failing the whole list", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    const position = { product: "D", instrument_token: "NSE_FO|52618", quantity: 1 };
    fake.respond(
      path(UPSTOX_URLS.positions),
      json({
        status: "success",
        data: [position, { ...position, instrument_token: "NSE_FO|0" }, { ...position, product: "XX" }, { junk: true }],
      }),
    );
    fake.respond(
      path(UPSTOX_URLS.holdings),
      json({ status: "success", data: [{ instrument_token: "NSE_EQ|INE000000000", quantity: 1, average_price: 1 }] }),
    );
    expect(await adapter.getPositions(ctx())).toHaveLength(1);
    expect(await adapter.getHoldings(ctx())).toEqual([]);
  });

  it("maps the order book, skipping unknown instruments and unsupported rows", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    const base = fake.firstOrder();
    fake.orders.push({ ...base, order_id: "X1", instrument_token: "NSE_FO|99999" });
    fake.orders.push({ ...base, order_id: "X2", product: "XX" });
    fake.orders.push({ order_id: "X3", instrument_token: "NSE_EQ|INE220J01025", status: "open" });
    // An equity the resolver doesn't know still maps, through its trading symbol.
    fake.orders.push({ ...base, order_id: "X4", instrument_token: "NSE_EQ|INE000000000" });
    const orders = await adapter.getOrderBook(ctx());
    expect(orders.map((order) => [order.brokerOrderId, order.instrumentKey])).toEqual([
      ["231019025057849", "BSE_EQ|FCONSUMER"],
      ["X4", "NSE_EQ|FCONSUMER"],
    ]);
  });

  it("maps equity holdings and positions before the instrument master is synced", async () => {
    const { adapter, ctx, fake } = upstoxSetup({ instruments: new UpstoxInstrumentMap() });
    const equity = { product: "D", instrument_token: "NSE_EQ|INE528G01035", quantity: 5, trading_symbol: "YESBANK" };
    fake.respond(
      path(UPSTOX_URLS.positions),
      json({ status: "success", data: [{ ...firstData("positions.json") }, equity] }),
    );
    expect(await adapter.getHoldings(ctx())).toEqual([
      { instrumentKey: YESBANK, qty: 36, t1Qty: 0, avgPrice: "18.75", ltp: "17.05", close: "17.05" },
    ]);
    // The option needs the master; the equity maps through its trading symbol.
    expect((await adapter.getPositions(ctx())).map((position) => position.instrumentKey)).toEqual([YESBANK]);
  });
});

describe("UpstoxAdapter: orders", () => {
  it("places an order with Upstox's field names and enums", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    const { brokerOrderId } = await adapter.placeOrder(
      ctx(),
      niftyOrder({ type: "SL", price: "210.05", triggerPrice: "210", product: "MARGIN", tag: "algo-7" }),
    );
    const request = fake.requests.at(-1);
    expect(request?.url).toBe(UPSTOX_URLS.placeOrder);
    expect(request?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(request?.body ?? "")).toEqual({
      quantity: 75,
      product: "D",
      validity: "DAY",
      price: 210.05,
      tag: "algo-7",
      instrument_token: "NSE_FO|45450",
      order_type: "SL",
      transaction_type: "BUY",
      disclosed_quantity: 0,
      trigger_price: 210,
      is_amo: false,
    });
    expect(brokerOrderId).toMatch(/^25100600000\d+$/);
  });

  it("sends SL-M and MTF as Upstox spells them", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    await adapter.placeOrder(ctx(), {
      instrumentKey: YESBANK,
      side: "SELL",
      type: "SL_M",
      product: "MARGIN",
      validity: "IOC",
      qty: 10,
      triggerPrice: "17.01",
    });
    expect(JSON.parse(fake.requests.at(-1)?.body ?? "")).toMatchObject({
      order_type: "SL-M",
      product: "MTF",
      validity: "IOC",
      price: 0,
      trigger_price: 17.01,
      transaction_type: "SELL",
    });
  });

  it.each([
    ["an unknown instrument", niftyOrder({ instrumentKey: UNKNOWN_KEY }), "UNKNOWN_INSTRUMENT"],
    ["a CO product", niftyOrder({ product: "CO" }), "PRODUCT"],
    ["a quantity off the lot size", niftyOrder({ qty: 80 }), "LOT_SIZE"],
    ["a quantity above the freeze quantity", niftyOrder({ qty: 1875 }), "FREEZE_QTY"],
    ["a price off the tick size", niftyOrder({ type: "LIMIT", price: "50.02" }), "TICK_SIZE"],
    ["a trigger off the tick size", niftyOrder({ type: "SL_M", triggerPrice: "50.01" }), "TICK_SIZE"],
  ])("refuses %s before calling Upstox", async (_name, order, code) => {
    const { adapter, ctx, fake } = upstoxSetup();
    const error = await brokerError(adapter.placeOrder(ctx(), order));
    expect(error.code).toBe("VALIDATION");
    expect(error.brokerError?.code).toBe(code);
    expect(fake.requests).toHaveLength(0);
  });

  it("modifies with every required field, reading missing ones from the order book", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    const { brokerOrderId } = await adapter.placeOrder(
      ctx(),
      niftyOrder({ type: "SL", price: "60", triggerPrice: "59", validity: "DAY" }),
    );
    fake.requests.length = 0;
    await adapter.modifyOrder(ctx(), { brokerOrderId, qty: 150 });
    expect(fake.requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(fake.requests[1]?.body ?? "")).toEqual({
      order_id: brokerOrderId,
      quantity: 150,
      validity: "DAY",
      price: 60,
      order_type: "SL",
      trigger_price: 59,
    });

    fake.requests.length = 0;
    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "MARKET", validity: "IOC" });
    expect(fake.requests.map((request) => request.method)).toEqual(["PUT"]);
    expect(JSON.parse(fake.requests[0]?.body ?? "")).toEqual({
      order_id: brokerOrderId,
      validity: "IOC",
      price: 0,
      order_type: "MARKET",
      trigger_price: 0,
    });

    fake.requests.length = 0;
    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "LIMIT", validity: "DAY", price: "61" });
    expect(fake.requests.map((request) => request.method)).toEqual(["PUT"]);
  });

  it("sends zeros when the order book has no price or trigger to fill in", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    fake.orders.push({
      ...fake.firstOrder(),
      order_id: "SLM1",
      order_type: "SL",
      price: 0,
      trigger_price: null,
      status: "open",
    });
    await adapter.modifyOrder(ctx(), { brokerOrderId: "SLM1", qty: 2 });
    expect(JSON.parse(fake.requests.at(-1)?.body ?? "")).toMatchObject({
      price: 0,
      trigger_price: 0,
      order_type: "SL",
    });
  });

  it("can't modify an order the book doesn't have, or one of a kind it can't express", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    expect((await brokerError(adapter.modifyOrder(ctx(), { brokerOrderId: "NOPE", qty: 1 }))).code).toBe("NOT_FOUND");
    fake.orders.push({ ...fake.firstOrder(), order_id: "AMO1", order_type: "AMO" });
    expect((await brokerError(adapter.modifyOrder(ctx(), { brokerOrderId: "AMO1", qty: 1 }))).code).toBe(
      "BROKER_REJECTED",
    );
  });

  it("cancels by order id in the query string", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    await adapter.cancelOrder(ctx(), "231019025057849");
    expect(fake.requests.at(-1)).toMatchObject({
      method: "DELETE",
      url: `${UPSTOX_URLS.cancelOrder}?order_id=231019025057849`,
    });
    const error = await brokerError(adapter.cancelOrder(ctx(), "NO-SUCH-ORDER-1"));
    expect(error).toMatchObject({ code: "NOT_FOUND", outcomeUnknown: false });
  });
});

describe("UpstoxAdapter: historical candles", () => {
  const candleUrls = (fake: ReturnType<typeof upstoxSetup>["fake"]): string[] =>
    fake.requests.map((request) => request.url.replace("https://api.upstox.com/v3/historical-candle", ""));

  it("reads a past range from the V3 historical endpoint, ascending", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    const candles = await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: NIFTY_CE,
      timeframe: "M1",
      from: new Date("2025-10-03T03:45:00Z"),
      to: new Date("2025-10-03T03:46:00Z"),
    });
    expect(candleUrls(fake)).toEqual(["/NSE_FO%7C45450/minutes/1/2025-10-03/2025-10-03"]);
    // 09:17 IST ends after `to`; 09:15 starts before `from` but its minute overlaps it.
    expect(candles.map((candle) => new Date(candle.ts).toISOString())).toEqual([
      "2025-10-03T03:45:00.000Z",
      "2025-10-03T03:46:00.000Z",
    ]);
    expect(candles[0]).toMatchObject({ open: "51", close: "52.4", volume: 312004, oi: 1110000 });
  });

  it("splits long ranges into the windows Upstox accepts", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: NIFTY_CE,
      timeframe: "M5",
      from: new Date("2025-07-01T03:45:00Z"),
      to: new Date("2025-08-30T10:00:00Z"),
    });
    expect(candleUrls(fake)).toEqual([
      "/NSE_FO%7C45450/minutes/5/2025-07-28/2025-07-01",
      "/NSE_FO%7C45450/minutes/5/2025-08-25/2025-07-29",
      "/NSE_FO%7C45450/minutes/5/2025-08-30/2025-08-26",
    ]);
  });

  it("never asks for days before Upstox has data (minutes from 2022, days from 2000)", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: NIFTY_CE,
      timeframe: "M15",
      from: new Date("2021-12-20T03:45:00Z"),
      to: new Date("2022-01-03T10:00:00Z"),
    });
    await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: NIFTY_CE,
      timeframe: "D1",
      from: new Date("1999-12-01T00:00:00Z"),
      to: new Date("2000-01-02T10:00:00Z"),
    });
    expect(candleUrls(fake)).toEqual([
      "/NSE_FO%7C45450/minutes/15/2022-01-03/2022-01-01",
      "/NSE_FO%7C45450/days/1/2000-01-02/2000-01-01",
    ]);
  });

  it("adds today's candles from the intraday endpoint, and asks only it for today", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    const candles = await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: NIFTY_INDEX,
      timeframe: "H1",
      from: new Date("2025-10-03T03:45:00Z"),
      to: NOW,
    });
    expect(candleUrls(fake)).toEqual([
      "/NSE_INDEX%7CNifty%2050/hours/1/2025-10-05/2025-10-03",
      "/intraday/NSE_INDEX%7CNifty%2050/hours/1",
    ]);
    expect(candles.at(-1)).toEqual({
      ts: Date.parse("2025-10-06T03:46:00Z"),
      open: "2305.3",
      high: "2307.05",
      low: "2301",
      close: "2304.65",
      volume: 559982,
    });

    fake.requests.length = 0;
    await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: CRUDE_FUT,
      timeframe: "D1",
      from: new Date("2025-10-06T00:00:00Z"),
      to: NOW,
    });
    expect(candleUrls(fake)).toEqual(["/intraday/MCX_FO%7C436953/days/1"]);
  });

  it("drops candles Upstox sends with an unreadable time, and refuses unknown instruments", async () => {
    const { adapter, ctx, fake } = upstoxSetup();
    fake.respond(
      "/v3/historical-candle/NSE_FO%7C45450/minutes/1/2025-10-03/2025-10-03",
      json({ status: "success", data: { candles: [["garbage", 1, 1, 1, 1, 1]] } }),
    );
    const query = {
      instrumentKey: NIFTY_CE,
      timeframe: "M1" as const,
      from: new Date("2025-10-03T03:45:00Z"),
      to: new Date("2025-10-03T03:46:00Z"),
    };
    expect(await adapter.getHistoricalCandles(ctx(), query)).toEqual([]);
    const error = await brokerError(adapter.getHistoricalCandles(ctx(), { ...query, instrumentKey: UNKNOWN_KEY }));
    expect(error.brokerError?.code).toBe("UNKNOWN_INSTRUMENT");
  });
});

describe("UpstoxAdapter: instrument master", () => {
  it("downloads the master without credentials and yields canonical rows", async () => {
    const { adapter, fake } = upstoxSetup();
    const rows = [];
    for await (const row of adapter.downloadInstrumentMaster({ signal: new AbortController().signal })) rows.push(row);
    expect(rows).toEqual(fixtureRows());
    expect(fake.requests).toEqual([
      expect.objectContaining({ url: UPSTOX_URLS.instrumentMaster, headers: { Accept: "application/json" } }),
    ]);
  });

  it("fails on an HTTP error or an empty body", async () => {
    for (const response of [json({}, 503), new Response(null, { status: 200 })]) {
      const { adapter } = upstoxSetup({ fetch: () => Promise.resolve(response) });
      const error = await brokerError(
        (async () => {
          for await (const row of adapter.downloadInstrumentMaster({ signal: new AbortController().signal })) {
            expect(row).toBeUndefined();
          }
        })(),
      );
      expect(error.code).toBe("BROKER_UNAVAILABLE");
      expect(error.operation).toBe("downloadInstrumentMaster");
    }
  });
});

describe("UpstoxAdapter: defaults", () => {
  it("uses Node's fetch, an empty instrument map and the real clock by default", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(json({ status: "success", data: [] })));
    vi.stubGlobal("fetch", fetchSpy);
    const adapter = new UpstoxAdapter();
    const ctx = { signal: new AbortController().signal, creds: { accessToken: Secret.of("redacted-token-1") } };
    expect(await adapter.getOrderBook(ctx)).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const error = await brokerError(adapter.placeOrder(ctx, niftyOrder()));
    expect(error.brokerError?.code).toBe("UNKNOWN_INSTRUMENT");
    const creds = await new UpstoxAdapter({
      appCredentials: { apiKey: Secret.of("k-123456"), apiSecret: Secret.of("s-123456") },
      fetch: () => Promise.resolve(json({ user_id: "AB1", access_token: "tok-123456" })),
    }).exchangeToken({ signal: new AbortController().signal }, { code: "c", redirectUri: "https://x.in/cb" });
    expect(creds.expiresAt?.getTime()).toBeGreaterThan(Date.now());
  });
});
