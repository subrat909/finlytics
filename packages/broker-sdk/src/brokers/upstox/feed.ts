/**
 * Upstox feeds (operation 12): the V3 market data feed (protobuf) and the portfolio stream (JSON order updates).
 *
 * Both connect the same way: a REST authorize call returns a single-use `wss://` URL, then the socket opens. A lost
 * socket is re-authorized and reopened with exponential backoff and jitter ({@link backoffDelayMs}); the market feed
 * then re-subscribes every key it holds (`subscriptions()`, which the api keeps equal to its ref-counted Redis set).
 * When re-authorizing says the token is no longer valid (NEEDS_RELOGIN) the feed stops retrying, stays `down` and
 * emits the error: the api must reconnect with a fresh token.
 *
 * Heartbeat: Upstox pings and the runtime answers, but a browser-style WebSocket can't see pings, so the market feed
 * watches its own traffic. Silent for `heartbeatMs` while a market segment is open (from `market_info`), or for
 * `quietHeartbeatMs` while all are closed, it re-sends a `sub` for one held key (Upstox answers with a snapshot) and
 * reports `degraded`; no answer within `heartbeatMs` more → reconnect. With nothing subscribed silence is normal. The
 * portfolio stream has nothing to probe: it relies on close events, and the api's 60 s order book reconcile covers gaps.
 */
import type { InstrumentKey } from "@finlytics/shared";

import { BrokerInputError, BrokerRejectedError, BrokerUnavailableError, isBrokerError } from "../../errors";
import { backoffDelayMs } from "../../feed/backoff";
import type { BackoffOptions } from "../../feed/backoff";
import { TypedEmitter } from "../../feed/emitter";
import type { Unsubscribe } from "../../feed/emitter";
import type { FeedStatus, MarketFeed, MarketFeedEvents, OrderFeed, OrderFeedEvents } from "../../feed/feed";
import { FeedSubscriptions } from "../../feed/subscriptions";
import type { FeedMode } from "../../models";
import { abortReason } from "../../timeout";

import type { UpstoxInstrumentResolver } from "./instruments";
import { segmentOf, toBrokerOrder, toTick, toUpstoxFeedMode } from "./mappers";
import { decodeUpstoxFeedResponse } from "./proto";
import { UPSTOX_FEED_LIMITS, UpstoxOrderUpdateSchema } from "./types";
import type { UpstoxFeedMethod, UpstoxFeedMode, UpstoxFeedRequest, UpstoxFeedResponse } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Sockets

/** The socket operations the feeds use. */
export interface UpstoxSocket {
  send(data: string | Uint8Array): void;
  /** `code` 1000 or 3000–4999. */
  close(code?: number, reason?: string): void;
}

/** Socket events. Factories call them asynchronously (never from inside the factory call), like a real WebSocket. */
export interface UpstoxSocketHandlers {
  onOpen(): void;
  onMessage(data: string | ArrayBuffer | Uint8Array): void;
  onClose(code: number, reason: string): void;
  onError(error: unknown): void;
}

/** Opens a socket to an authorized `wss://` URL (Node's global WebSocket by default; tests inject a fake Upstox). */
export type UpstoxSocketFactory = (url: string, handlers: UpstoxSocketHandlers) => UpstoxSocket;

/** The default factory: Node 24's WHATWG WebSocket, binary frames as ArrayBuffer. */
export const nativeUpstoxSocket: UpstoxSocketFactory = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    handlers.onOpen();
  });
  socket.addEventListener("message", (event: MessageEvent) => {
    handlers.onMessage(event.data as string | ArrayBuffer);
  });
  socket.addEventListener("close", (event: CloseEvent) => {
    handlers.onClose(event.code, event.reason);
  });
  socket.addEventListener("error", () => {
    handlers.onError(new BrokerUnavailableError("The Upstox feed socket failed", { broker: "UPSTOX" }));
  });
  return {
    send: (data) => {
      socket.send(data);
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// A reconnecting connection

interface Heartbeat {
  readonly intervalMs: number;
  readonly quietMs: number;
  /** Whether silence is normal now (every market segment closed). */
  quietExpected(): boolean;
  /** Sends a request Upstox answers; false when there is nothing to probe (silence is then normal). */
  probe(): boolean;
}

interface ConnectionOptions {
  readonly authorize: (signal: AbortSignal) => Promise<string>;
  readonly socketFactory: UpstoxSocketFactory;
  readonly backoff?: BackoffOptions | undefined;
  readonly heartbeat?: Heartbeat | undefined;
  /** After every (re)connect, before the status turns `up`: re-subscribe. */
  readonly onOpen: () => void;
  readonly onMessage: (data: string | ArrayBuffer | Uint8Array) => void;
  readonly onStatus: (status: FeedStatus) => void;
  readonly onError: (error: unknown) => void;
}

function unavailable(message: string, code: string): BrokerUnavailableError {
  return new BrokerUnavailableError(message, { broker: "UPSTOX", brokerError: { code } });
}

class UpstoxConnection {
  readonly #options: ConnectionOptions;
  readonly #lifetime = new AbortController();
  #status: FeedStatus = "connecting";
  #socket: UpstoxSocket | undefined;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #lastMessageAt = 0;
  #probeAt: number | undefined;

  constructor(options: ConnectionOptions) {
    this.#options = options;
  }

  get status(): FeedStatus {
    return this.#status;
  }

  /** The first connect: rejects (and closes) when it fails, so the caller gets the error. */
  async start(signal: AbortSignal): Promise<void> {
    try {
      await this.#open(AbortSignal.any([signal, this.#lifetime.signal]));
    } catch (error: unknown) {
      this.#status = "closed";
      this.#lifetime.abort();
      throw error;
    }
    this.#up();
  }

  /** Sends when connected; otherwise the frame is dropped (a reconnect re-subscribes everything). */
  send(data: Uint8Array): void {
    this.#socket?.send(data);
  }

  close(): void {
    if (this.#status === "closed") return;
    this.#lifetime.abort();
    clearTimeout(this.#reconnectTimer);
    clearInterval(this.#heartbeatTimer);
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close(1000, "closed");
    this.#setStatus("closed");
  }

  #setStatus(status: FeedStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatus(status);
  }

  async #open(signal: AbortSignal): Promise<void> {
    const url = await this.#options.authorize(signal);
    if (signal.aborted) throw abortReason(signal);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error === undefined) resolve();
        else reject(error instanceof Error ? error : unavailable("The Upstox feed failed to connect", "CONNECT"));
      };
      const onAbort = (): void => {
        socket.close(1000, "aborted");
        settle(abortReason(signal));
      };
      const socket = this.#options.socketFactory(url, {
        onOpen: () => {
          if (settled) return;
          this.#socket = socket;
          this.#lastMessageAt = Date.now();
          this.#probeAt = undefined;
          settle();
        },
        onMessage: (data) => {
          if (this.#socket !== socket) return;
          this.#lastMessageAt = Date.now();
          this.#probeAt = undefined;
          if (this.#status === "degraded") this.#setStatus("up");
          this.#options.onMessage(data);
        },
        onClose: (code) => {
          if (!settled) settle(unavailable(`The Upstox feed closed while connecting (${String(code)})`, "CONNECT"));
          else if (this.#socket === socket)
            this.#lost(unavailable(`The Upstox feed closed (${String(code)})`, "CLOSED"));
        },
        onError: (error) => {
          if (!settled) settle(error);
          else if (this.#socket === socket) this.#options.onError(error);
        },
      });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  #up(): void {
    this.#attempt = 0;
    this.#options.onOpen();
    this.#setStatus("up");
    const heartbeat = this.#options.heartbeat;
    if (heartbeat !== undefined) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = setInterval(
        () => {
          this.#checkHeartbeat(heartbeat);
        },
        Math.max(1, Math.floor(heartbeat.intervalMs / 2)),
      );
    }
  }

  #checkHeartbeat(heartbeat: Heartbeat): void {
    const socket = this.#socket;
    if (socket === undefined) return;
    const now = Date.now();
    if (this.#probeAt !== undefined) {
      if (now - this.#probeAt < heartbeat.intervalMs) return;
      this.#socket = undefined;
      socket.close(4000, "heartbeat timeout");
      this.#lost(unavailable("The Upstox feed stopped answering", "HEARTBEAT"));
      return;
    }
    const quiet = heartbeat.quietExpected();
    if (now - this.#lastMessageAt < (quiet ? heartbeat.quietMs : heartbeat.intervalMs)) return;
    if (!heartbeat.probe()) return;
    this.#probeAt = now;
    if (!quiet) this.#setStatus("degraded");
  }

  /** The socket is gone without close(): report it and reconnect with backoff. */
  #lost(error: unknown): void {
    this.#socket = undefined;
    this.#probeAt = undefined;
    clearInterval(this.#heartbeatTimer);
    this.#options.onError(error);
    this.#setStatus("down");
    this.#schedule();
  }

  #schedule(): void {
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(
      () => {
        void this.#reconnect();
      },
      backoffDelayMs(this.#attempt, this.#options.backoff),
    );
  }

  async #reconnect(): Promise<void> {
    if (this.#status === "closed") return;
    this.#setStatus("connecting");
    try {
      await this.#open(this.#lifetime.signal);
    } catch (error: unknown) {
      if (this.#lifetime.signal.aborted) return;
      this.#options.onError(error);
      this.#setStatus("down");
      // A token past 03:30 IST can't be re-authorized: wait for the api to reconnect with a new one.
      if (!(isBrokerError(error) && error.code === "NEEDS_RELOGIN")) this.#schedule();
      return;
    }
    this.#up();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Market feed

/** The most keys one Upstox market feed connection carries (`ltpc` alone; fewer in other or mixed modes). */
export const UPSTOX_MAX_FEED_INSTRUMENTS = UPSTOX_FEED_LIMITS.individual.ltpc;

/** Segment states in which ticks are expected. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["PRE_OPEN_START", "PRE_OPEN_END", "NORMAL_OPEN", "CLOSING_START"]);

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export interface UpstoxFeedOptions {
  /** Calls the feed's authorize endpoint and returns the `wss://` URL. */
  readonly authorize: (signal: AbortSignal) => Promise<string>;
  readonly socketFactory: UpstoxSocketFactory;
  readonly resolver: UpstoxInstrumentResolver;
  readonly backoff?: BackoffOptions | undefined;
}

export interface UpstoxMarketFeedOptions extends UpstoxFeedOptions {
  readonly newGuid: () => string;
  /** Silence allowed while a segment is open (default 30 s). */
  readonly heartbeatMs?: number | undefined;
  /** Silence allowed while every segment is closed (default 10 min). */
  readonly quietHeartbeatMs?: number | undefined;
}

interface Held {
  readonly token: string;
  readonly mode: UpstoxFeedMode;
  readonly option: boolean;
}

export class UpstoxMarketFeed implements MarketFeed {
  readonly #events = new TypedEmitter<MarketFeedEvents>();
  readonly #subscriptions = new FeedSubscriptions(UPSTOX_MAX_FEED_INSTRUMENTS, { broker: "UPSTOX" });
  readonly #held = new Map<InstrumentKey, Held>();
  readonly #keyOfToken = new Map<string, InstrumentKey>();
  readonly #options: UpstoxMarketFeedOptions;
  readonly #connection: UpstoxConnection;
  /** From the last `market_info`; unknown counts as open. */
  #marketOpen = true;

  private constructor(options: UpstoxMarketFeedOptions) {
    this.#options = options;
    const heartbeatMs = options.heartbeatMs ?? 30_000;
    this.#connection = new UpstoxConnection({
      authorize: options.authorize,
      socketFactory: options.socketFactory,
      backoff: options.backoff,
      heartbeat: {
        intervalMs: heartbeatMs,
        quietMs: options.quietHeartbeatMs ?? 600_000,
        quietExpected: () => !this.#marketOpen,
        probe: () => this.#probe(),
      },
      onOpen: () => {
        this.#resubscribe();
      },
      onMessage: (data) => {
        this.#onMessage(data);
      },
      onStatus: (status) => {
        this.#events.emit("status", status);
      },
      onError: (error) => {
        this.#events.emit("error", error);
      },
    });
  }

  /** Authorizes, connects and resolves once the socket is open. */
  static async open(options: UpstoxMarketFeedOptions, signal: AbortSignal): Promise<UpstoxMarketFeed> {
    const feed = new UpstoxMarketFeed(options);
    await feed.#connection.start(signal);
    return feed;
  }

  get status(): FeedStatus {
    return this.#connection.status;
  }

  /**
   * @throws {BrokerInputError} when a key has no Upstox instrument (nothing is subscribed then).
   * @throws {BrokerRejectedError} when the set would exceed Upstox's per-mode limits.
   */
  async subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    this.#assertOpen();
    const unique = [...new Set(keys)];
    const refs = await this.#options.resolver.byKeys(unique);
    const candidates = new Map<InstrumentKey, Held>();
    const unknown: InstrumentKey[] = [];
    for (const key of unique) {
      const ref = refs.get(key);
      if (ref === undefined) unknown.push(key);
      else
        candidates.set(key, {
          token: ref.brokerToken,
          mode: toUpstoxFeedMode(key, mode),
          option: segmentOf(key) === "OPT",
        });
    }
    if (unknown.length > 0) {
      throw new BrokerInputError(`Upstox has no instrument for ${unknown.slice(0, 5).join(", ")}`, {
        broker: "UPSTOX",
        brokerError: { code: "UNKNOWN_INSTRUMENT" },
      });
    }
    this.#assertOpen();
    this.#checkLimits(candidates);
    const changedKeys = new Set(this.#subscriptions.add(unique, mode));
    const added = new Map<UpstoxFeedMode, string[]>();
    const changed = new Map<UpstoxFeedMode, string[]>();
    for (const [key, candidate] of candidates) {
      if (!changedKeys.has(key)) continue;
      const previous = this.#held.get(key);
      // A held key keeps its token: Upstox knows it by that one.
      const held = previous === undefined ? candidate : { ...previous, mode: candidate.mode };
      this.#held.set(key, held);
      this.#keyOfToken.set(held.token, key);
      if (previous === undefined) push(added, held.mode, held.token);
      else if (previous.mode !== held.mode) push(changed, held.mode, held.token);
    }
    for (const [upstoxMode, tokens] of added) this.#send("sub", upstoxMode, tokens);
    for (const [upstoxMode, tokens] of changed) this.#send("change_mode", upstoxMode, tokens);
  }

  /** Unknown keys, and calls on a closed feed, are no-ops. */
  unsubscribe(keys: readonly InstrumentKey[]): Promise<void> {
    const tokens: string[] = [];
    for (const key of this.#subscriptions.remove(keys)) {
      const held = this.#held.get(key);
      if (held === undefined) continue;
      this.#held.delete(key);
      this.#keyOfToken.delete(held.token);
      tokens.push(held.token);
    }
    if (this.status !== "closed") this.#send("unsub", undefined, tokens);
    return Promise.resolve();
  }

  subscriptions(): ReadonlyMap<InstrumentKey, FeedMode> {
    return this.#subscriptions.snapshot();
  }

  on<E extends keyof MarketFeedEvents>(event: E, listener: (payload: MarketFeedEvents[E]) => void): Unsubscribe {
    return this.#events.on(event, listener);
  }

  close(): Promise<void> {
    if (this.status !== "closed") {
      this.#connection.close();
      this.#subscriptions.clear();
      this.#held.clear();
      this.#keyOfToken.clear();
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }

  #assertOpen(): void {
    if (this.status === "closed") throw new BrokerUnavailableError("The feed is closed", { broker: "UPSTOX" });
  }

  /** Upstox's limits: `individual` when one mode is in use, `combined` per mode when several are. */
  #checkLimits(candidates: ReadonlyMap<InstrumentKey, Held>): void {
    const next = new Map<InstrumentKey, UpstoxFeedMode>();
    for (const [key, held] of this.#held) next.set(key, held.mode);
    for (const [key, held] of candidates) next.set(key, held.mode);
    const counts = new Map<UpstoxFeedMode, number>();
    for (const upstoxMode of next.values()) counts.set(upstoxMode, (counts.get(upstoxMode) ?? 0) + 1);
    const kind = counts.size > 1 ? "combined" : "individual";
    for (const [upstoxMode, size] of counts) {
      const limit = UPSTOX_FEED_LIMITS[kind][upstoxMode];
      if (size > limit) {
        throw new BrokerRejectedError(
          `Upstox allows at most ${String(limit)} instruments in ${upstoxMode} mode (${kind} limit)`,
          { broker: "UPSTOX", brokerError: { code: "FEED_CAPACITY" } },
        );
      }
    }
  }

  #send(method: UpstoxFeedMethod, mode: UpstoxFeedMode | undefined, tokens: readonly string[]): void {
    if (tokens.length === 0) return;
    const request: UpstoxFeedRequest = {
      guid: this.#options.newGuid(),
      method,
      data: { ...(mode === undefined ? {} : { mode }), instrumentKeys: tokens },
    };
    // Upstox requires BINARY frames for requests.
    this.#connection.send(ENCODER.encode(JSON.stringify(request)));
  }

  #resubscribe(): void {
    const byMode = new Map<UpstoxFeedMode, string[]>();
    for (const held of this.#held.values()) push(byMode, held.mode, held.token);
    for (const [upstoxMode, tokens] of byMode) this.#send("sub", upstoxMode, tokens);
  }

  #probe(): boolean {
    const first = this.#held.values().next();
    if (first.done === true) return false;
    this.#send("sub", first.value.mode, [first.value.token]);
    return true;
  }

  #onMessage(data: string | ArrayBuffer | Uint8Array): void {
    // Upstox sends binary frames only.
    if (typeof data === "string") return;
    let response: UpstoxFeedResponse;
    try {
      response = decodeUpstoxFeedResponse(data instanceof Uint8Array ? data : new Uint8Array(data));
    } catch {
      this.#events.emit("error", unavailable("An Upstox feed frame could not be decoded", "DECODE"));
      return;
    }
    if (response.type === "market_info") {
      this.#marketOpen = Object.values(response.marketInfo?.segmentStatus ?? {}).some((s) => OPEN_STATUSES.has(s));
      return;
    }
    const currentTs = response.currentTs ?? Date.now();
    for (const [token, feed] of Object.entries(response.feeds ?? {})) {
      const key = this.#keyOfToken.get(token);
      const held = key === undefined ? undefined : this.#held.get(key);
      if (key === undefined || held === undefined) continue;
      const tick = toTick(key, feed, currentTs, held.option);
      if (tick !== undefined) this.#events.emit("tick", tick);
    }
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// Order feed (portfolio stream, `update_types=order`)

export interface UpstoxOrderFeedOptions extends UpstoxFeedOptions {
  readonly now: () => Date;
}

/**
 * Order updates for ONE account (the portfolio stream is per access token: `orderFeedScope` is `account`). Upstox
 * sends no separate trade events: fills show as `filled_quantity` and `average_price` on order updates, so this feed
 * emits `order` only.
 */
export class UpstoxOrderFeed implements OrderFeed {
  readonly #events = new TypedEmitter<OrderFeedEvents>();
  readonly #options: UpstoxOrderFeedOptions;
  readonly #connection: UpstoxConnection;
  #queue: Promise<void> = Promise.resolve();

  private constructor(options: UpstoxOrderFeedOptions) {
    this.#options = options;
    this.#connection = new UpstoxConnection({
      authorize: options.authorize,
      socketFactory: options.socketFactory,
      backoff: options.backoff,
      onOpen: () => undefined,
      onMessage: (data) => {
        const text = typeof data === "string" ? data : DECODER.decode(data);
        // In order: the instrument lookup is async.
        this.#queue = this.#queue
          .then(() => this.#handle(text))
          .catch((error: unknown) => {
            this.#events.emit("error", error);
          });
      },
      onStatus: (status) => {
        this.#events.emit("status", status);
      },
      onError: (error) => {
        this.#events.emit("error", error);
      },
    });
  }

  static async open(options: UpstoxOrderFeedOptions, signal: AbortSignal): Promise<UpstoxOrderFeed> {
    const feed = new UpstoxOrderFeed(options);
    await feed.#connection.start(signal);
    return feed;
  }

  get status(): FeedStatus {
    return this.#connection.status;
  }

  on<E extends keyof OrderFeedEvents>(event: E, listener: (payload: OrderFeedEvents[E]) => void): Unsubscribe {
    return this.#events.on(event, listener);
  }

  close(): Promise<void> {
    if (this.status !== "closed") {
      this.#connection.close();
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }

  async #handle(text: string): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw unavailable("An Upstox order update could not be read", "DECODE");
    }
    // Position, holding and GTT updates aren't requested; ignore anything else Upstox may add.
    if (typeof value !== "object" || value === null || (value as { update_type?: unknown }).update_type !== "order") {
      return;
    }
    const parsed = UpstoxOrderUpdateSchema.safeParse(value);
    if (!parsed.success) throw unavailable("An Upstox order update had an unexpected shape", "DECODE");
    const update = parsed.data;
    const token = update.instrument_key ?? update.instrument_token;
    const key = (await this.#options.resolver.byTokens([token])).get(token);
    const order = key === undefined ? undefined : toBrokerOrder(update, key, this.#options.now());
    if (order === undefined || this.status === "closed") return;
    const brokerClientId = update.user_id ?? update.userId ?? undefined;
    this.#events.emit("order", { ...(brokerClientId === undefined ? {} : { brokerClientId }), order });
  }
}
