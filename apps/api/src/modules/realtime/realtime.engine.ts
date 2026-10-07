/**
 * The realtime gateway's logic (phase 1 plan "WebSocket"; phase-1b "Quotes, depth and realtime"; backend.md
 * "Realtime pipeline"):
 *
 * - `sub` / `unsub` with acks, validated with the shared Zod schemas; each socket holds at most its user's
 *   `Plan.maxRtSubscriptions` keys, only keys of active instruments, and sends at most 10 messages a second (`sub`,
 *   `unsub`, `dsub` and `dunsub` together).
 * - Ref-counts in Redis (`subs:<key>`, `subs:wanted`) for the feed; a local ref-count per pod for `q:<key>`/`d:<key>`.
 * - Coalescing: updates from `q:<key>` are kept per key and flushed every 100 ms as one `q` per socket (12-tuple rows),
 *   each key at most 10 times a second (TickCoalescer). A socket with a backed-up transport skips a flush.
 * - Depth: `dsub {key}` streams `depth` for a key the socket already holds through `sub`, at most
 *   {@link RT_MAX_DEPTH_KEYS} per socket, each key at most 4 times a second (DepthThrottle); the stored book is sent
 *   right after the ack. `dunsub`, `unsub` of the key, and disconnecting stop it.
 * - `status` `{feed, source, live}`: the feed's state (`up`, `down`, or `stale` when no tick arrived for 5 s while
 *   subscribed) and the source driving it (`live` false for the simulator), sent on connect and on every change.
 *
 * Per-socket operations run one at a time, so a disconnect never races a subscribe half-way through.
 */
import {
  isInstrumentKey,
  RT_COALESCE_MS,
  RT_EVENTS,
  RT_MAX_DEPTH_KEYS,
  RtDepthSubscribeSchema,
  RtSubscribeSchema,
  RtUnsubscribeSchema,
} from "@finlytics/shared";
import type {
  InstrumentKey,
  RtDepth,
  RtDepthAck,
  RtFeedState,
  RtStatus,
  RtSubscribeAck,
  RtUnsubscribeAck,
  RtUserEvent,
} from "@finlytics/shared";

import { feedStateOf } from "../../feed/feed-source";
import type { FeedSnapshot } from "../../feed/feed-source";
import { toQuoteRow } from "../../feed/quote-update";
import type { QuoteUpdate } from "../../feed/quote-update";
import type { AuthIdentity } from "../auth/auth-identity";

import { DepthThrottle } from "./depth-throttle";
import type { QuoteSubscriber } from "./quote-subscriber";
import type { RealtimeRepository } from "./realtime.repository";
import { TickCoalescer } from "./tick-coalescer";

/** Messages (`sub`, `unsub`, `dsub`, `dunsub`) one socket may send per second. */
export const MAX_MESSAGES_PER_SECOND = 10;

/** How often the feed status is read. */
export const STATUS_POLL_MS = 2_000;

/** A transport with more packets than this waiting skips a flush. */
const MAX_WRITE_BUFFER = 64;

/** Known-active instrument keys are cached this long (positive answers only). */
const INSTRUMENT_CACHE_MS = 600_000;
const INSTRUMENT_CACHE_MAX = 50_000;

/** The room of a key's depth stream (keys never contain `:`, so it can't collide with a quote room). */
export function depthRoom(key: InstrumentKey): string {
  return `d:${key}`;
}

/** The socket calls the service makes. */
export interface RtSocket {
  readonly id: string;
  join(room: string): unknown;
  leave(room: string): unknown;
  emit(event: string, payload: unknown): unknown;
}

/** The namespace calls the service makes (this pod's sockets only). */
export interface RtNamespace {
  roomMembers(room: string): ReadonlySet<string> | undefined;
  socket(id: string): RtSocket | undefined;
  broadcastLocal(event: string, payload: unknown): void;
  /** Whether the socket's transport has more than `limit` packets waiting (a slow client). */
  backedUp(id: string, limit: number): boolean;
}

/** The Socket.IO room of a user's sockets (instrument rooms are keys, which always contain `|`). */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export interface RealtimeLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

interface SocketState {
  readonly socket: RtSocket;
  readonly identity: AuthIdentity;
  readonly maxSubscriptions: number;
  readonly keys: Set<InstrumentKey>;
  readonly depthKeys: Set<InstrumentKey>;
  windowStart: number;
  messages: number;
  queue: Promise<unknown>;
  closed: boolean;
}

export interface RealtimeEngineOptions {
  readonly repository: Pick<
    RealtimeRepository,
    "acquire" | "release" | "snapshots" | "feedSnapshot" | "activeInstrumentKeys" | "depthSnapshot"
  >;
  readonly quotes: Pick<QuoteSubscriber, "add" | "remove" | "addDepth" | "removeDepth" | "close">;
  readonly logger: RealtimeLogger;
  readonly now?: () => number;
}

/** The status before the first read: down, on the simulator. */
const INITIAL_STATUS: RtStatus = Object.freeze({ feed: "down", source: "PAPER", live: false });

/**
 * The `status` event for a snapshot: the leader's report mapped to `up`/`stale`/`down` (`stale` when no tick reached
 * this pod for 5 s while it holds subscriptions), with the source.
 */
export function statusOf(snapshot: FeedSnapshot, now: number, subscribed: boolean, lastTickAt: number): RtStatus {
  return {
    feed: feedStateOf(snapshot.status, now, subscribed ? lastTickAt : undefined),
    source: snapshot.source.broker,
    live: snapshot.source.live,
  };
}

export class RealtimeEngine {
  readonly coalescer = new TickCoalescer(RT_COALESCE_MS);
  readonly depths = new DepthThrottle();
  readonly #options: RealtimeEngineOptions;
  readonly #now: () => number;
  readonly #sockets = new Map<string, SocketState>();
  readonly #activeInstruments = new Map<InstrumentKey, number>();
  /** Keys any local socket holds, with how many. */
  readonly #localKeys = new Map<InstrumentKey, number>();
  /** Keys any local socket streams depth for, with how many. */
  readonly #localDepth = new Map<InstrumentKey, number>();
  #namespace: RtNamespace | undefined;
  #timers: NodeJS.Timeout[] = [];
  #status: RtStatus = INITIAL_STATUS;
  #lastTickAt = 0;

  constructor(options: RealtimeEngineOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  get feedState(): RtFeedState {
    return this.#status.feed;
  }

  get status(): RtStatus {
    return this.#status;
  }

  /** A `user` event from Redis: this pod's sockets of that user refetch what it names. */
  onUserEvent(event: { readonly userId: string; readonly kind: RtUserEvent["kind"] }): void {
    const namespace = this.#namespace;
    const members = namespace?.roomMembers(userRoom(event.userId));
    if (namespace === undefined || members === undefined) return;
    const payload: RtUserEvent = { kind: event.kind };
    for (const id of members) namespace.socket(id)?.emit(RT_EVENTS.user, payload);
  }

  /** Binds the namespace (the gateway's `afterInit`). Nothing runs until {@link start}. */
  attach(namespace: RtNamespace): void {
    this.#namespace = namespace;
  }

  /**
   * Starts flushing every 100 ms and polling the feed status (after bootstrap: Redis connects in `onModuleInit`, which
   * runs after gateways are initialised).
   */
  start(): void {
    if (this.#timers.length > 0) return;
    const flush = setInterval(() => {
      this.flush(this.#now());
    }, RT_COALESCE_MS);
    const poll = setInterval(() => {
      void this.refreshStatus();
    }, STATUS_POLL_MS);
    flush.unref();
    poll.unref();
    this.#timers = [flush, poll];
    void this.refreshStatus();
  }

  /** A `q:<key>` message. */
  onQuote(update: QuoteUpdate): void {
    this.#lastTickAt = this.#now();
    this.coalescer.push(update);
  }

  /** A `d:<key>` message. */
  onDepth(depth: RtDepth): void {
    if (this.#localDepth.has(depth.k)) this.depths.push(depth);
  }

  /** A socket that passed the handshake (with its plan's limit): tells it the feed status. */
  register(socket: RtSocket, identity: AuthIdentity, maxSubscriptions: number): void {
    const state: SocketState = {
      socket,
      identity,
      maxSubscriptions,
      keys: new Set(),
      depthKeys: new Set(),
      windowStart: this.#now(),
      messages: 0,
      queue: Promise.resolve(),
      closed: false,
    };
    this.#sockets.set(socket.id, state);
    // The user's own room: `user` events (notifications, broker accounts) reach every tab of theirs.
    socket.join(userRoom(identity.userId));
    socket.emit(RT_EVENTS.status, this.#status);
  }

  /** Keys a socket holds (tests, diagnostics). */
  keysOf(socketId: string): InstrumentKey[] {
    return [...(this.#sockets.get(socketId)?.keys ?? [])];
  }

  /** Keys a socket streams depth for (tests, diagnostics). */
  depthKeysOf(socketId: string): InstrumentKey[] {
    return [...(this.#sockets.get(socketId)?.depthKeys ?? [])];
  }

  subscribe(socketId: string, payload: unknown): Promise<RtSubscribeAck> {
    const state = this.#sockets.get(socketId);
    if (state === undefined) return Promise.resolve({ ok: [], rejected: [] });
    if (!this.#admitMessage(state)) return Promise.resolve(rejectAll(payload, "rate_limited"));
    return this.#serialise(state, () => this.#subscribe(state, payload));
  }

  unsubscribe(socketId: string, payload: unknown): Promise<RtUnsubscribeAck> {
    const state = this.#sockets.get(socketId);
    if (state === undefined || !this.#admitMessage(state)) return Promise.resolve({ ok: [] });
    return this.#serialise(state, () => this.#unsubscribe(state, payload));
  }

  depthSubscribe(socketId: string, payload: unknown): Promise<RtDepthAck> {
    const state = this.#sockets.get(socketId);
    if (state === undefined) return Promise.resolve({ ok: false, reason: "invalid_key" });
    if (!this.#admitMessage(state)) return Promise.resolve({ ok: false, reason: "rate_limited" });
    return this.#serialise(state, () => this.#depthSubscribe(state, payload));
  }

  depthUnsubscribe(socketId: string, payload: unknown): Promise<RtDepthAck> {
    const state = this.#sockets.get(socketId);
    if (state === undefined || !this.#admitMessage(state)) return Promise.resolve({ ok: false });
    return this.#serialise(state, async () => {
      const parsed = RtDepthSubscribeSchema.safeParse(payload);
      if (!parsed.success || !isInstrumentKey(parsed.data.key) || !state.depthKeys.has(parsed.data.key)) {
        return { ok: false };
      }
      await this.#dropDepth(state, [parsed.data.key]);
      return { ok: true };
    });
  }

  /** A disconnected socket: releases everything it held. */
  async unregister(socketId: string): Promise<void> {
    const state = this.#sockets.get(socketId);
    if (state === undefined) return;
    this.#sockets.delete(socketId);
    await this.#serialise(state, async () => {
      state.closed = true;
      await this.#drop(state, [...state.keys]);
    });
  }

  /** Sends what is due: one `q` per socket with every due key it holds, and the due books. */
  flush(now: number): void {
    const namespace = this.#namespace;
    if (namespace === undefined) return;
    if (this.coalescer.size > 0) this.#flushQuotes(namespace, now);
    if (this.depths.size > 0) this.#flushDepths(namespace, now);
  }

  /** Reads the feed status and broadcasts a change. */
  async refreshStatus(): Promise<void> {
    let next: RtStatus;
    try {
      const snapshot = await this.#options.repository.feedSnapshot();
      next = statusOf(snapshot, this.#now(), this.#localKeys.size > 0, this.#lastTickAt);
    } catch {
      next = { ...this.#status, feed: "down" };
    }
    const current = this.#status;
    if (next.feed === current.feed && next.source === current.source && next.live === current.live) return;
    this.#status = next;
    this.#namespace?.broadcastLocal(RT_EVENTS.status, next);
  }

  /** Shutdown: stops the timers and releases every socket's keys (before the server closes the sockets). */
  async close(): Promise<void> {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
    await Promise.all([...this.#sockets.keys()].map((id) => this.unregister(id)));
    await this.#options.quotes.close();
  }

  #flushQuotes(namespace: RtNamespace, now: number): void {
    const batches = new Map<string, unknown[]>();
    for (const [key, update] of this.coalescer.drain(now)) {
      const members = namespace.roomMembers(key);
      if (members === undefined) continue;
      const row = toQuoteRow(update);
      for (const id of members) {
        const rows = batches.get(id);
        if (rows === undefined) batches.set(id, [row]);
        else rows.push(row);
      }
    }
    for (const [id, rows] of batches) {
      const socket = namespace.socket(id);
      if (socket === undefined || namespace.backedUp(id, MAX_WRITE_BUFFER)) continue;
      socket.emit(RT_EVENTS.quotes, { t: now, d: rows });
    }
  }

  #flushDepths(namespace: RtNamespace, now: number): void {
    for (const [key, depth] of this.depths.drain(now)) {
      for (const id of namespace.roomMembers(depthRoom(key)) ?? []) {
        const socket = namespace.socket(id);
        if (socket === undefined || namespace.backedUp(id, MAX_WRITE_BUFFER)) continue;
        socket.emit(RT_EVENTS.depth, depth);
      }
    }
  }

  #admitMessage(state: SocketState): boolean {
    const now = this.#now();
    if (now - state.windowStart >= 1_000) {
      state.windowStart = now;
      state.messages = 0;
    }
    state.messages += 1;
    return state.messages <= MAX_MESSAGES_PER_SECOND;
  }

  #serialise<T>(state: SocketState, run: () => Promise<T>): Promise<T> {
    const result = state.queue.then(run);
    state.queue = result.catch(() => undefined);
    return result;
  }

  async #subscribe(state: SocketState, payload: unknown): Promise<RtSubscribeAck> {
    const parsed = RtSubscribeSchema.safeParse(payload);
    if (!parsed.success || state.closed) return rejectAll(payload, "invalid_key");
    const ok: InstrumentKey[] = [];
    const rejected: RtSubscribeAck["rejected"] = [];
    const candidates: InstrumentKey[] = [];
    for (const raw of new Set(parsed.data.keys)) {
      if (!isInstrumentKey(raw)) rejected.push({ key: raw, reason: "invalid_key" });
      else if (state.keys.has(raw)) ok.push(raw);
      else candidates.push(raw);
    }

    let active: Set<InstrumentKey>;
    try {
      active = await this.#activeKeys(candidates);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, "instrument lookup failed");
      for (const key of candidates) rejected.push({ key, reason: "unavailable" });
      return { ok, rejected };
    }
    const fresh: InstrumentKey[] = [];
    for (const key of candidates) {
      if (!active.has(key)) rejected.push({ key, reason: "unknown_instrument" });
      else if (state.keys.size + fresh.length >= state.maxSubscriptions) rejected.push({ key, reason: "limit" });
      else fresh.push(key);
    }
    if (fresh.length === 0) return { ok, rejected };

    try {
      await this.#options.repository.acquire(fresh);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, "could not record subscriptions");
      for (const key of fresh) rejected.push({ key, reason: "unavailable" });
      return { ok, rejected };
    }
    for (const key of fresh) {
      state.keys.add(key);
      state.socket.join(key);
      this.#holdLocal(key);
    }
    try {
      await this.#options.quotes.add(fresh);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, "could not subscribe to quote channels");
    }
    ok.push(...fresh);
    // After the ack (the gateway answers when this resolves): the latest stored quote of each new key.
    setImmediate(() => {
      void this.#sendSnapshots(state, fresh);
    });
    return { ok, rejected };
  }

  async #unsubscribe(state: SocketState, payload: unknown): Promise<RtUnsubscribeAck> {
    const parsed = RtUnsubscribeSchema.safeParse(payload);
    if (!parsed.success) return { ok: [] };
    const held = [...new Set(parsed.data.keys)].filter(
      (key): key is InstrumentKey => isInstrumentKey(key) && state.keys.has(key),
    );
    await this.#drop(state, held);
    return { ok: held };
  }

  async #depthSubscribe(state: SocketState, payload: unknown): Promise<RtDepthAck> {
    const parsed = RtDepthSubscribeSchema.safeParse(payload);
    if (!parsed.success || state.closed || !isInstrumentKey(parsed.data.key))
      return { ok: false, reason: "invalid_key" };
    const key = parsed.data.key;
    if (state.depthKeys.has(key)) return { ok: true };
    // Depth rides on a quote subscription: the key must be in the socket's `sub` set.
    if (!state.keys.has(key)) return { ok: false, reason: "invalid_key" };
    if (state.depthKeys.size >= RT_MAX_DEPTH_KEYS) return { ok: false, reason: "limit" };
    try {
      await this.#options.quotes.addDepth([key]);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, "could not subscribe to a depth channel");
      return { ok: false, reason: "unavailable" };
    }
    state.depthKeys.add(key);
    state.socket.join(depthRoom(key));
    this.#localDepth.set(key, (this.#localDepth.get(key) ?? 0) + 1);
    setImmediate(() => {
      void this.#sendDepthSnapshot(state, key);
    });
    return { ok: true };
  }

  /** Forgets `keys` for a socket: rooms, local and Redis ref-counts. Failures are logged; the keys are gone locally. */
  async #drop(state: SocketState, keys: readonly InstrumentKey[]): Promise<void> {
    if (keys.length === 0) return;
    await this.#dropDepth(
      state,
      keys.filter((key) => state.depthKeys.has(key)),
    );
    for (const key of keys) {
      state.keys.delete(key);
      if (!state.closed) state.socket.leave(key);
      if (this.#releaseLocal(key)) this.coalescer.forget(key);
    }
    const results = await Promise.allSettled([
      this.#options.quotes.remove(keys),
      this.#options.repository.release(keys),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        this.#options.logger.warn({ err: result.reason }, "could not release subscriptions");
      }
    }
  }

  async #dropDepth(state: SocketState, keys: readonly InstrumentKey[]): Promise<void> {
    if (keys.length === 0) return;
    for (const key of keys) {
      state.depthKeys.delete(key);
      if (!state.closed) state.socket.leave(depthRoom(key));
      const count = (this.#localDepth.get(key) ?? 0) - 1;
      if (count > 0) {
        this.#localDepth.set(key, count);
      } else {
        this.#localDepth.delete(key);
        this.depths.forget(key);
      }
    }
    try {
      await this.#options.quotes.removeDepth(keys);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, "could not release depth channels");
    }
  }

  #holdLocal(key: InstrumentKey): void {
    if (this.#localKeys.size === 0) this.#lastTickAt = this.#now();
    this.#localKeys.set(key, (this.#localKeys.get(key) ?? 0) + 1);
  }

  /** True when no local socket holds `key` any more. */
  #releaseLocal(key: InstrumentKey): boolean {
    const count = (this.#localKeys.get(key) ?? 0) - 1;
    if (count > 0) {
      this.#localKeys.set(key, count);
      return false;
    }
    this.#localKeys.delete(key);
    return true;
  }

  async #activeKeys(keys: readonly InstrumentKey[]): Promise<Set<InstrumentKey>> {
    const now = this.#now();
    const known = new Set<InstrumentKey>();
    const unknown: InstrumentKey[] = [];
    for (const key of keys) {
      if ((this.#activeInstruments.get(key) ?? 0) > now) known.add(key);
      else unknown.push(key);
    }
    if (unknown.length === 0) return known;
    const found = await this.#options.repository.activeInstrumentKeys(unknown);
    if (this.#activeInstruments.size + found.size > INSTRUMENT_CACHE_MAX) this.#activeInstruments.clear();
    for (const key of found) {
      this.#activeInstruments.set(key, now + INSTRUMENT_CACHE_MS);
      known.add(key);
    }
    return known;
  }

  async #sendSnapshots(state: SocketState, keys: readonly InstrumentKey[]): Promise<void> {
    try {
      const updates = await this.#options.repository.snapshots(keys);
      const rows = updates.filter((update) => state.keys.has(update.k)).map((update) => toQuoteRow(update));
      if (rows.length > 0 && !state.closed) state.socket.emit(RT_EVENTS.quotes, { t: this.#now(), d: rows });
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error }, "quote snapshot failed");
    }
  }

  async #sendDepthSnapshot(state: SocketState, key: InstrumentKey): Promise<void> {
    try {
      const depth = await this.#options.repository.depthSnapshot(key);
      if (depth !== undefined && state.depthKeys.has(key) && !state.closed) {
        state.socket.emit(RT_EVENTS.depth, depth);
      }
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error }, "depth snapshot failed");
    }
  }
}

/** Every key of a refused message, with one reason. */
function rejectAll(payload: unknown, reason: RtSubscribeAck["rejected"][number]["reason"]): RtSubscribeAck {
  const keys =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { keys?: unknown }).keys)
      ? (payload as { keys: unknown[] }).keys.filter((key): key is string => typeof key === "string").slice(0, 200)
      : [];
  return { ok: [], rejected: keys.map((key) => ({ key: key.slice(0, 256), reason })) };
}
