/**
 * An in-memory Dhan for tests: an injected `fetch` that answers like DhanHQ v2 (shapes from ../fixtures, which copy
 * the docs' examples, redacted) and an injected WebSocket factory whose sockets the test drives. No network.
 *
 * Fixtures: the client id is the docs' placeholder `1000000001`; tokens are fake, unsigned JWTs built here; nothing
 * comes from a real account.
 */
import { readFileSync } from "node:fs";

import type { InstrumentKey } from "@finlytics/shared";

import { Secret } from "../../../credentials";
import type { BrokerCredentials } from "../../../credentials";
import type { DhanSocket, DhanWebSocketFactory } from "../feed";
import type { DhanFetch } from "../http";
import { DhanInstrumentMap } from "../instruments";
import { DHAN_SCRIP_MASTER_URL } from "../types";

export const CLIENT_ID = "1000000001";
export const EXPIRES_AT = new Date("2025-10-07T16:00:00.000Z");
export const RENEWED_EXPIRES_AT = new Date("2025-10-08T16:00:00.000Z");

/** A fake, unsigned JWT with Dhan's claim names. */
export function fakeJwt(claims: unknown, signature = "REDACTED-SIGNATURE"): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS512", typ: "JWT" })}.${part(claims)}.${signature}`;
}

export const TOKEN = fakeJwt({ iss: "dhan", exp: EXPIRES_AT.getTime() / 1000, dhanClientId: CLIENT_ID });
export const RENEWED_TOKEN = fakeJwt({ iss: "dhan", exp: RENEWED_EXPIRES_AT.getTime() / 1000 }, "REDACTED-RENEWED");

export const CREDS: BrokerCredentials = { accessToken: Secret.of(TOKEN), clientId: CLIENT_ID, expiresAt: EXPIRES_AT };

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

/** Keys the contract and unit tests use, with their Dhan tokens (as the api's reverse map would hold them). */
export const KEYS = Object.freeze({
  hdfcBank: "NSE_EQ|HDFCBANK" as InstrumentKey,
  niftyCe: "NSE_FO|NIFTY|2025-10-30|24000|CE" as InstrumentKey,
  niftyFut: "NSE_FO|NIFTY|2025-10-28" as InstrumentKey,
  nifty: "NSE_INDEX|NIFTY 50" as InstrumentKey,
  usdInrCe: "NSE_CD|USDINR|2025-10-29|83.25|CE" as InstrumentKey,
  gold: "MCX_FO|GOLD|2025-12-05" as InstrumentKey,
});

export function seededInstruments(): DhanInstrumentMap {
  const map = new DhanInstrumentMap();
  map.load([
    { instrumentKey: KEYS.hdfcBank, brokerToken: "NSE_EQ:1333" },
    { instrumentKey: KEYS.niftyCe, brokerToken: "NSE_FNO:52175" },
    { instrumentKey: KEYS.niftyFut, brokerToken: "NSE_FNO:35001" },
    { instrumentKey: KEYS.nifty, brokerToken: "IDX_I:13" },
    { instrumentKey: KEYS.usdInrCe, brokerToken: "NSE_CURRENCY:8000" },
    { instrumentKey: KEYS.gold, brokerToken: "MCX_COMM:440000" },
  ]);
  return map;
}

// ---------------------------------------------------------------------------------------------------------------------
// WebSocket

type Listener = (event: unknown) => void;

export class FakeSocket implements DhanSocket {
  binaryType = "blob";
  readonly sent: string[] = [];
  closed = false;
  closeCode: number | undefined;
  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {}

  addEventListener(type: "open" | "message" | "close" | "error", listener: Listener): void {
    let set = this.#listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
  }

  send(data: string): void {
    if (this.closed) throw new Error("socket closed");
    this.sent.push(data);
  }

  close(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code;
    queueMicrotask(() => {
      this.#emit("close", { code: code ?? 1000, reason: "" });
    });
  }

  /** Sent JSON messages, parsed. */
  messages(): Record<string, unknown>[] {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }

  // Test controls --------------------------------------------------------------------------------------------------

  open(): void {
    this.#emit("open", { type: "open" });
  }

  receive(data: unknown): void {
    this.#emit("message", { data });
  }

  /** The server drops the connection. */
  drop(code = 1006): void {
    this.closed = true;
    this.#emit("error", { type: "error", message: `failed: ${this.url}` });
    this.#emit("close", { code, reason: "" });
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

export interface FakeSocketsOptions {
  /** Open new sockets by themselves (default true); `false` leaves it to the test. */
  readonly autoOpen?: boolean;
  /** Drop new sockets instead of opening them. */
  readonly refuse?: boolean;
}

/** A WebSocket factory that records every socket it makes. */
export class FakeSockets {
  readonly sockets: FakeSocket[] = [];
  autoOpen: boolean;
  refuse: boolean;

  constructor(options: FakeSocketsOptions = {}) {
    this.autoOpen = options.autoOpen ?? true;
    this.refuse = options.refuse ?? false;
  }

  readonly factory: DhanWebSocketFactory = (url) => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    if (this.refuse) {
      queueMicrotask(() => {
        socket.drop(1006);
      });
    } else if (this.autoOpen) {
      queueMicrotask(() => {
        socket.open();
      });
    }
    return socket;
  };

  last(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) throw new Error("no socket yet");
    return socket;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// REST

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

interface StoredOrder extends Record<string, unknown> {
  orderId: string;
  orderStatus: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A text body streamed in small chunks, so parsers see values split across chunk boundaries. */
export function chunkedResponse(text: string, chunkSize = 37): Response {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + chunkSize));
      at += chunkSize;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/csv" } });
}

/**
 * A stateful Dhan: orders placed are in the order book, modify changes them, cancel cancels them, MARKET orders fill
 * at {@link FakeDhan.fillPrice}, and every change goes to open order-update sockets as an `order_alert`.
 */
export class FakeDhan {
  readonly requests: RecordedRequest[] = [];
  readonly orders = new Map<string, StoredOrder>();
  readonly sockets = new FakeSockets();
  /** Overrides: path → response factory. */
  readonly overrides = new Map<string, (request: RecordedRequest) => Response | Promise<Response>>();
  fillPrice = 1520.5;
  #seq = 0;

  readonly fetch: DhanFetch = async (input, init) => {
    init.signal?.throwIfAborted();
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const request: RecordedRequest = { method: init.method ?? "GET", url: input, headers, body };
    this.requests.push(request);
    const override = this.overrides.get(`${request.method} ${url.pathname}`);
    if (override !== undefined) return await override(request);
    if (input === DHAN_SCRIP_MASTER_URL) return chunkedResponse(fixtureText("scrip-master.csv"));
    if (headers["access-token"] !== TOKEN && headers["access-token"] !== RENEWED_TOKEN) {
      return json(fixture("error-dh901.json"), 401);
    }
    return this.#route(request, url.pathname);
  };

  /** Order-update sockets that logged in. */
  orderSockets(): FakeSocket[] {
    return this.sockets.sockets.filter((socket) => socket.url.startsWith("wss://api-order-update.dhan.co"));
  }

  marketSockets(): FakeSocket[] {
    return this.sockets.sockets.filter((socket) => socket.url.startsWith("wss://api-feed.dhan.co"));
  }

  #route(request: RecordedRequest, path: string): Response {
    const orderPath = /^\/v2\/orders\/([^/]+)$/.exec(path);
    switch (`${request.method} ${orderPath === null ? path : "/v2/orders/:id"}`) {
      case "GET /v2/profile":
        return json(fixture("profile.json"));
      case "GET /v2/RenewToken":
        return json({ ...(fixture("renew-token.json") as object), accessToken: RENEWED_TOKEN });
      case "GET /v2/fundlimit":
        return json(fixture("fundlimit.json"));
      case "GET /v2/orders":
        return json([...this.orders.values()]);
      case "POST /v2/orders":
        return this.#place(request.body as Record<string, unknown>);
      case "GET /v2/orders/:id": {
        const order = this.orders.get(decodeURIComponent(orderPath?.[1] ?? ""));
        return order === undefined ? json(fixture("error-dh907.json"), 400) : json(order);
      }
      case "PUT /v2/orders/:id":
        return this.#modify(decodeURIComponent(orderPath?.[1] ?? ""), request.body as Record<string, unknown>);
      case "DELETE /v2/orders/:id":
        return this.#cancel(decodeURIComponent(orderPath?.[1] ?? ""));
      case "GET /v2/positions":
        return json(fixture("positions.json"));
      case "GET /v2/holdings":
        return json(fixture("holdings.json"));
      case "POST /v2/charts/intraday":
        return json(fixture("charts-intraday.json"));
      case "POST /v2/charts/historical":
        return json(fixture("charts-historical.json"));
      default:
        return json({ errorType: "Input_Exception", errorCode: "DH-905", errorMessage: "Unknown path" }, 400);
    }
  }

  #place(body: Record<string, unknown>): Response {
    this.#seq += 1;
    const orderId = `11211118${String(2000 + this.#seq)}`;
    const market = body.orderType === "MARKET";
    const quantity = Number(body.quantity);
    const order: StoredOrder = {
      ...(fixture("order.json") as Record<string, unknown>),
      dhanClientId: body.dhanClientId,
      orderId,
      correlationId: body.correlationId ?? null,
      orderStatus: market ? "TRADED" : "PENDING",
      transactionType: body.transactionType,
      exchangeSegment: body.exchangeSegment,
      productType: body.productType,
      orderType: body.orderType,
      validity: body.validity,
      tradingSymbol: "HDFCBANK",
      securityId: body.securityId,
      quantity,
      price: body.price,
      triggerPrice: body.triggerPrice,
      createTime: "2025-10-06 09:20:00",
      updateTime: "2025-10-06 09:20:00",
      remainingQuantity: market ? 0 : quantity,
      averageTradedPrice: market ? this.fillPrice : 0,
      filledQty: market ? quantity : 0,
    };
    this.orders.set(orderId, order);
    this.#alert(order);
    return json({ orderId, orderStatus: "PENDING" });
  }

  #modify(orderId: string, body: Record<string, unknown>): Response {
    const order = this.orders.get(orderId);
    if (order === undefined) return json(fixture("error-dh907.json"), 400);
    Object.assign(order, {
      orderType: body.orderType,
      quantity: body.quantity,
      price: body.price,
      triggerPrice: body.triggerPrice,
      validity: body.validity,
      updateTime: "2025-10-06 09:21:00",
    });
    this.#alert(order);
    return json({ orderId, orderStatus: "TRANSIT" });
  }

  #cancel(orderId: string): Response {
    const order = this.orders.get(orderId);
    if (order === undefined) return json(fixture("error-dh907.json"), 400);
    order.orderStatus = "CANCELLED";
    order.updateTime = "2025-10-06 09:22:00";
    this.#alert(order);
    return json({ orderId, orderStatus: "CANCELLED" });
  }

  /** Pushes the order to every open order-update socket in the docs' `order_alert` shape. */
  #alert(order: StoredOrder): void {
    const template = fixture("order-update.json") as { Data: Record<string, unknown>; Type: string };
    const product: Record<string, string> = { CNC: "C", INTRADAY: "I", MARGIN: "M", MTF: "F", CO: "V", BO: "B" };
    const type: Record<string, string> = { LIMIT: "LMT", MARKET: "MKT", STOP_LOSS: "SL", STOP_LOSS_MARKET: "SLM" };
    const message = {
      ...template,
      Data: {
        ...template.Data,
        Exchange: "NSE",
        Segment: "E",
        SecurityId: order.securityId,
        ClientId: order.dhanClientId,
        OrderNo: order.orderId,
        Product: product[String(order.productType)],
        TxnType: order.transactionType === "SELL" ? "S" : "B",
        OrderType: type[String(order.orderType)],
        Validity: order.validity,
        Quantity: order.quantity,
        TradedQty: order.filledQty,
        RemainingQuantity: order.remainingQuantity,
        Price: order.price,
        TriggerPrice: order.triggerPrice,
        TradedPrice: order.averageTradedPrice,
        AvgTradedPrice: order.averageTradedPrice,
        OrderDateTime: order.createTime,
        LastUpdatedTime: order.updateTime,
        Symbol: order.tradingSymbol,
        Status: order.orderStatus.charAt(0) + order.orderStatus.slice(1).toLowerCase(),
        CorrelationId: order.correlationId ?? "",
      },
    };
    for (const socket of this.orderSockets()) if (!socket.closed) socket.receive(JSON.stringify(message));
  }
}
