/**
 * A fake Upstox for tests: the REST endpoints the adapter calls, served from the redacted fixtures (with a stateful
 * order book), and fake sockets for both feeds. No network. Sockets call their handlers asynchronously, as real ones do.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import type { UpstoxSocket, UpstoxSocketFactory, UpstoxSocketHandlers } from "../feed";
import type { UpstoxFetch } from "../http";
import { upstoxFeedResponseType } from "../proto";
import { UPSTOX_URLS } from "../types";

export const VALID_TOKEN = "redacted-access-token";
export const VALID_CODE = "redacted-auth-code";

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name)) as unknown;
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
}

/** A FeedResponse frame from a JSON object (the shape of the docs' decoded samples). */
export function encodeFeed(object: Record<string, unknown>): Uint8Array {
  const type = upstoxFeedResponseType();
  return type.encode(type.fromObject(object)).finish();
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function upstoxErrorBody(code: string, message: string): unknown {
  return { status: "error", errors: [{ errorCode: code, message, propertyPath: null, invalidValue: null }] };
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

export type FakeSocketKind = "market" | "order";

export class FakeSocket implements UpstoxSocket {
  readonly sent: (string | Uint8Array)[] = [];
  /** Upstox key → mode, from the `sub`/`change_mode`/`unsub` requests received (market sockets). */
  readonly subscribed = new Map<string, string>();
  closed = false;
  closeCode: number | undefined;

  constructor(
    readonly kind: FakeSocketKind,
    readonly url: string,
    readonly handlers: UpstoxSocketHandlers,
    open: "open" | "refuse" | "error" | "hang",
  ) {
    queueMicrotask(() => {
      if (open === "open") handlers.onOpen();
      else if (open === "refuse") handlers.onClose(1006, "refused");
      else if (open === "error") handlers.onError(new Error("handshake failed"));
    });
  }

  /** The JSON requests received, decoded from their binary frames. */
  requests(): { guid: string; method: string; data: { mode?: string; instrumentKeys: string[] } }[] {
    return this.sent.map(
      (frame) =>
        JSON.parse(typeof frame === "string" ? frame : new TextDecoder().decode(frame)) as {
          guid: string;
          method: string;
          data: { mode?: string; instrumentKeys: string[] };
        },
    );
  }

  send(data: string | Uint8Array): void {
    if (this.closed) throw new Error("send on a closed socket");
    this.sent.push(data);
    if (this.kind !== "market" || typeof data === "string") return;
    const request = JSON.parse(new TextDecoder().decode(data)) as {
      method: string;
      data: { mode?: string; instrumentKeys: string[] };
    };
    for (const key of request.data.instrumentKeys) {
      if (request.method === "unsub") this.subscribed.delete(key);
      else this.subscribed.set(key, request.data.mode ?? "ltpc");
    }
  }

  close(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code;
    queueMicrotask(() => {
      this.handlers.onClose(code ?? 1005, "");
    });
  }

  /** Server → client frame. */
  push(data: string | Uint8Array | ArrayBuffer): void {
    if (!this.closed) this.handlers.onMessage(data);
  }

  /** The server drops the connection. */
  drop(code = 1006): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose(code, "dropped");
  }
}

interface OrderRow extends Record<string, unknown> {
  order_id: string;
  instrument_token: string;
  status: string;
}

export interface FakeUpstoxOptions {
  /** How new sockets behave (default: they open). */
  readonly socketOpen?: () => "open" | "refuse" | "error" | "hang";
}

export class FakeUpstox {
  readonly requests: RecordedRequest[] = [];
  readonly sockets: FakeSocket[] = [];
  readonly orders: OrderRow[] = [];
  /** Per path: a response that replaces the next answer (then is consumed). */
  readonly overrides = new Map<string, Response[]>();
  validToken = VALID_TOKEN;
  #seq = 0;
  readonly #options: FakeUpstoxOptions;

  constructor(options: FakeUpstoxOptions = {}) {
    this.#options = options;
    const book = fixture("order-book.json") as { data: OrderRow[] };
    this.orders.push(...book.data.map((row) => ({ ...row })));
  }

  /** A copy of the documented order book row. */
  firstOrder(): OrderRow {
    const row = (fixture("order-book.json") as { data: OrderRow[] }).data[0];
    if (row === undefined) throw new Error("The order book fixture is empty");
    return { ...row };
  }

  /** Queue an answer for the next request to `pathname`. */
  respond(pathname: string, response: Response): void {
    const queue = this.overrides.get(pathname) ?? [];
    queue.push(response);
    this.overrides.set(pathname, queue);
  }

  marketSockets(): FakeSocket[] {
    return this.sockets.filter((socket) => socket.kind === "market");
  }

  orderSockets(): FakeSocket[] {
    return this.sockets.filter((socket) => socket.kind === "order");
  }

  /** The newest open market socket. */
  market(): FakeSocket {
    const socket = this.marketSockets()
      .filter((candidate) => !candidate.closed)
      .at(-1);
    if (socket === undefined) throw new Error("No open market socket");
    return socket;
  }

  /** Sends an LTPC frame for `token` to every market socket subscribed to it. */
  emitLtpc(token: string, ltp: number): void {
    const frame = encodeFeed({
      type: "live_feed",
      feeds: { [token]: { ltpc: { ltp, ltt: 1_740_729_552_723, ltq: 75, cp: 494.05 } } },
      currentTs: 1_740_729_566_039,
    });
    for (const socket of this.marketSockets()) if (socket.subscribed.has(token)) socket.push(frame);
  }

  readonly webSocket: UpstoxSocketFactory = (url, handlers) => {
    const kind: FakeSocketKind = url.includes("/market") ? "market" : "order";
    const socket = new FakeSocket(kind, url, handlers, this.#options.socketOpen?.() ?? "open");
    this.sockets.push(socket);
    return socket;
  };

  readonly fetch: UpstoxFetch = (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === "string" ? init.body : undefined;
    this.requests.push({ method: init.method ?? "GET", url, headers, body });
    if (init.signal?.aborted === true) return Promise.reject(init.signal.reason as Error);
    return Promise.resolve(this.#route(new URL(url), init.method ?? "GET", headers, body));
  };

  #route(url: URL, method: string, headers: Record<string, string>, body: string | undefined): Response {
    const override = this.overrides.get(url.pathname)?.shift();
    if (override !== undefined) return override;
    const full = url.origin + url.pathname;
    if (full === UPSTOX_URLS.instrumentMaster) return new Response(gzipSync(fixtureText("instruments.json")));
    if (full === UPSTOX_URLS.token) return this.#token(body);
    if (headers.Authorization !== `Bearer ${this.validToken}`) {
      return json(fixture("error-invalid-token.json"), 401);
    }
    switch (`${method} ${full}`) {
      case `GET ${UPSTOX_URLS.profile}`:
        return json(fixture("profile.json"));
      case `GET ${UPSTOX_URLS.funds}`:
        return json(fixture("funds.json"));
      case `GET ${UPSTOX_URLS.orderBook}`:
        return json({ status: "success", data: this.orders });
      case `GET ${UPSTOX_URLS.positions}`:
        return json(fixture("positions.json"));
      case `GET ${UPSTOX_URLS.holdings}`:
        return json(fixture("holdings.json"));
      case `POST ${UPSTOX_URLS.placeOrder}`:
        return this.#place(JSON.parse(body ?? "{}") as Record<string, unknown>);
      case `PUT ${UPSTOX_URLS.modifyOrder}`:
        return this.#modify(JSON.parse(body ?? "{}") as Record<string, unknown>);
      case `DELETE ${UPSTOX_URLS.cancelOrder}`:
        return this.#cancel(url.searchParams.get("order_id") ?? "");
      case `GET ${UPSTOX_URLS.marketFeedAuthorize}`:
        return json(this.#authorized("market"));
      case `GET ${UPSTOX_URLS.portfolioFeedAuthorize}`:
        return json(this.#authorized("portfolio"));
      default:
        if (full.startsWith(`${UPSTOX_URLS.intradayCandles}/`)) return json(fixture("candles-intraday.json"));
        if (full.startsWith(`${UPSTOX_URLS.historicalCandles}/`)) return json(fixture("candles-historical.json"));
        return json(upstoxErrorBody("UDAPI10000", "Request not supported"), 404);
    }
  }

  #authorized(kind: "market" | "portfolio"): unknown {
    this.#seq += 1;
    return {
      status: "success",
      data: { authorized_redirect_uri: `wss://fake.upstox.test/${kind}?code=single-use-${String(this.#seq)}` },
    };
  }

  #token(body: string | undefined): Response {
    const form = new URLSearchParams(body ?? "");
    if (form.get("code") !== VALID_CODE || form.get("grant_type") !== "authorization_code") {
      return json(upstoxErrorBody("UDAPI100057", "Invalid authorization code"), 400);
    }
    return json(fixture("token.json"));
  }

  #place(order: Record<string, unknown>): Response {
    this.#seq += 1;
    const orderId = `25100600000${String(this.#seq)}`;
    const market = order.order_type === "MARKET";
    const row: OrderRow = {
      ...(fixture("order-update.json") as Record<string, unknown>),
      ...order,
      instrument_token: String(order.instrument_token),
      instrument_key: String(order.instrument_token),
      order_id: orderId,
      status: market ? "complete" : "open",
      filled_quantity: market ? order.quantity : 0,
      pending_quantity: market ? 0 : order.quantity,
      average_price: market ? 219.3 : 0,
      order_timestamp: "2025-10-06 09:30:00",
      exchange_timestamp: "2025-10-06 09:30:00",
    };
    delete row.update_type;
    delete row.user_id;
    delete row.userId;
    delete row.instrument_key;
    this.orders.push(row);
    this.#publish(row);
    return json({ status: "success", data: { order_id: orderId } });
  }

  #modify(change: Record<string, unknown>): Response {
    const row = this.orders.find((candidate) => candidate.order_id === change.order_id);
    if (row === undefined) return json(fixture("error-order-not-found.json"), 400);
    Object.assign(row, change, { status: "open" });
    this.#publish(row);
    return json({ status: "success", data: { order_id: row.order_id } });
  }

  #cancel(orderId: string): Response {
    const row = this.orders.find((candidate) => candidate.order_id === orderId);
    if (row === undefined) return json(fixture("error-order-not-found.json"), 400);
    row.status = "cancelled";
    this.#publish(row);
    return json({ status: "success", data: { order_id: orderId } });
  }

  #publish(row: OrderRow): void {
    const update = JSON.stringify({
      ...row,
      update_type: "order",
      user_id: "******",
      userId: "******",
      instrument_key: row.instrument_token,
    });
    for (const socket of this.orderSockets()) socket.push(update);
  }
}
