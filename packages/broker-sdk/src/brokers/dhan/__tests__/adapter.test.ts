import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { Secret } from "../../../credentials";
import { isBrokerError } from "../../../errors";
import type { BrokerError } from "../../../errors";
import type { PlaceOrderInput } from "../../../models";
import { BrokerGateway } from "../../../gateway";
import { MemoryRateLimiter } from "../../../rate-limit/memory-rate-limiter";
import { createBrokerRegistry } from "../../../registry";
import { DHAN_CAPABILITIES, DhanAdapter } from "../adapter";
import { DhanInstrumentMap } from "../instruments";
import { DHAN_SCRIP_MASTER_URL } from "../types";

import {
  CLIENT_ID,
  CREDS,
  EXPIRES_AT,
  FakeDhan,
  fakeJwt,
  fixture,
  KEYS,
  NOW,
  RENEWED_EXPIRES_AT,
  RENEWED_TOKEN,
  seededInstruments,
  TOKEN,
} from "./fake-dhan";

function setup(instruments: DhanInstrumentMap = seededInstruments()): { dhan: FakeDhan; adapter: DhanAdapter } {
  const dhan = new FakeDhan();
  return {
    dhan,
    adapter: new DhanAdapter({ fetch: dhan.fetch, webSocket: dhan.sockets.factory, instruments, now: () => NOW }),
  };
}

const ctx = (creds = CREDS) => ({ signal: new AbortController().signal, creds });

async function failure(promise: Promise<unknown>): Promise<BrokerError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isBrokerError(error)) throw new Error("expected a BrokerError", { cause: error });
  return error;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const ORDER: PlaceOrderInput = {
  instrumentKey: KEYS.niftyCe,
  side: "SELL",
  type: "SL",
  product: "DELIVERY",
  validity: "DAY",
  qty: 75,
  price: "101.5",
  triggerPrice: "102",
  tag: "algo-7",
};

describe("DhanAdapter: auth", () => {
  it("asks for the client id and access token; Dhan has no OAuth", () => {
    const { adapter } = setup();
    expect(adapter.capabilities).toBe(DHAN_CAPABILITIES);
    expect(adapter.getAuthUrl()).toMatchObject({
      mode: "token",
      fields: [
        { name: "clientId", secret: false },
        { name: "accessToken", secret: true },
      ],
    });
  });

  it("checks a pasted token against the profile and reads its expiry", async () => {
    const { adapter, dhan } = setup();
    const creds = await adapter.exchangeToken(ctx(), { fields: { clientId: ` ${CLIENT_ID} `, accessToken: TOKEN } });
    expect(creds.accessToken.reveal()).toBe(TOKEN);
    expect(creds.clientId).toBe(CLIENT_ID);
    expect(creds.expiresAt).toEqual(EXPIRES_AT);
    expect(dhan.requests[0]).toMatchObject({ method: "GET", url: "https://api.dhan.co/v2/profile" });
    expect(dhan.requests[0]?.headers["access-token"]).toBe(TOKEN);
  });

  it("falls back to the profile's token validity for a token that isn't a JWT", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/profile", () => json(fixture("profile.json")));
    const creds = await adapter.exchangeToken(ctx(), {
      fields: { clientId: CLIENT_ID, accessToken: "opaque-token-0123456789" },
    });
    expect(creds.expiresAt?.toISOString()).toBe("2025-10-08T16:00:00.000Z");
    dhan.overrides.set("GET /v2/profile", () => json({ dhanClientId: CLIENT_ID }));
    const noExpiry = await adapter.exchangeToken(ctx(), {
      fields: { clientId: CLIENT_ID, accessToken: "opaque-token-0123456789" },
    });
    expect(noExpiry.expiresAt).toBeUndefined();
  });

  it("refuses missing fields, a token Dhan rejects, and a token of another client", async () => {
    const { adapter, dhan } = setup();
    expect((await failure(adapter.exchangeToken(ctx(), {}))).code).toBe("VALIDATION");
    expect(
      (await failure(adapter.exchangeToken(ctx(), { fields: { clientId: "x y", accessToken: TOKEN } }))).code,
    ).toBe("VALIDATION");
    const rejected = await failure(
      adapter.exchangeToken(ctx(), { fields: { clientId: CLIENT_ID, accessToken: "wrong-token-REDACTED-123" } }),
    );
    expect(rejected).toMatchObject({
      code: "BROKER_REJECTED",
      operation: "exchangeToken",
      brokerError: { code: "DH-901" },
    });
    const mismatch = await failure(
      adapter.exchangeToken(ctx(), { fields: { clientId: "1000000002", accessToken: TOKEN } }),
    );
    expect(mismatch).toMatchObject({ code: "BROKER_REJECTED", brokerError: { code: "CLIENT_MISMATCH" } });
    dhan.overrides.set("GET /v2/profile", () => json({ errorCode: "DH-908" }, 500));
    expect(
      (await failure(adapter.exchangeToken(ctx(), { fields: { clientId: CLIENT_ID, accessToken: TOKEN } }))).code,
    ).toBe("BROKER_UNAVAILABLE");
  });

  it("renews the token with the client id header", async () => {
    const { adapter, dhan } = setup();
    const creds = await adapter.refreshToken(ctx());
    expect(creds.accessToken.reveal()).toBe(RENEWED_TOKEN);
    expect(creds.expiresAt).toEqual(RENEWED_EXPIRES_AT);
    expect(dhan.requests[0]?.headers.dhanclientid).toBe(CLIENT_ID);
    dhan.overrides.set("GET /v2/RenewToken", () =>
      json({ accessToken: "opaque-renewed-0123", expiryTime: "2025-10-09T21:30:00.000" }),
    );
    expect((await adapter.refreshToken(ctx())).expiresAt?.toISOString()).toBe("2025-10-09T16:00:00.000Z");
    // No expiry anywhere: the documented 24 hours from now.
    dhan.overrides.set("GET /v2/RenewToken", () => json({ accessToken: "opaque-renewed-0123" }));
    expect((await adapter.refreshToken(ctx())).expiresAt).toEqual(new Date(NOW.getTime() + 86_400_000));
  });

  it("reads the renewed token from every shape Dhan might answer with", async () => {
    const { adapter, dhan } = setup();
    const renewed = async (response: Response): Promise<{ token: string; expiresAt: string | undefined }> => {
      dhan.overrides.set("GET /v2/RenewToken", () => response);
      const creds = await adapter.refreshToken(ctx());
      return { token: creds.accessToken.reveal(), expiresAt: creds.expiresAt?.toISOString() };
    };
    const enveloped = fixture("renew-token-envelope.json") as { data: Record<string, unknown> };
    expect(
      await renewed(json({ ...enveloped, data: { ...enveloped.data, access_token: "opaque-renewed-4567" } })),
    ).toEqual({ token: "opaque-renewed-4567", expiresAt: "2025-10-09T16:00:00.000Z" });
    expect(await renewed(new Response(` ${RENEWED_TOKEN}\n`, { headers: { "content-type": "text/plain" } }))).toEqual({
      token: RENEWED_TOKEN,
      expiresAt: RENEWED_EXPIRES_AT.toISOString(),
    });
    expect((await renewed(json(RENEWED_TOKEN))).token).toBe(RENEWED_TOKEN);
    expect((await renewed(json({ token: "opaque-renewed-8910", tokenValidity: "09/10/2025 21:30" }))).expiresAt).toBe(
      "2025-10-09T16:00:00.000Z",
    );
    for (const answer of [new Response("OK"), json("short"), json([RENEWED_TOKEN]), json({ accessToken: "short" })]) {
      dhan.overrides.set("GET /v2/RenewToken", () => answer);
      expect(await failure(adapter.refreshToken(ctx()))).toMatchObject({
        code: "NEEDS_RELOGIN",
        brokerError: { code: "UNEXPECTED_RESPONSE" },
      });
    }
  });

  it("asks for a re-login when Dhan refuses to renew an expired token", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/RenewToken", () => json(fixture("error-dh901.json"), 401));
    expect(await failure(adapter.refreshToken(ctx()))).toMatchObject({
      code: "NEEDS_RELOGIN",
      operation: "refreshToken",
      brokerError: { code: "DH-901" },
    });
    dhan.overrides.set("GET /v2/RenewToken", () => json(fixture("error-legacy.json")));
    expect((await failure(adapter.refreshToken(ctx()))).code).toBe("NEEDS_RELOGIN");
  });

  it("cleans a pasted token and takes the client id from the token when the form leaves it empty", async () => {
    const { adapter, dhan } = setup();
    const creds = await adapter.exchangeToken(ctx(), {
      fields: { clientId: "", accessToken: ` "Bearer ${TOKEN}\n" ` },
    });
    expect(creds).toMatchObject({ clientId: CLIENT_ID, expiresAt: EXPIRES_AT });
    expect(creds.accessToken.reveal()).toBe(TOKEN);
    expect(dhan.requests[0]?.headers["access-token"]).toBe(TOKEN);
    const prefixed = await adapter.exchangeToken(ctx(), { fields: { accessToken: `access-token: ${TOKEN}` } });
    expect(prefixed.accessToken.reveal()).toBe(TOKEN);
  });

  it("reads a profile with numbers for strings, nulls and extra fields", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/profile", () => json(fixture("profile-lenient.json")));
    const creds = await adapter.exchangeToken(ctx(), { fields: { accessToken: "opaque-token-0123456789" } });
    // An opaque token has no claims: the client id and the expiry come from the profile.
    expect(creds.clientId).toBe(CLIENT_ID);
    expect(creds.expiresAt?.toISOString()).toBe("2025-10-08T16:00:30.000Z");
    expect(await adapter.getProfile(ctx())).toEqual({ brokerClientId: CLIENT_ID, name: "Dhan account", exchanges: [] });
  });

  it("refuses an expired token or one for another client before asking Dhan", async () => {
    const { adapter, dhan } = setup();
    const expired = fakeJwt({ exp: NOW.getTime() / 1000 - 60, dhanClientId: CLIENT_ID });
    expect(await failure(adapter.exchangeToken(ctx(), { fields: { accessToken: expired } }))).toMatchObject({
      code: "BROKER_REJECTED",
      brokerError: { code: "TOKEN_EXPIRED" },
    });
    const other = fakeJwt({ exp: EXPIRES_AT.getTime() / 1000, dhanClientId: 1000000002 });
    expect(
      await failure(adapter.exchangeToken(ctx(), { fields: { clientId: CLIENT_ID, accessToken: other } })),
    ).toMatchObject({ code: "BROKER_REJECTED", brokerError: { code: "CLIENT_MISMATCH" } });
    expect(dhan.requests).toEqual([]);
    // An opaque token has no claim to compare: the profile tells.
    dhan.overrides.set("GET /v2/profile", () => json(fixture("profile.json")));
    expect(
      await failure(
        adapter.exchangeToken(ctx(), { fields: { clientId: "1000000002", accessToken: "opaque-token-0123456789" } }),
      ),
    ).toMatchObject({ code: "BROKER_REJECTED", brokerError: { code: "CLIENT_MISMATCH" } });
  });

  it("reports a token Dhan refuses in its legacy error shape, and a profile without a usable client id", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/profile", () => json(fixture("error-legacy.json")));
    expect(await failure(adapter.exchangeToken(ctx(), { fields: { accessToken: TOKEN } }))).toMatchObject({
      code: "BROKER_REJECTED",
      operation: "exchangeToken",
      brokerError: { code: "DH-901" },
    });
    dhan.overrides.set("GET /v2/profile", () => json({ dhanClientId: "not a client id" }));
    expect(
      await failure(adapter.exchangeToken(ctx(), { fields: { accessToken: "opaque-token-0123456789" } })),
    ).toMatchObject({ code: "BROKER_UNAVAILABLE", brokerError: { code: "UNEXPECTED_RESPONSE" } });
  });

  it("asks for a re-login when renewal returns no token or the credentials lack a client id", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/RenewToken", () => json({ status: "success" }));
    expect(await failure(adapter.refreshToken(ctx()))).toMatchObject({
      code: "NEEDS_RELOGIN",
      brokerError: { code: "UNEXPECTED_RESPONSE" },
    });
    const noClient = { accessToken: Secret.of(TOKEN) };
    expect((await failure(adapter.refreshToken(ctx(noClient)))).code).toBe("NEEDS_RELOGIN");
    expect((await failure(adapter.placeOrder(ctx(noClient), ORDER))).code).toBe("NEEDS_RELOGIN");
  });
});

describe("DhanAdapter: account reads", () => {
  it("maps profile, funds, positions and holdings from the docs' examples", async () => {
    const { adapter } = setup();
    expect(await adapter.getProfile(ctx())).toMatchObject({
      brokerClientId: CLIENT_ID,
      exchanges: ["NSE", "BSE", "MCX", "NFO", "BFO", "CDS"],
    });
    expect(await adapter.getFunds(ctx())).toEqual({
      availableMargin: "98440",
      usedMargin: "15202",
      collateral: "0",
      withdrawable: "98310",
    });
    expect((await adapter.getPositions(ctx())).map((position) => position.instrumentKey)).toEqual([
      "NSE_EQ|TCS",
      "NSE_FO|BANKNIFTY|2025-10-28|55000|PE",
    ]);
    expect(await adapter.getHoldings(ctx())).toEqual([{ instrumentKey: "NSE_EQ|HDFC", qty: 1000, avgPrice: "2655" }]);
  });

  it("treats Dhan's no-data answer as an empty list, and an empty body too", async () => {
    const { adapter, dhan } = setup();
    for (const path of ["GET /v2/holdings", "GET /v2/positions", "GET /v2/orders"]) {
      dhan.overrides.set(path, () => json(fixture("error-dh907.json"), 400));
    }
    expect(await adapter.getHoldings(ctx())).toEqual([]);
    expect(await adapter.getPositions(ctx())).toEqual([]);
    expect(await adapter.getOrderBook(ctx())).toEqual([]);
    dhan.overrides.set("GET /v2/holdings", () => new Response(""));
    expect(await adapter.getHoldings(ctx())).toEqual([]);
  });

  it("reads funds with numbers as strings and the correctly spelled balance", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/fundlimit", () => json(fixture("fundlimit-strings.json")));
    expect(await adapter.getFunds(ctx())).toEqual({ availableMargin: "98440.5", usedMargin: "15202", collateral: "0" });
  });

  it("maps every documented position field set, leaving out rows it can't read or identify", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/positions", () => json(fixture("positions-full.json")));
    expect(await adapter.getPositions(ctx())).toEqual([
      {
        instrumentKey: "NSE_EQ|TCS",
        product: "DELIVERY",
        netQty: 40,
        buyQty: 40,
        sellQty: 0,
        buyAvg: "3345.8",
        sellAvg: "0",
        realisedPnl: "0",
        unrealisedPnl: "6122",
      },
      {
        instrumentKey: KEYS.niftyCe,
        product: "INTRADAY",
        netQty: 0,
        buyQty: 75,
        sellQty: 75,
        buyAvg: "101.5",
        sellAvg: "100",
        realisedPnl: "-112.5",
      },
    ]);
    dhan.overrides.set("GET /v2/positions", () => json({ data: (fixture("positions.json") as unknown[]).slice(0, 1) }));
    expect((await adapter.getPositions(ctx())).map((position) => position.instrumentKey)).toEqual(["NSE_EQ|TCS"]);
    dhan.overrides.set("GET /v2/holdings", () =>
      json([...(fixture("holdings.json") as object[]), { securityId: "999999", exchange: "ALL" }]),
    );
    expect((await adapter.getHoldings(ctx())).map((holding) => holding.instrumentKey)).toEqual(["NSE_EQ|HDFC"]);
    dhan.overrides.set("GET /v2/orders", () =>
      json([
        { ...(fixture("order.json") as object), tradingSymbol: "TCS" },
        { ...(fixture("order.json") as object), exchangeSegment: "BSE_CURRENCY" },
        7,
      ]),
    );
    expect((await adapter.getOrderBook(ctx())).map((order) => order.brokerOrderId)).toEqual(["112111182198"]);
    dhan.overrides.set("GET /v2/holdings", () => json({ unexpected: true }));
    expect(await failure(adapter.getHoldings(ctx()))).toMatchObject({
      code: "BROKER_UNAVAILABLE",
      brokerError: { code: "UNEXPECTED_RESPONSE" },
    });
  });

  it("fails as unavailable on an answer in the wrong shape, and passes other errors through", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("GET /v2/fundlimit", () => json({ nothing: true }));
    expect(await failure(adapter.getFunds(ctx()))).toMatchObject({
      code: "BROKER_UNAVAILABLE",
      brokerError: { code: "UNEXPECTED_RESPONSE" },
    });
    dhan.overrides.set("GET /v2/positions", () => json({ errorCode: "DH-904" }, 429));
    expect((await failure(adapter.getPositions(ctx()))).code).toBe("RATE_LIMITED");
  });
});

describe("DhanAdapter: orders", () => {
  it("places an order with Dhan's exact field names and values", async () => {
    const { adapter, dhan } = setup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), ORDER);
    expect(brokerOrderId).toMatch(/^\d+$/);
    expect(dhan.requests.at(-1)).toMatchObject({
      method: "POST",
      url: "https://api.dhan.co/v2/orders",
      body: {
        dhanClientId: CLIENT_ID,
        correlationId: "algo-7",
        transactionType: "SELL",
        exchangeSegment: "NSE_FNO",
        productType: "MARGIN",
        orderType: "STOP_LOSS",
        validity: "DAY",
        securityId: "52175",
        quantity: 75,
        disclosedQuantity: 0,
        price: 101.5,
        triggerPrice: 102,
        afterMarketOrder: false,
      },
    });
    const market = { ...ORDER, type: "MARKET", price: undefined, triggerPrice: undefined, tag: undefined } as const;
    await adapter.placeOrder(ctx(), market);
    const body = dhan.requests.at(-1)?.body as Record<string, unknown>;
    expect(body).toMatchObject({ orderType: "MARKET", price: 0, triggerPrice: 0 });
    expect(body).not.toHaveProperty("correlationId");
  });

  it("refuses unknown instruments and CO/BO before calling Dhan", async () => {
    const { adapter, dhan } = setup();
    expect(
      (await failure(adapter.placeOrder(ctx(), { ...ORDER, instrumentKey: "NSE_EQ|NOPE" as InstrumentKey }))).code,
    ).toBe("NOT_FOUND");
    expect((await failure(adapter.placeOrder(ctx(), { ...ORDER, product: "CO" }))).code).toBe("VALIDATION");
    expect(dhan.requests).toEqual([]);
  });

  it("leaves the outcome unknown when the placement answer is unreadable", async () => {
    const { adapter, dhan } = setup();
    dhan.overrides.set("POST /v2/orders", () => json({ status: "ok" }));
    expect(await failure(adapter.placeOrder(ctx(), ORDER))).toMatchObject({
      code: "BROKER_UNAVAILABLE",
      outcomeUnknown: true,
    });
  });

  it("modifies by sending the whole order back, clearing prices the new type doesn't use", async () => {
    const { adapter, dhan } = setup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), ORDER);
    await adapter.modifyOrder(ctx(), { brokerOrderId, qty: 150 });
    expect(dhan.requests.at(-1)).toMatchObject({
      method: "PUT",
      url: `https://api.dhan.co/v2/orders/${brokerOrderId}`,
      body: {
        dhanClientId: CLIENT_ID,
        orderId: brokerOrderId,
        orderType: "STOP_LOSS",
        legName: "",
        quantity: 150,
        price: 101.5,
        disclosedQuantity: 0,
        triggerPrice: 102,
        validity: "DAY",
      },
    });
    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "MARKET", validity: "IOC" });
    expect(dhan.requests.at(-1)?.body).toMatchObject({
      orderType: "MARKET",
      price: 0,
      triggerPrice: 0,
      validity: "IOC",
    });
    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "SL_M", triggerPrice: "103" });
    expect(dhan.requests.at(-1)?.body).toMatchObject({
      orderType: "STOP_LOSS_MARKET",
      price: 0,
      triggerPrice: 103,
      validity: "IOC",
    });
    await adapter.modifyOrder(ctx(), { brokerOrderId, type: "SL", price: "104" });
    expect(dhan.requests.at(-1)?.body).toMatchObject({ orderType: "STOP_LOSS", price: 104, triggerPrice: 103 });
  });

  it("accepts the order read as a one-element list, and reports unknown orders", async () => {
    const { adapter, dhan } = setup();
    const { brokerOrderId } = await adapter.placeOrder(ctx(), { ...ORDER, type: "LIMIT", triggerPrice: undefined });
    const stored = dhan.orders.get(brokerOrderId);
    dhan.overrides.set(`GET /v2/orders/${brokerOrderId}`, () =>
      json([{ ...stored, price: null, legName: "ENTRY_LEG", disclosedQuantity: null, triggerPrice: null }]),
    );
    await adapter.modifyOrder(ctx(), { brokerOrderId, qty: 1 });
    expect(dhan.requests.at(-1)?.body).toMatchObject({
      legName: "ENTRY_LEG",
      price: 0,
      disclosedQuantity: 0,
      triggerPrice: 0,
    });
    dhan.overrides.set(`GET /v2/orders/${brokerOrderId}`, () => json([stored, stored]));
    expect(await failure(adapter.modifyOrder(ctx(), { brokerOrderId, qty: 1 }))).toMatchObject({
      code: "BROKER_UNAVAILABLE",
      outcomeUnknown: true,
    });
    expect((await failure(adapter.modifyOrder(ctx(), { brokerOrderId: "404", qty: 1 }))).code).toBe("NOT_FOUND");
    expect((await failure(adapter.cancelOrder(ctx(), "404"))).code).toBe("NOT_FOUND");
  });
});

describe("DhanAdapter: candles", () => {
  const range = { from: new Date("2025-10-06T03:45:00Z"), to: new Date("2025-10-06T03:48:00Z") };

  it("asks the intraday API in IST wall-clock time with OI for derivatives", async () => {
    const { adapter, dhan } = setup();
    const candles = await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: KEYS.niftyCe,
      timeframe: "M5",
      ...range,
    });
    expect(candles).toHaveLength(3);
    expect(dhan.requests.at(-1)).toMatchObject({
      url: "https://api.dhan.co/v2/charts/intraday",
      body: {
        securityId: "52175",
        exchangeSegment: "NSE_FNO",
        instrument: "OPTIDX",
        interval: "5",
        oi: true,
        fromDate: "2025-10-06 09:15:00",
        toDate: "2025-10-06 09:18:00",
      },
    });
  });

  it("aggregates M3 from M1", async () => {
    const { adapter, dhan } = setup();
    const candles = await adapter.getHistoricalCandles(ctx(), { instrumentKey: KEYS.nifty, timeframe: "M3", ...range });
    expect(candles).toEqual([
      { ts: range.from.getTime(), open: "24010.5", high: "24020", low: "24005.1", close: "24018", volume: 3600 },
    ]);
    expect(dhan.requests.at(-1)?.body).toMatchObject({
      interval: "1",
      instrument: "INDEX",
      exchangeSegment: "IDX_I",
      oi: false,
    });
  });

  it("splits long intraday ranges into 90-day requests", async () => {
    const { adapter, dhan } = setup();
    const from = new Date("2025-06-01T00:00:00Z");
    await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: KEYS.nifty,
      timeframe: "M15",
      from,
      to: new Date("2025-10-06T04:00:00Z"),
    });
    expect(dhan.requests.map((request) => (request.body as { fromDate: string }).fromDate)).toEqual([
      "2025-06-01 05:30:00",
      "2025-08-30 05:30:00",
    ]);
  });

  it("asks the daily API with an exclusive end date", async () => {
    const { adapter, dhan } = setup();
    const candles = await adapter.getHistoricalCandles(ctx(), {
      instrumentKey: KEYS.hdfcBank,
      timeframe: "D1",
      from: new Date("2025-10-05T18:30:00Z"),
      to: new Date("2025-10-07T05:00:00Z"),
    });
    expect(candles.map((candle) => candle.ts)).toEqual([1_759_689_000_000, 1_759_775_400_000]);
    expect(dhan.requests.at(-1)).toMatchObject({
      url: "https://api.dhan.co/v2/charts/historical",
      body: { instrument: "EQUITY", expiryCode: 0, oi: false, fromDate: "2025-10-06", toDate: "2025-10-08" },
    });
  });

  it("returns nothing for an empty range, no data, or an unknown instrument", async () => {
    const { adapter, dhan } = setup();
    expect(
      await adapter.getHistoricalCandles(ctx(), {
        instrumentKey: KEYS.nifty,
        timeframe: "M1",
        from: range.to,
        to: range.from,
      }),
    ).toEqual([]);
    dhan.overrides.set("POST /v2/charts/intraday", () => json(fixture("error-dh907.json"), 400));
    expect(await adapter.getHistoricalCandles(ctx(), { instrumentKey: KEYS.nifty, timeframe: "M1", ...range })).toEqual(
      [],
    );
    dhan.overrides.set("POST /v2/charts/intraday", () => new Response(""));
    expect(await adapter.getHistoricalCandles(ctx(), { instrumentKey: KEYS.nifty, timeframe: "M1", ...range })).toEqual(
      [],
    );
    expect(
      (
        await failure(
          adapter.getHistoricalCandles(ctx(), {
            instrumentKey: "NSE_EQ|NOPE" as InstrumentKey,
            timeframe: "M1",
            ...range,
          }),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("DhanAdapter: instrument master", () => {
  it("streams canonical rows once per key and fills the instrument map", async () => {
    const instruments = new DhanInstrumentMap();
    const { adapter, dhan } = setup(instruments);
    const keys: string[] = [];
    for await (const row of adapter.downloadInstrumentMaster({ signal: new AbortController().signal }))
      keys.push(row.instrumentKey);
    expect(keys).toContain("NSE_FO|NIFTY|2025-10-30|24000|CE");
    expect(keys.filter((key) => key === "NSE_EQ|HDFCBANK")).toHaveLength(1);
    expect(instruments.keyOf("NSE_EQ", "1333")).toBe("NSE_EQ|HDFCBANK");
    expect(instruments.get("NSE_INDEX|NIFTY 50" as InstrumentKey)).toEqual({
      exchangeSegment: "IDX_I",
      securityId: "13",
      instrument: "INDEX",
    });
    expect(dhan.requests[0]?.url).toBe(DHAN_SCRIP_MASTER_URL);
    expect(dhan.requests[0]?.headers["access-token"]).toBeUndefined();
  });

  it("maps download failures and stops when the signal aborts", async () => {
    const collect = async (adapter: DhanAdapter, signal = new AbortController().signal) => {
      const rows: unknown[] = [];
      for await (const row of adapter.downloadInstrumentMaster({ signal })) rows.push(row);
      return rows;
    };
    const notFound = new DhanAdapter({ fetch: () => Promise.resolve(new Response("gone", { status: 404 })) });
    expect((await failure(collect(notFound))).code).toBe("NOT_FOUND");
    const noBody = new DhanAdapter({ fetch: () => Promise.resolve(new Response(null, { status: 200 })) });
    expect((await failure(collect(noBody))).code).toBe("BROKER_UNAVAILABLE");
    const offline = new DhanAdapter({ fetch: () => Promise.reject(new TypeError("fetch failed")) });
    expect((await failure(collect(offline))).code).toBe("BROKER_UNAVAILABLE");

    const controller = new AbortController();
    const { adapter } = setup();
    const reason = new Error("stop");
    let rows = 0;
    const run = (async () => {
      for await (const row of adapter.downloadInstrumentMaster({ signal: controller.signal })) {
        expect(row.brokerToken).toContain(":");
        rows += 1;
        if (rows === 2) controller.abort(reason);
      }
    })();
    await expect(run).rejects.toBe(reason);
    expect(rows).toBe(2);
    await expect(collect(adapter, controller.signal)).rejects.toBe(reason);
  });
});

describe("DhanAdapter: feeds", () => {
  it("opens the market feed with the documented query and the order feed with a login message", async () => {
    const { adapter, dhan } = setup();
    const market = await adapter.connectMarketFeed(ctx());
    const url = new URL(dhan.marketSockets()[0]?.url ?? "");
    expect(`${url.protocol}//${url.host}`).toBe("wss://api-feed.dhan.co");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      version: "2",
      token: TOKEN,
      clientId: CLIENT_ID,
      authType: "2",
    });
    const orders = await adapter.connectOrderFeed(ctx());
    expect(dhan.orderSockets()[0]?.messages()).toEqual([
      { LoginReq: { MsgCode: 42, ClientId: CLIENT_ID, Token: TOKEN }, UserType: "SELF" },
    ]);
    await market.close();
    await orders.close();
  });

  it("uses Node's fetch and WebSocket when none are injected", () => {
    const adapter = new DhanAdapter();
    expect(adapter.code).toBe("DHAN");
  });
});

describe("DhanAdapter through the gateway and registry", () => {
  it("is registered and works behind BrokerGateway", async () => {
    const dhan = new FakeDhan();
    const adapter = createBrokerRegistry().create("DHAN", {
      fetch: dhan.fetch,
      webSocket: dhan.sockets.factory,
      instruments: seededInstruments(),
    });
    const gateway = new BrokerGateway({ adapter, rateLimiter: new MemoryRateLimiter() });
    const account = { accountId: "acc-1", creds: CREDS };
    expect((await gateway.getFunds(account)).availableMargin).toBe("98440");
    const expired = { accountId: "acc-1", creds: { ...CREDS, accessToken: Secret.of(fakeJwt({ exp: 1 }, "OLD")) } };
    const error = await failure(gateway.getProfile(expired));
    expect(error.code).toBe("NEEDS_RELOGIN");
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
});
