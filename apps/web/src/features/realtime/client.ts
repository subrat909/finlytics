/**
 * The tab's one realtime connection (frontend.md "Realtime & performance", plan 1.4): a Socket.IO client on the `/rt`
 * namespace with the msgpack parser, opened lazily by the first subscription.
 *
 * - **Ref-counted subscriptions.** `subscribe(keys)` returns a release function. A key is sent to the server (`sub`)
 *   when its count goes 0 → 1 and withdrawn (`unsub`) at 1 → 0. Changes are reconciled once per microtask, so a
 *   component that re-mounts (Strict Mode, a list re-render) costs no traffic.
 * - **Market depth** (plan phase-1b): `subscribeDepth(key)` is ref-counted the same way and also holds the key's quote
 *   subscription. `dsub` goes out once the server has acknowledged the key's `sub` (it streams depth only for keys in
 *   the socket's `sub` set); `dunsub` when the last holder leaves. A refusal for the per-socket limit is retried when
 *   another depth key is released; a busy or rate-limited server is retried after a pause.
 * - **Reconnects.** On every `connect` the server-side sets are empty again, so everything counted is re-sent.
 * - **Batched writes.** `q` rows and `depth` books go into pending Maps (latest per key); the store is written at most
 *   every 100 ms, inside an animation frame, so cells render at ≤ 10 fps and nothing renders in a background tab.
 * - **Clean.** `stop()` closes the socket and clears every timer; `start()` picks up from the counts again.
 */
import {
  RT_EVENTS,
  RT_MAX_KEYS_PER_MESSAGE,
  RT_NAMESPACE,
  RT_PATH,
  RtDepthAckSchema,
  RtSubscribeAckSchema,
} from "@finlytics/shared";

import { parseDepth, parseQuoteBatch, parseStatus } from "./schemas";
import type { Depth, Tick } from "./schemas";
import { marketActions } from "./store";

/** The ≤ 10 fps budget per cell. */
export const FLUSH_INTERVAL_MS = 100;
const CLOCK_INTERVAL_MS = 1_000;
/** How long to wait before asking again for depth the server was too busy for. */
export const DEPTH_RETRY_MS = 3_000;
/** Refusals worth retrying after a pause; `limit` waits for a free slot, the rest are final. */
const RETRYABLE_DEPTH_REASONS: ReadonlySet<string> = new Set(["rate_limited", "unavailable"]);

/** The part of a Socket.IO socket the client uses (a fake in tests). */
export interface RealtimeSocket {
  readonly connected: boolean;
  /** Whether socket.io will keep reconnecting on its own. */
  readonly active: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  /** Manager-level `reconnect_attempt` and `reconnect_failed`. */
  onManager(event: "reconnect_attempt" | "reconnect_failed", listener: () => void): void;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  connect(): void;
  /** Disconnects and drops every listener. */
  close(): void;
}

export type SocketFactory = (url: string | undefined) => Promise<RealtimeSocket>;

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
}

export const browserScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  },
  requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame: (handle) => {
    globalThis.cancelAnimationFrame(handle as number);
  },
};

interface ParserModule {
  Encoder: unknown;
  Decoder: unknown;
}

function isParserModule(value: unknown): value is ParserModule {
  return typeof value === "object" && value !== null && "Encoder" in value && "Decoder" in value;
}

/** The parser module, whether the bundler hands back its exports or a namespace with them under `default`. */
export function resolveParser(module: unknown): ParserModule {
  if (isParserModule(module)) return module;
  const fallback = typeof module === "object" && module !== null && "default" in module ? module.default : undefined;
  if (isParserModule(fallback)) return fallback;
  throw new TypeError("socket.io-msgpack-parser did not load");
}

/**
 * The real socket: socket.io-client and the msgpack parser are loaded on first use, so pages without live prices
 * never download them. `withCredentials` sends the session cookie to the api origin in development.
 */
export const createSocketIo: SocketFactory = async (url) => {
  const [{ io }, parserModule] = await Promise.all([
    import("socket.io-client"),
    import("socket.io-msgpack-parser") as Promise<unknown>,
  ]);
  const socket = io(`${url ?? ""}${RT_NAMESPACE}`, {
    path: RT_PATH,
    parser: resolveParser(parserModule),
    withCredentials: true,
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
  });
  return {
    get connected() {
      return socket.connected;
    },
    get active() {
      return socket.active;
    },
    on: (event, listener) => {
      socket.on(event, listener);
    },
    onManager: (event, listener) => {
      socket.io.on(event, listener);
    },
    emit: (event, payload, ack) => {
      if (ack) socket.emit(event, payload, ack);
      else socket.emit(event, payload);
    },
    connect: () => {
      socket.connect();
    },
    close: () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
    },
  };
};

export interface RealtimeClientOptions {
  /** The socket's origin; undefined is the page's own origin. */
  url?: string | undefined;
  createSocket?: SocketFactory | undefined;
  scheduler?: Scheduler | undefined;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function countUp(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function countDown(counts: Map<string, number>, key: string): void {
  const count = (counts.get(key) ?? 0) - 1;
  if (count > 0) counts.set(key, count);
  else counts.delete(key);
}

export class RealtimeClient {
  readonly #url: string | undefined;
  readonly #createSocket: SocketFactory;
  readonly #scheduler: Scheduler;

  /** Subscribers per key. */
  readonly #counts = new Map<string, number>();
  /** What the server has been asked for since the last connect. */
  readonly #serverKeys = new Set<string>();
  /** Keys the server confirmed (`sub` ack `ok`) since the last connect: depth may be asked for these. */
  readonly #ackedKeys = new Set<string>();
  /** Depth subscribers per key. */
  readonly #depthCounts = new Map<string, number>();
  /** Depth keys sent with `dsub` since the last connect (refused ones included, until they may be retried). */
  readonly #serverDepthKeys = new Set<string>();
  /** Depth keys refused for the per-socket limit: asked again when another depth key is released. */
  readonly #depthAtLimit = new Set<string>();
  readonly #depthRetries = new Set<unknown>();
  #pending = new Map<string, Tick>();
  #pendingDepth = new Map<string, Depth>();

  #active = true;
  #socket: RealtimeSocket | undefined;
  #socketLoading = false;
  #syncQueued = false;
  /** Bumped on every connect and disconnect, so an ack from an earlier connection is ignored. */
  #epoch = 0;
  #flushTimer: unknown;
  #flushFrame: unknown;
  #lastFlush = 0;
  #clock: unknown;

  constructor(options: RealtimeClientOptions = {}) {
    this.#url = options.url;
    this.#createSocket = options.createSocket ?? createSocketIo;
    this.#scheduler = options.scheduler ?? browserScheduler;
  }

  /** Counts `keys` (duplicates once) and returns the release function; calling it twice releases once. */
  subscribe(keys: readonly string[]): () => void {
    const unique = [...new Set(keys)];
    for (const key of unique) countUp(this.#counts, key);
    this.#queueSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const key of unique) countDown(this.#counts, key);
      this.#queueSync();
    };
  }

  /**
   * Streams `key`'s market depth (and its quotes) until the returned function is called; ref-counted like
   * `subscribe`. The server allows `RT_MAX_DEPTH_KEYS` per socket.
   */
  subscribeDepth(key: string): () => void {
    const releaseQuotes = this.subscribe([key]);
    countUp(this.#depthCounts, key);
    this.#queueSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      countDown(this.#depthCounts, key);
      releaseQuotes();
    };
  }

  /** How many components want `key` (tests, debugging). */
  countOf(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  /** How many components want `key`'s depth (tests, debugging). */
  depthCountOf(key: string): number {
    return this.#depthCounts.get(key) ?? 0;
  }

  /** After the server gave up (or refused the handshake): try again now. */
  retry(): void {
    if (this.#socket === undefined) {
      this.#queueSync();
      return;
    }
    marketActions.setConnection("connecting");
    this.#socket.connect();
  }

  start(): void {
    this.#active = true;
    this.#queueSync();
  }

  /** Closes the socket and clears every timer. Counts stay, so `start()` resumes. */
  stop(): void {
    this.#active = false;
    this.#socket?.close();
    this.#socket = undefined;
    this.#resetServerState();
    this.#pending.clear();
    this.#pendingDepth.clear();
    this.#cancelFlush();
    this.#stopClock();
    marketActions.setConnection("idle");
    marketActions.setFeed("unknown");
    marketActions.setSource(undefined);
  }

  #queueSync(): void {
    if (this.#syncQueued) return;
    this.#syncQueued = true;
    queueMicrotask(() => {
      this.#syncQueued = false;
      this.#sync();
    });
  }

  #sync(): void {
    if (!this.#active) return;
    if (this.#counts.size > 0) this.#startClock();
    else this.#stopClock();
    const connected = this.#socket?.connected === true;

    // Depth first, so the server never holds a depth stream for a key it no longer sends quotes for.
    const releasedDepth = [...this.#serverDepthKeys].filter((key) => !this.#depthCounts.has(key));
    for (const key of releasedDepth) {
      this.#serverDepthKeys.delete(key);
      if (connected && !this.#depthAtLimit.has(key)) this.#socket?.emit(RT_EVENTS.depthUnsubscribe, { key });
      this.#depthAtLimit.delete(key);
    }
    if (releasedDepth.length > 0) {
      // A slot may be free now: ask again for the keys refused at the limit.
      for (const key of this.#depthAtLimit) this.#serverDepthKeys.delete(key);
      this.#depthAtLimit.clear();
    }
    marketActions.forgetDepthExcept(this.#depthCounts);

    const released = [...this.#serverKeys].filter((key) => !this.#counts.has(key));
    if (released.length > 0) {
      for (const key of released) {
        this.#serverKeys.delete(key);
        this.#ackedKeys.delete(key);
      }
      if (connected) {
        for (const keys of chunks(released, RT_MAX_KEYS_PER_MESSAGE)) {
          this.#socket?.emit(RT_EVENTS.unsubscribe, { keys });
        }
      }
      marketActions.forget(released);
    }

    if (this.#counts.size === 0) return;
    const socket = this.#socket;
    if (socket === undefined) {
      this.#openSocket();
      return;
    }
    if (!socket.connected) return; // `connect` re-sends everything

    const wanted = [...this.#counts.keys()].filter((key) => !this.#serverKeys.has(key));
    for (const key of wanted) this.#serverKeys.add(key);
    const epoch = this.#epoch;
    for (const keys of chunks(wanted, RT_MAX_KEYS_PER_MESSAGE)) {
      socket.emit(RT_EVENTS.subscribe, { keys }, (response) => {
        this.#onSubscribeAck(response, epoch);
      });
    }
    this.#syncDepth(socket);
  }

  #onSubscribeAck(response: unknown, epoch: number): void {
    const ack = RtSubscribeAckSchema.safeParse(response);
    if (!ack.success || epoch !== this.#epoch) return;
    marketActions.setRejected(ack.data.rejected);
    let depthWaiting = false;
    for (const key of ack.data.ok) {
      if (!this.#serverKeys.has(key)) continue;
      this.#ackedKeys.add(key);
      if (this.#depthCounts.has(key)) depthWaiting = true;
    }
    if (depthWaiting) this.#queueSync();
  }

  #syncDepth(socket: RealtimeSocket): void {
    for (const key of this.#depthCounts.keys()) {
      if (this.#serverDepthKeys.has(key) || !this.#ackedKeys.has(key)) continue;
      this.#serverDepthKeys.add(key);
      const epoch = this.#epoch;
      socket.emit(RT_EVENTS.depthSubscribe, { key }, (response) => {
        this.#onDepthAck(key, response, epoch);
      });
    }
  }

  #onDepthAck(key: string, response: unknown, epoch: number): void {
    const ack = RtDepthAckSchema.safeParse(response);
    if (!ack.success || epoch !== this.#epoch || !this.#depthCounts.has(key)) return;
    if (ack.data.ok) {
      marketActions.setDepthRejected(key, undefined);
      return;
    }
    const reason = ack.data.reason ?? "unavailable";
    marketActions.setDepthRejected(key, reason);
    if (reason === "limit") {
      this.#depthAtLimit.add(key);
    } else if (RETRYABLE_DEPTH_REASONS.has(reason)) {
      const handle = this.#scheduler.setTimeout(() => {
        this.#depthRetries.delete(handle);
        if (epoch !== this.#epoch) return;
        this.#serverDepthKeys.delete(key);
        this.#queueSync();
      }, DEPTH_RETRY_MS);
      this.#depthRetries.add(handle);
    }
  }

  #openSocket(): void {
    if (this.#socketLoading) return;
    this.#socketLoading = true;
    marketActions.setConnection("connecting");
    this.#createSocket(this.#url).then(
      (socket) => {
        this.#socketLoading = false;
        if (!this.#active) {
          socket.close();
          return;
        }
        this.#socket = socket;
        this.#listen(socket);
        if (socket.connected) this.#onConnect();
      },
      () => {
        this.#socketLoading = false;
        marketActions.setConnection("unavailable");
      },
    );
  }

  #listen(socket: RealtimeSocket): void {
    socket.on("connect", () => {
      this.#onConnect();
    });
    socket.on("disconnect", () => {
      this.#resetServerState();
      marketActions.setFeed("unknown");
      marketActions.setConnection(socket.active ? "reconnecting" : "unavailable");
    });
    socket.on("connect_error", () => {
      marketActions.setConnection(socket.active ? "reconnecting" : "unavailable");
    });
    socket.onManager("reconnect_attempt", () => {
      marketActions.setConnection("reconnecting");
    });
    socket.onManager("reconnect_failed", () => {
      marketActions.setConnection("unavailable");
    });
    socket.on(RT_EVENTS.status, (message) => {
      const status = parseStatus(message);
      if (status === undefined) return;
      marketActions.setFeed(status.feed);
      if (status.source !== undefined) marketActions.setSource(status.source);
    });
    socket.on(RT_EVENTS.quotes, (message) => {
      this.#onQuotes(message);
    });
    socket.on(RT_EVENTS.depth, (message) => {
      this.#onDepth(message);
    });
  }

  /** Everything the server knew about this socket is gone (a new connection, a drop, `stop()`). */
  #resetServerState(): void {
    this.#epoch += 1;
    this.#serverKeys.clear();
    this.#ackedKeys.clear();
    this.#serverDepthKeys.clear();
    this.#depthAtLimit.clear();
    for (const handle of this.#depthRetries) this.#scheduler.clearTimeout(handle);
    this.#depthRetries.clear();
  }

  #onConnect(): void {
    this.#resetServerState();
    marketActions.clearDepthRejected();
    marketActions.setConnection("connected");
    this.#sync();
  }

  #onQuotes(message: unknown): void {
    for (const [key, tick] of parseQuoteBatch(message, this.#scheduler.now())) {
      // A late row for something nothing shows any more would only grow the store.
      if (this.#counts.has(key)) this.#pending.set(key, tick);
    }
    if (this.#pending.size > 0) this.#scheduleFlush();
  }

  #onDepth(message: unknown): void {
    const parsed = parseDepth(message, this.#scheduler.now());
    if (parsed === undefined || !this.#depthCounts.has(parsed[0])) return;
    this.#pendingDepth.set(parsed[0], parsed[1]);
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== undefined || this.#flushFrame !== undefined) return;
    const wait = Math.max(0, this.#lastFlush + FLUSH_INTERVAL_MS - this.#scheduler.now());
    this.#flushTimer = this.#scheduler.setTimeout(() => {
      this.#flushTimer = undefined;
      this.#flushFrame = this.#scheduler.requestFrame(() => {
        this.#flushFrame = undefined;
        this.#flush();
      });
    }, wait);
  }

  #flush(): void {
    this.#lastFlush = this.#scheduler.now();
    const ticks = this.#pending;
    const depth = this.#pendingDepth;
    this.#pending = new Map();
    this.#pendingDepth = new Map();
    marketActions.applyBatch(ticks, depth);
  }

  #cancelFlush(): void {
    if (this.#flushTimer !== undefined) this.#scheduler.clearTimeout(this.#flushTimer);
    if (this.#flushFrame !== undefined) this.#scheduler.cancelFrame(this.#flushFrame);
    this.#flushTimer = undefined;
    this.#flushFrame = undefined;
  }

  #startClock(): void {
    if (this.#clock !== undefined) return;
    marketActions.tickClock(this.#scheduler.now());
    this.#clock = this.#scheduler.setInterval(() => {
      marketActions.tickClock(this.#scheduler.now());
    }, CLOCK_INTERVAL_MS);
  }

  #stopClock(): void {
    if (this.#clock === undefined) return;
    this.#scheduler.clearInterval(this.#clock);
    this.#clock = undefined;
  }
}
