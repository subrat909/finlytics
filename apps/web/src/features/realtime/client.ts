/**
 * The tab's one realtime connection (frontend.md "Realtime & performance", plan 1.4): a Socket.IO client on the `/rt`
 * namespace with the msgpack parser, opened lazily by the first subscription.
 *
 * - **Ref-counted subscriptions.** `subscribe(keys)` returns a release function. A key is sent to the server (`sub`)
 *   when its count goes 0 → 1 and withdrawn (`unsub`) at 1 → 0. Changes are reconciled once per microtask, so a
 *   component that re-mounts (Strict Mode, a list re-render) costs no traffic.
 * - **Reconnects.** On every `connect` the server-side set is empty again, so everything counted is re-sent.
 * - **Batched writes.** `q` rows go into a pending Map (latest per key); the store is written at most every 100 ms,
 *   inside an animation frame, so cells render at ≤ 10 fps and nothing renders in a background tab.
 * - **Clean.** `stop()` closes the socket and clears every timer; `start()` picks up from the counts again.
 */
import { RT_EVENTS, RT_NAMESPACE, RT_PATH, RtStatusSchema, RtSubscribeAckSchema } from "@finlytics/shared";

import { parseQuoteBatch } from "./schemas";
import type { Tick } from "./schemas";
import { marketActions } from "./store";

/** The ≤ 10 fps budget per cell. */
export const FLUSH_INTERVAL_MS = 100;
const CLOCK_INTERVAL_MS = 1_000;

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

export class RealtimeClient {
  readonly #url: string | undefined;
  readonly #createSocket: SocketFactory;
  readonly #scheduler: Scheduler;

  /** Subscribers per key. */
  readonly #counts = new Map<string, number>();
  /** What the server has been asked for since the last connect. */
  readonly #serverKeys = new Set<string>();
  #pending = new Map<string, Tick>();

  #active = true;
  #socket: RealtimeSocket | undefined;
  #socketLoading = false;
  #syncQueued = false;
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
    for (const key of unique) this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
    this.#queueSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const key of unique) {
        const count = (this.#counts.get(key) ?? 0) - 1;
        if (count > 0) this.#counts.set(key, count);
        else this.#counts.delete(key);
      }
      this.#queueSync();
    };
  }

  /** How many components want `key` (tests, debugging). */
  countOf(key: string): number {
    return this.#counts.get(key) ?? 0;
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
    this.#serverKeys.clear();
    this.#pending.clear();
    this.#cancelFlush();
    this.#stopClock();
    marketActions.setConnection("idle");
    marketActions.setFeed("unknown");
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

    const released = [...this.#serverKeys].filter((key) => !this.#counts.has(key));
    if (released.length > 0) {
      for (const key of released) this.#serverKeys.delete(key);
      if (this.#socket?.connected) this.#socket.emit(RT_EVENTS.unsubscribe, { keys: released });
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
    if (wanted.length === 0) return;
    for (const key of wanted) this.#serverKeys.add(key);
    socket.emit(RT_EVENTS.subscribe, { keys: wanted }, (response) => {
      const ack = RtSubscribeAckSchema.safeParse(response);
      if (ack.success) marketActions.setRejected(ack.data.rejected);
    });
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
      this.#serverKeys.clear();
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
      const status = RtStatusSchema.safeParse(message);
      if (status.success) marketActions.setFeed(status.data.feed);
    });
    socket.on(RT_EVENTS.quotes, (message) => {
      this.#onQuotes(message);
    });
  }

  #onConnect(): void {
    this.#serverKeys.clear();
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
    const batch = this.#pending;
    this.#pending = new Map();
    marketActions.applyTicks(batch);
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
