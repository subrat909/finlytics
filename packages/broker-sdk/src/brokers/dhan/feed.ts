/**
 * Dhan's two WebSockets (operation 12): the live market feed (binary, little-endian packets) and the live order
 * update feed (JSON). Both reconnect by themselves with exponential backoff + jitter, watch for silence (heartbeat),
 * and restore their state after a reconnect: the market feed re-subscribes every key it holds, the order feed logs in
 * again.
 *
 * Market feed quirks (live-market-feed, annexure):
 * - Subscribe with JSON `{RequestCode, InstrumentCount, InstrumentList}`, ≤ 100 instruments per message, ≤ 5000 per
 *   connection. Ticker 15, quote 17, full 21; unsubscribe is the same code + 1. A mode change unsubscribes the old mode.
 * - One instrument's data arrives as several packets: ticker/quote/full carry the trade, OI (5) and prev close (6)
 *   arrive on their own. The feed keeps the last LTP, OI and prev close per key and merges them into every tick.
 * - Prices are float32: rounded to 2 decimals (4 for currency segments) before they become decimal strings.
 * - LTT is epoch seconds. A value more than a minute in the future is IST wall-clock time and is shifted by 5:30.
 * - The server pings every 10 s and the WebSocket answers by itself; the client-side heartbeat is a silence watchdog:
 *   no message for `staleAfterMs` → `degraded`; for `reconnectAfterSilenceMs` (off by default: markets close) → reconnect.
 * - The token travels in the URL query (Dhan's design): never log the URL.
 */
import type { InstrumentKey } from "@finlytics/shared";
import { toDecimalString } from "@finlytics/shared";

import {
  BrokerNotFoundError,
  BrokerUnavailableError,
  isBrokerError,
  NeedsReloginError,
  RateLimitedError,
} from "../../errors";
import { backoffDelayMs } from "../../feed/backoff";
import type { BackoffOptions } from "../../feed/backoff";
import { TypedEmitter } from "../../feed/emitter";
import type { Unsubscribe } from "../../feed/emitter";
import type { FeedStatus, MarketFeed, MarketFeedEvents, OrderFeed, OrderFeedEvents } from "../../feed/feed";
import { FeedSubscriptions } from "../../feed/subscriptions";
import type { DepthLevel, FeedMode, Tick } from "../../models";
import { abortReason } from "../../timeout";

import { segmentFromCode } from "./instruments";
import type { DhanInstrumentMap, DhanInstrumentRef } from "./instruments";
import { alertToOrder, alertToTrade } from "./mappers";
import {
  DHAN_DATA_ERRORS,
  DHAN_EXCHANGE_SEGMENT_CODES,
  DHAN_FEED_MAX_INSTRUMENTS,
  DHAN_FEED_MAX_PER_MESSAGE,
  DHAN_FEED_REQUEST,
  DHAN_FEED_RESPONSE,
  DHAN_PACKET,
  DhanOrderAlertDataSchema,
  DhanOrderUpdateMessageSchema,
} from "./types";
import type { DhanFeedRequest, DhanOrderUpdateLogin } from "./types";

const BROKER = "DHAN" as const;
const IST_OFFSET_SEC = 19_800;

// ---------------------------------------------------------------------------------------------------------------------
// Socket abstraction (Node's global WebSocket satisfies it; tests inject a fake)

/** The part of a WHATWG WebSocket the feeds use. */
export interface DhanSocket {
  binaryType: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: unknown) => void): void;
}

export type DhanWebSocketFactory = (url: string) => DhanSocket;

/** Node 24's native WebSocket. */
export const nativeWebSocket: DhanWebSocketFactory = (url) => new WebSocket(url);

export interface DhanFeedOptions {
  readonly backoff?: BackoffOptions | undefined;
  /** No message for this long while subscribed → `degraded` (default 60 s). */
  readonly staleAfterMs?: number | undefined;
  /** No message for this long → reconnect (default 0: off, since nothing arrives while markets are closed). */
  readonly reconnectAfterSilenceMs?: number | undefined;
  /** A connection that lasted this long resets the backoff (default 10 s). */
  readonly stableAfterMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

interface ReconnectingSocketHooks {
  readonly onOpen: (send: (text: string) => void) => void;
  readonly onMessage: (data: unknown) => void;
  readonly onStatus: (status: FeedStatus) => void;
  readonly onError: (error: unknown) => void;
  /** Whether silence means trouble right now (the market feed: only with subscriptions). */
  readonly expectsTraffic: () => boolean;
}

/** One logical connection that survives socket drops. */
class ReconnectingSocket {
  #socket: DhanSocket | undefined;
  #open = false;
  #closed = false;
  #attempt = 0;
  #openedAt = 0;
  #lastMessageAt = 0;
  #degraded = false;
  #retryTimer: NodeJS.Timeout | undefined;
  #watchdog: NodeJS.Timeout | undefined;
  readonly #now: () => number;

  constructor(
    private readonly url: string,
    private readonly factory: DhanWebSocketFactory,
    private readonly options: DhanFeedOptions,
    private readonly hooks: ReconnectingSocketHooks,
  ) {
    this.#now = options.now ?? Date.now;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** First connection: resolves when it opens; rejects when it fails or the signal aborts (nothing is retried then). */
  start(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        this.close();
        reject(abortReason(signal));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      this.#connect((error) => {
        signal.removeEventListener("abort", onAbort);
        if (error === undefined) {
          this.#startWatchdog();
          resolve();
        } else {
          this.close();
          reject(error);
        }
      });
    });
  }

  send(text: string): boolean {
    if (!this.#open || this.#socket === undefined) return false;
    this.#socket.send(text);
    return true;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#open = false;
    clearTimeout(this.#retryTimer);
    clearInterval(this.#watchdog);
    const socket = this.#socket;
    this.#socket = undefined;
    try {
      socket?.close(1000, "closed");
    } catch {
      // Already closing.
    }
  }

  /** Opens a socket; `first` (only for the first connection) learns whether it opened. */
  #connect(first?: (error?: Error) => void): void {
    this.hooks.onStatus("connecting");
    let socket: DhanSocket;
    try {
      socket = this.factory(this.url);
      socket.binaryType = "arraybuffer";
    } catch {
      const error = new BrokerUnavailableError("Could not open the Dhan WebSocket", { broker: BROKER });
      if (first !== undefined) first(error);
      else this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    let opened = false;
    socket.addEventListener("open", () => {
      if (this.#socket !== socket || this.#closed) return;
      opened = true;
      this.#open = true;
      this.#openedAt = this.#now();
      this.#lastMessageAt = this.#openedAt;
      this.#degraded = false;
      try {
        this.hooks.onOpen((text) => {
          socket.send(text);
        });
      } catch (error: unknown) {
        this.hooks.onError(error);
      }
      this.hooks.onStatus("up");
      first?.();
    });
    socket.addEventListener("message", (event) => {
      if (this.#socket !== socket || this.#closed) return;
      this.#lastMessageAt = this.#now();
      if (this.#degraded) {
        this.#degraded = false;
        this.hooks.onStatus("up");
      }
      this.hooks.onMessage((event as { data?: unknown }).data);
    });
    socket.addEventListener("error", () => {
      // The close event follows; the event itself may carry the URL (and so the token): never forward it.
    });
    socket.addEventListener("close", (event) => {
      if (this.#socket !== socket || this.#closed) return;
      this.#socket = undefined;
      this.#open = false;
      const code = (event as { code?: unknown }).code;
      if (!opened && first !== undefined) {
        first(
          new BrokerUnavailableError("The Dhan WebSocket did not open", {
            broker: BROKER,
            brokerError: { code: `WS_${typeof code === "number" ? String(code) : "CLOSED"}` },
          }),
        );
        return;
      }
      if (this.#now() - this.#openedAt >= (this.options.stableAfterMs ?? 10_000)) this.#attempt = 0;
      this.hooks.onStatus("down");
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    if (this.#closed) return;
    this.#attempt += 1;
    const delay = backoffDelayMs(this.#attempt, this.options.backoff);
    this.#retryTimer = setTimeout(() => {
      if (!this.#closed) this.#connect();
    }, delay);
    this.#retryTimer.unref();
  }

  #startWatchdog(): void {
    const staleMs = this.options.staleAfterMs ?? 60_000;
    const deadMs = this.options.reconnectAfterSilenceMs ?? 0;
    const everyMs = Math.max(1_000, Math.min(staleMs, deadMs > 0 ? deadMs : staleMs) / 4);
    this.#watchdog = setInterval(() => {
      if (!this.#open || this.#socket === undefined) return;
      const silentMs = this.#now() - this.#lastMessageAt;
      if (deadMs > 0 && silentMs >= deadMs) {
        // Half-open connection: drop it; the close handler reconnects.
        const socket = this.#socket;
        this.#socket = undefined;
        this.#open = false;
        try {
          socket.close(4000, "silent");
        } catch {
          // Ignore: the socket is being replaced.
        }
        this.hooks.onStatus("down");
        this.#scheduleReconnect();
        return;
      }
      if (!this.#degraded && silentMs >= staleMs && this.hooks.expectsTraffic()) {
        this.#degraded = true;
        this.hooks.onStatus("degraded");
      }
    }, everyMs);
    this.#watchdog.unref();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Binary packets

export interface DhanDepthLevel {
  readonly bidQty: number;
  readonly askQty: number;
  readonly bidOrders: number;
  readonly askOrders: number;
  readonly bid: number;
  readonly ask: number;
}

interface PacketHeader {
  readonly segment: number;
  readonly securityId: number;
}

/** A decoded feed packet (numbers as sent; prices still float32). */
export type DhanPacket =
  | (PacketHeader & { readonly kind: "ticker"; readonly ltp: number; readonly ltt: number })
  | (PacketHeader & {
      readonly kind: "quote" | "full";
      readonly ltp: number;
      readonly ltq: number;
      readonly ltt: number;
      readonly atp: number;
      readonly volume: number;
      readonly totalSellQty: number;
      readonly totalBuyQty: number;
      readonly open: number;
      readonly close: number;
      readonly high: number;
      readonly low: number;
      readonly oi?: number;
      readonly depth?: readonly DhanDepthLevel[];
    })
  | (PacketHeader & { readonly kind: "oi"; readonly oi: number })
  | (PacketHeader & { readonly kind: "prevClose"; readonly prevClose: number; readonly prevOi: number })
  | (PacketHeader & { readonly kind: "status" })
  | (PacketHeader & { readonly kind: "disconnect"; readonly code: number });

const PACKET_SIZES: ReadonlyMap<number, number> = new Map([
  [DHAN_FEED_RESPONSE.INDEX, DHAN_PACKET.TICKER_BYTES],
  [DHAN_FEED_RESPONSE.TICKER, DHAN_PACKET.TICKER_BYTES],
  [DHAN_FEED_RESPONSE.QUOTE, DHAN_PACKET.QUOTE_BYTES],
  [DHAN_FEED_RESPONSE.OI, DHAN_PACKET.OI_BYTES],
  [DHAN_FEED_RESPONSE.PREV_CLOSE, DHAN_PACKET.TICKER_BYTES],
  [DHAN_FEED_RESPONSE.MARKET_STATUS, DHAN_PACKET.HEADER_BYTES],
  [DHAN_FEED_RESPONSE.FULL, DHAN_PACKET.FULL_BYTES],
  [DHAN_FEED_RESPONSE.DISCONNECT, DHAN_PACKET.DISCONNECT_BYTES],
]);

function parsePacket(view: DataView, at: number, code: number): DhanPacket | undefined {
  const header: PacketHeader = { segment: view.getUint8(at + 3), securityId: view.getUint32(at + 4, true) };
  const f32 = (offset: number): number => view.getFloat32(at + offset, true);
  const u32 = (offset: number): number => view.getUint32(at + offset, true);
  const u16 = (offset: number): number => view.getUint16(at + offset, true);
  switch (code) {
    case DHAN_FEED_RESPONSE.INDEX:
    case DHAN_FEED_RESPONSE.TICKER:
      return { ...header, kind: "ticker", ltp: f32(8), ltt: u32(12) };
    case DHAN_FEED_RESPONSE.OI:
      return { ...header, kind: "oi", oi: u32(8) };
    case DHAN_FEED_RESPONSE.PREV_CLOSE:
      return { ...header, kind: "prevClose", prevClose: f32(8), prevOi: u32(12) };
    case DHAN_FEED_RESPONSE.MARKET_STATUS:
      return { ...header, kind: "status" };
    case DHAN_FEED_RESPONSE.DISCONNECT:
      return { ...header, kind: "disconnect", code: u16(8) };
    case DHAN_FEED_RESPONSE.QUOTE:
      return {
        ...header,
        kind: "quote",
        ltp: f32(8),
        ltq: u16(12),
        ltt: u32(14),
        atp: f32(18),
        volume: u32(22),
        totalSellQty: u32(26),
        totalBuyQty: u32(30),
        open: f32(34),
        close: f32(38),
        high: f32(42),
        low: f32(46),
      };
    case DHAN_FEED_RESPONSE.FULL: {
      const depth: DhanDepthLevel[] = [];
      for (let level = 0; level < DHAN_PACKET.DEPTH_LEVELS; level += 1) {
        const base = DHAN_PACKET.FULL_DEPTH_OFFSET + level * DHAN_PACKET.DEPTH_LEVEL_BYTES;
        depth.push({
          bidQty: u32(base),
          askQty: u32(base + 4),
          bidOrders: u16(base + 8),
          askOrders: u16(base + 10),
          bid: f32(base + 12),
          ask: f32(base + 16),
        });
      }
      return {
        ...header,
        kind: "full",
        ltp: f32(8),
        ltq: u16(12),
        ltt: u32(14),
        atp: f32(18),
        volume: u32(22),
        totalSellQty: u32(26),
        totalBuyQty: u32(30),
        oi: u32(34),
        open: f32(46),
        close: f32(50),
        high: f32(54),
        low: f32(58),
        depth,
      };
    }
    /* v8 ignore next 2 -- only codes with a known size reach here */
    default:
      return undefined;
  }
}

/**
 * Decodes every packet in one WebSocket message. Known packets have fixed sizes (the docs' layouts), so a message
 * holding several is split by those sizes; an unknown code is skipped by its header length, and a truncated packet
 * ends the message.
 */
export function parseDhanPackets(data: ArrayBuffer | ArrayBufferView): DhanPacket[] {
  const view = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
  const packets: DhanPacket[] = [];
  let at = 0;
  while (at + DHAN_PACKET.HEADER_BYTES <= view.byteLength) {
    const code = view.getUint8(at);
    const size = PACKET_SIZES.get(code);
    if (size === undefined) {
      const length = view.getUint16(at + 1, true);
      if (length < DHAN_PACKET.HEADER_BYTES) break;
      at += length;
      continue;
    }
    if (at + size > view.byteLength) break;
    const packet = parsePacket(view, at, code);
    if (packet !== undefined) packets.push(packet);
    at += size;
  }
  return packets;
}

/** A float32 feed price as a decimal string: 4 decimals for currency segments, 2 otherwise. */
export function feedPrice(value: number, segment: number): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const currency =
    segment === DHAN_EXCHANGE_SEGMENT_CODES.NSE_CURRENCY || segment === DHAN_EXCHANGE_SEGMENT_CODES.BSE_CURRENCY;
  return toDecimalString(value.toFixed(currency ? 4 : 2));
}

/** LTT (epoch seconds) → epoch ms. Future-dated by more than a minute → IST wall clock, shifted by 5:30. */
export function feedTime(ltt: number, nowMs: number): number {
  if (ltt <= 0) return nowMs;
  const ms = ltt * 1000;
  return ms > nowMs + 60_000 ? ms - IST_OFFSET_SEC * 1000 : ms;
}

/** The disconnect packet's code → a typed error (807–810: token; 805: too many connections). */
export function disconnectError(code: number): Error {
  const text = (DHAN_DATA_ERRORS as Readonly<Record<number, string>>)[code];
  const options = {
    broker: BROKER,
    brokerError: { code: String(code), ...(text === undefined ? {} : { message: text }) },
  };
  if (code >= 807 && code <= 810)
    return new NeedsReloginError("Dhan closed the feed: the session is not valid", options);
  if (code === 805) return new RateLimitedError("Dhan closed the feed: too many connections", options);
  return new BrokerUnavailableError("Dhan closed the feed", options);
}

// ---------------------------------------------------------------------------------------------------------------------
// Market feed

interface QuoteState {
  ltp?: string | undefined;
  ts?: number | undefined;
  close?: string | undefined;
  oi?: number | undefined;
}

const SUBSCRIBE_CODES: Readonly<Record<FeedMode, number>> = Object.freeze({
  ltp: DHAN_FEED_REQUEST.SUBSCRIBE_TICKER,
  quote: DHAN_FEED_REQUEST.SUBSCRIBE_QUOTE,
  full: DHAN_FEED_REQUEST.SUBSCRIBE_FULL,
});

export interface DhanMarketFeedInit {
  readonly url: string;
  readonly factory: DhanWebSocketFactory;
  readonly instruments: DhanInstrumentMap;
  readonly options?: DhanFeedOptions | undefined;
}

export class DhanMarketFeed implements MarketFeed {
  readonly #events = new TypedEmitter<MarketFeedEvents>();
  readonly #subscriptions = new FeedSubscriptions(DHAN_FEED_MAX_INSTRUMENTS, { broker: BROKER });
  readonly #state = new Map<InstrumentKey, QuoteState>();
  readonly #instruments: DhanInstrumentMap;
  readonly #socket: ReconnectingSocket;
  readonly #now: () => number;
  #status: FeedStatus = "connecting";

  constructor(init: DhanMarketFeedInit) {
    this.#instruments = init.instruments;
    this.#now = init.options?.now ?? Date.now;
    this.#socket = new ReconnectingSocket(init.url, init.factory, init.options ?? {}, {
      onOpen: (send) => {
        for (const [mode, keys] of this.#subscriptions.byMode()) {
          for (const message of this.#requests(SUBSCRIBE_CODES[mode], keys)) send(message);
        }
      },
      onMessage: (data) => {
        this.#onMessage(data);
      },
      onStatus: (status) => {
        this.#setStatus(status);
      },
      onError: (error) => {
        this.#events.emit("error", error);
      },
      expectsTraffic: () => this.#subscriptions.size > 0,
    });
  }

  get status(): FeedStatus {
    return this.#status;
  }

  /** Opens the first connection (the adapter awaits it). */
  start(signal: AbortSignal): Promise<void> {
    return this.#socket.start(signal);
  }

  /**
   * @throws {BrokerNotFoundError} when a key isn't in the Dhan instrument map (nothing is subscribed then).
   * @throws {BrokerRejectedError} beyond 5000 instruments.
   */
  subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    this.#assertOpen();
    const unknown = keys.filter((key) => this.#instruments.get(key) === undefined);
    if (unknown.length > 0) {
      return Promise.reject(
        new BrokerNotFoundError(`${String(unknown.length)} instrument(s) unknown to Dhan; sync the instrument master`, {
          broker: BROKER,
        }),
      );
    }
    const before = this.#subscriptions.snapshot();
    const changed = this.#subscriptions.add(keys, mode);
    const previous = new Map<FeedMode, InstrumentKey[]>();
    for (const key of changed) {
      const old = before.get(key);
      if (old !== undefined) previous.set(old, [...(previous.get(old) ?? []), key]);
    }
    for (const [old, oldKeys] of previous) this.#send(SUBSCRIBE_CODES[old] + 1, oldKeys);
    this.#send(SUBSCRIBE_CODES[mode], changed);
    return Promise.resolve();
  }

  /** Unknown keys, and calls on a closed feed, are no-ops. */
  unsubscribe(keys: readonly InstrumentKey[]): Promise<void> {
    const before = this.#subscriptions.snapshot();
    const removed = this.#subscriptions.remove(keys);
    const byMode = new Map<FeedMode, InstrumentKey[]>();
    for (const key of removed) {
      const mode = before.get(key);
      /* v8 ignore next -- removed keys were in the snapshot */
      if (mode === undefined) continue;
      byMode.set(mode, [...(byMode.get(mode) ?? []), key]);
      this.#state.delete(key);
    }
    for (const [mode, modeKeys] of byMode) this.#send(SUBSCRIBE_CODES[mode] + 1, modeKeys);
    return Promise.resolve();
  }

  subscriptions(): ReadonlyMap<InstrumentKey, FeedMode> {
    return this.#subscriptions.snapshot();
  }

  on<E extends keyof MarketFeedEvents>(event: E, listener: (payload: MarketFeedEvents[E]) => void): Unsubscribe {
    return this.#events.on(event, listener);
  }

  close(): Promise<void> {
    if (this.#status !== "closed") {
      this.#socket.send(JSON.stringify({ RequestCode: DHAN_FEED_REQUEST.DISCONNECT }));
      this.#socket.close();
      this.#subscriptions.clear();
      this.#state.clear();
      this.#status = "closed";
      this.#events.emit("status", "closed");
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }

  #assertOpen(): void {
    if (this.#status === "closed") throw new BrokerUnavailableError("The feed is closed", { broker: BROKER });
  }

  #setStatus(status: FeedStatus): void {
    if (this.#status === "closed" || this.#status === status) return;
    this.#status = status;
    this.#events.emit("status", status);
  }

  /** JSON requests for `keys`, ≤ 100 instruments each. */
  #requests(code: number, keys: readonly InstrumentKey[]): string[] {
    const list = keys.flatMap((key) => {
      const ref: DhanInstrumentRef | undefined = this.#instruments.get(key);
      return ref === undefined ? [] : [{ ExchangeSegment: ref.exchangeSegment, SecurityId: ref.securityId }];
    });
    const messages: string[] = [];
    for (let start = 0; start < list.length; start += DHAN_FEED_MAX_PER_MESSAGE) {
      const batch = list.slice(start, start + DHAN_FEED_MAX_PER_MESSAGE);
      const request: DhanFeedRequest = { RequestCode: code, InstrumentCount: batch.length, InstrumentList: batch };
      messages.push(JSON.stringify(request));
    }
    return messages;
  }

  /** Sends now when connected; otherwise the reconnect re-subscribes from the key set. */
  #send(code: number, keys: readonly InstrumentKey[]): void {
    if (keys.length === 0) return;
    for (const message of this.#requests(code, keys)) this.#socket.send(message);
  }

  #onMessage(data: unknown): void {
    if (typeof data === "string") return; // Dhan's feed is binary; text frames carry nothing we use.
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return;
    let packets: DhanPacket[];
    try {
      packets = parseDhanPackets(data);
    } catch (error: unknown) {
      /* v8 ignore next 2 -- the parser checks every bound; this guards a DataView RangeError all the same */
      this.#events.emit("error", error);
      return;
    }
    for (const packet of packets) this.#onPacket(packet);
  }

  #onPacket(packet: DhanPacket): void {
    if (packet.kind === "disconnect") {
      this.#events.emit("error", disconnectError(packet.code));
      return;
    }
    if (packet.kind === "status") return;
    const segment = segmentFromCode(packet.segment);
    const key = segment === undefined ? undefined : this.#instruments.keyOf(segment, String(packet.securityId));
    if (key === undefined || !this.#subscriptions.has(key)) return;
    let state = this.#state.get(key);
    if (state === undefined) {
      state = {};
      this.#state.set(key, state);
    }
    const now = this.#now();
    const price = (value: number): string | undefined => feedPrice(value, packet.segment);
    let extra: Partial<Tick> = {};
    switch (packet.kind) {
      case "oi":
        state.oi = packet.oi;
        break;
      case "prevClose": {
        const close = price(packet.prevClose);
        if (close !== undefined && close !== "0") state.close = close;
        break;
      }
      case "ticker":
        state.ltp = price(packet.ltp) ?? state.ltp;
        state.ts = feedTime(packet.ltt, now);
        break;
      case "quote":
      case "full": {
        state.ltp = price(packet.ltp) ?? state.ltp;
        state.ts = feedTime(packet.ltt, now);
        if (packet.oi !== undefined) state.oi = packet.oi;
        extra = this.#quoteFields(packet, price);
        break;
      }
    }
    if (state.ltp === undefined) return;
    this.#events.emit("tick", {
      instrumentKey: key,
      ltp: state.ltp,
      ts: state.ts ?? now,
      ...(state.close === undefined ? {} : { close: state.close }),
      ...(state.oi === undefined || state.oi === 0 ? {} : { oi: state.oi }),
      ...extra,
    });
  }

  #quoteFields(
    packet: Extract<DhanPacket, { kind: "quote" | "full" }>,
    price: (value: number) => string | undefined,
  ): Partial<Tick> {
    const fields: Record<string, unknown> = {
      ltq: packet.ltq,
      volume: packet.volume,
      open: price(packet.open),
      high: price(packet.high),
      low: price(packet.low),
      atp: price(packet.atp),
    };
    const depth = packet.depth;
    if (depth !== undefined) {
      const bids: DepthLevel[] = [];
      const asks: DepthLevel[] = [];
      for (const level of depth) {
        const bid = price(level.bid);
        const ask = price(level.ask);
        if (bid !== undefined && level.bidQty > 0)
          bids.push({ price: bid, qty: level.bidQty, orders: level.bidOrders });
        if (ask !== undefined && level.askQty > 0)
          asks.push({ price: ask, qty: level.askQty, orders: level.askOrders });
      }
      fields.depth = { bids, asks };
      fields.bid = bids[0]?.price;
      fields.bidQty = bids[0]?.qty;
      fields.ask = asks[0]?.price;
      fields.askQty = asks[0]?.qty;
    }
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Order feed

export interface DhanOrderFeedInit {
  readonly url: string;
  readonly factory: DhanWebSocketFactory;
  readonly instruments: DhanInstrumentMap;
  readonly login: DhanOrderUpdateLogin;
  readonly now: () => Date;
  readonly options?: DhanFeedOptions | undefined;
}

export class DhanOrderFeed implements OrderFeed {
  readonly #events = new TypedEmitter<OrderFeedEvents>();
  readonly #socket: ReconnectingSocket;
  readonly #filled = new Map<string, number>();
  readonly #instruments: DhanInstrumentMap;
  readonly #now: () => Date;
  #status: FeedStatus = "connecting";

  constructor(init: DhanOrderFeedInit) {
    this.#instruments = init.instruments;
    this.#now = init.now;
    const login = JSON.stringify(init.login);
    this.#socket = new ReconnectingSocket(init.url, init.factory, init.options ?? {}, {
      onOpen: (send) => {
        send(login);
      },
      onMessage: (data) => {
        this.#onMessage(data);
      },
      onStatus: (status) => {
        if (this.#status !== "closed" && this.#status !== status) {
          this.#status = status;
          this.#events.emit("status", status);
        }
      },
      onError: (error) => {
        this.#events.emit("error", error);
      },
      // No orders, no messages: silence is normal on the order feed.
      expectsTraffic: () => false,
    });
  }

  get status(): FeedStatus {
    return this.#status;
  }

  start(signal: AbortSignal): Promise<void> {
    return this.#socket.start(signal);
  }

  on<E extends keyof OrderFeedEvents>(event: E, listener: (payload: OrderFeedEvents[E]) => void): Unsubscribe {
    return this.#events.on(event, listener);
  }

  close(): Promise<void> {
    if (this.#status !== "closed") {
      this.#socket.close();
      this.#filled.clear();
      this.#status = "closed";
      this.#events.emit("status", "closed");
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }

  #onMessage(data: unknown): void {
    const text =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer
          ? new TextDecoder().decode(data)
          : ArrayBuffer.isView(data)
            ? new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
            : undefined;
    if (text === undefined) return;
    try {
      const message = DhanOrderUpdateMessageSchema.safeParse(JSON.parse(text));
      if (!message.success || message.data.Type !== "order_alert") return;
      const alert = DhanOrderAlertDataSchema.parse(message.data.Data);
      const order = alertToOrder(this.#instruments, alert, this.#now);
      const previous = this.#filled.get(order.brokerOrderId) ?? 0;
      this.#filled.set(order.brokerOrderId, Math.max(previous, order.filledQty));
      const brokerClientId = alert.ClientId ?? undefined;
      this.#events.emit("order", { brokerClientId, order });
      const trade = alertToTrade(order, alert, previous);
      if (trade !== undefined) this.#events.emit("trade", { brokerClientId, trade });
    } catch (error: unknown) {
      this.#events.emit(
        "error",
        isBrokerError(error)
          ? error
          : new BrokerUnavailableError("Unreadable Dhan order update", {
              broker: BROKER,
              brokerError: { code: "UNEXPECTED_MESSAGE" },
            }),
      );
    }
  }
}
