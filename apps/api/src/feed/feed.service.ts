/**
 * The shared market feed (phase 1 plan P2; phase-1b "Feed source"; backend.md "Realtime pipeline"): ONE market feed
 * for the whole platform, run by whichever `feed` process holds `lock:feed:market`.
 *
 * As leader it:
 * - picks the source with {@link FeedSelection} (MARKET_FEED_SOURCE: `auto` picks the best ACTIVE broker account and
 *   falls back to the simulator) at once, every 30 s and when poked (`broker.account.*` and `instruments.synced`);
 * - switches make-before-break: the new feed connects while the old one still streams, then the old one closes. Two
 *   accounts of one broker can't overlap (the gateway keeps one feed per broker), so that switch closes first. Going
 *   live (from the simulator, or on a fresh start) deletes simulated quotes and, once, synthetic candles;
 * - on a failure to connect, records it (the account waits out a backoff) and, in `auto`, falls back to the simulator
 *   with a reason; a broker feed down for over a minute counts as a failure too;
 * - reconciles subscriptions every second: the pinned keys (every MARKET_INDEX_KEYS index and the NIFTY 50) plus
 *   `subs:wanted`, mapped to the broker's tokens (keys without one are skipped). A wanted key whose ref-count
 *   `subs:<key>` stayed at 0 for RT_UNSUB_GRACE_MS is dropped from the set atomically and unsubscribed. Keys go in
 *   `full` mode (OHLC, ATP, depth) up to the broker's limit, `ltp` beyond;
 * - writes every tick to `ticks:<BROKER>`, `quote:<key>`, `q:<key>` and books to `depth:<key>`/`d:<key>` (TickWriter),
 *   the source to `feed:source` and its state to `feed:status:<BROKER>` (`{status, ts, lastTickAt}`, PX 15 s).
 *
 * Losing the lock (or shutdown) closes the connection at once.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { backoffDelayMs, isBrokerError } from "@finlytics/broker-sdk";
import type { FeedMode, FeedStatus, Unsubscribe } from "@finlytics/broker-sdk";
import { isInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { PinoLogger } from "nestjs-pino";

import type { Env } from "../config/env.schema";
import { PrismaService } from "../infra/prisma/prisma.service";
import { redisKeys } from "../infra/redis/keys";
import { RedisService } from "../infra/redis/redis.service";
import type { RedisScript } from "../infra/redis/redis.service";

import { FEED_ACCOUNT_ACCESS, FEED_CONNECTOR, planModes } from "./feed-connector";
import type { FeedAccountAccess, FeedConnection, FeedConnector } from "./feed-connector";
import { FEED_EVENTS } from "./feed-events";
import { FeedSourceSelector, connectFailureReason, lostFeedReason } from "./feed-selector";
import type { FeedDecision } from "./feed-selector";
import { encodeFeedStatus, feedSourceHash, PAPER_TARGET, sameTarget } from "./feed-source";
import type { FeedTarget } from "./feed-source";
import { LeaderElector, RedisLockStore } from "./leader-lock";
import type { LockStore } from "./leader-lock";
import { PINNED_KEYS } from "./pinned-keys";
import { MarketDataPurge, PURGE_SIMULATED_QUOTE_LUA } from "./market-purge";
import { TickWriter } from "./tick-writer";
import type { TickWriterTarget } from "./tick-writer";

/** How often the leader reconciles subscriptions and refreshes its status. */
export const RECONCILE_INTERVAL_MS = 1_000;

/** How long `feed:status:<BROKER>` lives without a refresh. */
export const FEED_STATUS_TTL_MS = 15_000;

/** How often the leader asks again which source should drive the feed. */
export const SELECT_INTERVAL_MS = 30_000;

/** A broker feed down (not reconnecting by itself) for this long counts as a failure. */
export const DOWN_FALLBACK_MS = 60_000;

/** The one platform feed's lock: `lock:feed:market`. */
export const FEED_LOCK_NAME = "market";

/** Keys per subscribe/unsubscribe request to the broker. */
const SUBSCRIBE_CHUNK = 500;

/** A key the broker refused on its own is not asked for again for this long. */
const REFUSED_KEY_MS = 600_000;

/** A feed refused for its token is re-opened with fresh credentials once in this window, then counts as a failure. */
const REOPEN_WINDOW_MS = 300_000;

/**
 * Drops an idle key atomically: when `subs:<key>` is still at or below 0, delete it and remove the key from
 * `subs:wanted`. 1 = dropped, 0 = someone subscribed again.
 */
const RELEASE_IDLE_LUA = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count <= 0 then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[1])
  return 1
end
return 0
`;

/** The Redis calls the engine makes, so tests can pass a fake. */
export interface FeedRedis extends TickWriterTarget {
  smembers(key: string): Promise<string[]>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, px: "PX", ttlMs: number): Promise<unknown>;
  hset(key: string, fields: Record<string, string>): Promise<unknown>;
}

/** What the engine needs of the source selection (FeedSourceSelector). */
export type FeedSelection = Pick<
  FeedSourceSelector,
  "mode" | "select" | "blockedUntil" | "failureReason" | "recordFailure" | "recordSuccess"
>;

export interface FeedLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  debug(fields: Record<string, unknown>, message: string): void;
}

export interface FeedServiceDeps {
  readonly connector: FeedConnector;
  readonly selector: FeedSelection;
  readonly redis: FeedRedis;
  readonly lockStore: LockStore;
  readonly releaseIdle: (key: InstrumentKey) => Promise<boolean>;
  /** Clean-ups when the feed goes live (MarketDataPurge). */
  readonly purge: { goLive(): Promise<void> };
  /** The broker refused the account's token (NEEDS_RELOGIN). */
  readonly onRefused?: (target: Exclude<FeedTarget, { broker: "PAPER" }>) => Promise<void>;
  readonly graceMs: number;
  readonly logger: FeedLogger;
  readonly pinned?: readonly InstrumentKey[];
  readonly owner?: string;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly lock?: { ttlMs: number; renewMs: number };
  readonly selectIntervalMs?: number;
  readonly downFallbackMs?: number;
}

/** The open connection and what hangs off it. */
interface Active {
  readonly conn: FeedConnection;
  readonly writer: TickWriter;
  listeners: Unsubscribe[];
  /** Since when the feed hasn't been up (undefined while up or degraded). */
  downSince: number | undefined;
  /** A refusal the feed reported (NEEDS_RELOGIN, BROKER_REJECTED): it won't reconnect by itself. */
  fatal: unknown;
  readonly attachedAt: number;
}

/** `signal.aborted`, read through a call: it changes across awaits, which flow analysis can't see. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function push<K, V>(groups: Map<K, V[]>, key: K, value: V): void {
  const group = groups.get(key);
  if (group === undefined) groups.set(key, [value]);
  else group.push(value);
}

/** The feed engine without Nest: leader election, source selection, connection, reconciliation and writes. */
export class FeedEngine {
  readonly elector: LeaderElector;
  readonly #deps: FeedServiceDeps;
  readonly #now: () => number;
  readonly #pinned: readonly InstrumentKey[];
  readonly #selectIntervalMs: number;
  readonly #downFallbackMs: number;
  readonly #zeroSince = new Map<InstrumentKey, number>();
  readonly #refused = new Map<InstrumentKey, number>();
  /** When each account's feed was last re-opened after a refusal. */
  readonly #reopenedAt = new Map<string, number>();
  #active: Active | undefined;
  #session: AbortController | undefined;
  #timer: NodeJS.Timeout | undefined;
  #supervising: Promise<void> | undefined;
  #reconciling: Promise<void> | undefined;
  #lastSelectAt = Number.NEGATIVE_INFINITY;
  #poked = false;
  /** While nothing is connected: the earliest next attempt, and the failed attempts so far (paper). */
  #retryAt = 0;
  #attempts = 0;
  #reason: string | null = null;
  #since = 0;
  /** The broker whose `feed:status:<BROKER>` the leader writes. */
  #statusBroker: string | undefined;

  constructor(deps: FeedServiceDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#pinned = deps.pinned ?? PINNED_KEYS;
    this.#selectIntervalMs = deps.selectIntervalMs ?? SELECT_INTERVAL_MS;
    this.#downFallbackMs = deps.downFallbackMs ?? DOWN_FALLBACK_MS;
    this.elector = new LeaderElector(
      deps.lockStore,
      redisKeys.feedLock(FEED_LOCK_NAME),
      deps.owner ?? `${hostname()}:${String(process.pid)}:${randomUUID()}`,
      {
        onElected: () => {
          this.#lead();
        },
        onDeposed: () => this.#stepDown(),
        onError: (error, phase) => {
          deps.logger.warn({ err: error, phase }, "feed leader election error");
        },
      },
      deps.lock,
    );
  }

  get isLeader(): boolean {
    return this.elector.isLeader;
  }

  /** The source driving the feed now (undefined while nothing is connected). */
  get source(): FeedTarget | undefined {
    return this.#active?.conn.target;
  }

  /** Why the feed isn't on a broker (or why the broker failed), or null. */
  get reason(): string | null {
    return this.#reason;
  }

  /** The current connection's tick writer (tests, diagnostics). */
  get writer(): TickWriter | undefined {
    return this.#active?.writer;
  }

  /** The feed's current subscriptions (empty when not leading). */
  subscribedKeys(): InstrumentKey[] {
    return [...(this.#active?.conn.feed.subscriptions().keys() ?? [])];
  }

  /** The current subscriptions with their modes. */
  subscriptionModes(): ReadonlyMap<InstrumentKey, FeedMode> {
    return this.#active?.conn.feed.subscriptions() ?? new Map();
  }

  get feedStatus(): FeedStatus | "none" {
    return this.#active?.conn.feed.status ?? "none";
  }

  start(): void {
    this.elector.start();
  }

  async stop(): Promise<void> {
    await this.elector.stop();
  }

  /** Something changed (an account, the instrument master): choose the source again soon. */
  poke(): void {
    this.#poked = true;
    if (this.isLeader) void this.supervise();
  }

  /** One source check (serialised). Exposed for tests. */
  supervise(): Promise<void> {
    this.#supervising ??= this.#superviseOnce().finally(() => {
      this.#supervising = undefined;
    });
    return this.#supervising;
  }

  /** One reconciliation pass (serialised). Exposed for tests. */
  reconcile(): Promise<void> {
    this.#reconciling ??= this.#reconcileOnce().finally(() => {
      this.#reconciling = undefined;
    });
    return this.#reconciling;
  }

  #lead(): void {
    this.#deps.logger.info({ mode: this.#deps.selector.mode }, "elected market feed leader");
    this.#session = new AbortController();
    this.#zeroSince.clear();
    this.#refused.clear();
    this.#lastSelectAt = Number.NEGATIVE_INFINITY;
    this.#retryAt = 0;
    this.#attempts = 0;
    this.#timer = setInterval(() => {
      if (this.#shouldSupervise()) void this.supervise();
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
    this.#timer.unref();
    void this.supervise();
  }

  async #stepDown(): Promise<void> {
    this.#deps.logger.info({}, "market feed leader stepping down");
    this.#session?.abort();
    this.#session = undefined;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#supervising;
    await this.#reconciling;
    await this.#closeActive();
  }

  #shouldSupervise(): boolean {
    const now = this.#now();
    if (this.#poked) return true;
    const active = this.#active;
    if (active === undefined) return now >= this.#retryAt;
    if (this.#isFailing(active)) return true;
    return this.#deps.selector.mode !== "paper" && now - this.#lastSelectAt >= this.#selectIntervalMs;
  }

  #isDownTooLong(active: Active, now: number): boolean {
    return (
      active.conn.target.broker !== "PAPER" &&
      active.downSince !== undefined &&
      now - active.downSince >= this.#downFallbackMs
    );
  }

  async #superviseOnce(): Promise<void> {
    const session = this.#session;
    if (session === undefined || !this.isLeader) return;
    const signal = session.signal;
    this.#poked = false;
    this.#lastSelectAt = this.#now();
    const failing = this.#active;
    if (failing !== undefined && this.#isFailing(failing)) {
      if (await this.#recover(failing, signal)) return;
    }
    let decision: FeedDecision;
    try {
      decision = await this.#deps.selector.select();
    } catch (error: unknown) {
      this.#deps.logger.warn({ err: error }, "could not choose the market feed source");
      if (this.#active !== undefined || this.#deps.selector.mode !== "auto") return;
      decision = { target: PAPER_TARGET, reason: "Can't check the broker accounts; retrying" };
    }
    if (isAborted(signal)) return;
    const current = this.#active;
    if (current !== undefined && sameTarget(current.conn.target, decision.target)) {
      if (decision.target.broker === "PAPER" && decision.reason !== this.#reason) {
        this.#reason = decision.reason;
        await this.#writeSource(current.conn.target);
      }
      return;
    }
    const blockedUntil = this.#deps.selector.blockedUntil(decision.target);
    if (blockedUntil !== undefined) {
      this.#retryAt = blockedUntil;
      if (this.#active === undefined) {
        // An explicit source waiting out its backoff: say so (never falls back to simulated prices).
        this.#reason = this.#deps.selector.failureReason(decision.target) ?? this.#reason;
        this.#statusBroker = decision.target.broker;
        await this.#writeSource(decision.target);
        await this.#writeStatus("down");
      }
      return;
    }
    await this.#switchTo(decision, signal);
  }

  /** A broker feed that reported a refusal while down, or stayed down too long: it won't recover by itself. */
  #isFailing(active: Active): boolean {
    if (active.conn.target.broker === "PAPER") return false;
    const status = active.conn.feed.status;
    return (active.fatal !== undefined && !isUp(status)) || this.#isDownTooLong(active, this.#now());
  }

  /**
   * Handles a failing broker feed. A token refusal re-opens the feed once with fresh credentials from the vault (a
   * renewed token); anything else, or a second refusal soon after, is a failure: the account waits out a backoff,
   * NEEDS_RELOGIN flags it, and the source is chosen again (`auto` falls back to the simulator). True when handled
   * here (re-opened), false to go on choosing.
   */
  async #recover(active: Active, signal: AbortSignal): Promise<boolean> {
    const target = active.conn.target;
    if (target.broker === "PAPER") return false;
    const now = this.#now();
    const error = active.fatal;
    const refused = isBrokerError(error) && error.code === "NEEDS_RELOGIN";
    const lastReopen = this.#reopenedAt.get(target.accountId);
    if (refused && (lastReopen === undefined || now - lastReopen >= REOPEN_WINDOW_MS)) {
      this.#reopenedAt.set(target.accountId, now);
      this.#deps.logger.warn(
        { broker: target.broker },
        "the broker closed the market feed; re-opening with fresh credentials",
      );
      await this.#closeActive();
      await this.#switchTo({ target, reason: null }, signal);
      return true;
    }
    const reason = error === undefined ? lostFeedReason(target.broker) : connectFailureReason(target.broker, error);
    this.#deps.logger.warn({ err: error, broker: target.broker }, "market feed failed; choosing the source again");
    this.#deps.selector.recordFailure(target, reason);
    this.#reason = reason;
    if (refused) await this.#flagRefused(target);
    await this.#closeActive();
    return false;
  }

  async #flagRefused(target: Exclude<FeedTarget, { broker: "PAPER" }>): Promise<void> {
    if (this.#deps.onRefused === undefined) return;
    try {
      await this.#deps.onRefused(target);
    } catch (error: unknown) {
      this.#deps.logger.warn({ err: error, broker: target.broker }, "could not flag the feed account");
    }
  }

  async #switchTo(decision: FeedDecision, signal: AbortSignal): Promise<void> {
    const { target } = decision;
    // The gateway keeps one feed per broker: another account of the same broker needs the current one closed first.
    if (this.#active !== undefined && this.#active.conn.target.broker === target.broker) await this.#closeActive();
    let conn: FeedConnection;
    try {
      conn = await this.#deps.connector.connect(target, signal);
    } catch (error: unknown) {
      if (!isAborted(signal)) await this.#connectFailed(target, error, signal);
      return;
    }
    if (isAborted(signal)) {
      await closeQuietly(conn);
      return;
    }
    this.#attempts = 0;
    this.#retryAt = 0;
    this.#deps.selector.recordSuccess(target);
    const replaced = this.#detach();
    this.#attach(conn, signal);
    this.#since = this.#now();
    this.#reason = decision.reason;
    this.#deps.logger.info({ broker: target.broker, reason: decision.reason }, "market feed connected");
    await this.#writeSource(target);
    if (replaced !== undefined) await this.#close(replaced);
    if (target.broker !== "PAPER" && (replaced === undefined || replaced.conn.target.broker === "PAPER")) {
      await this.#deps.purge.goLive();
    }
    await this.reconcile();
  }

  async #connectFailed(target: FeedTarget, error: unknown, signal: AbortSignal): Promise<void> {
    const now = this.#now();
    if (target.broker === "PAPER") {
      this.#attempts += 1;
      const delayMs = backoffDelayMs(
        this.#attempts,
        this.#deps.random === undefined ? {} : { random: this.#deps.random },
      );
      this.#retryAt = now + delayMs;
      this.#deps.logger.warn(
        { err: error, broker: "PAPER", attempt: this.#attempts, delayMs },
        "market feed connect failed",
      );
      this.#statusBroker ??= "PAPER";
      if (this.#active === undefined) await this.#writeStatus("down");
      return;
    }
    const reason = connectFailureReason(target.broker, error);
    this.#deps.selector.recordFailure(target, reason);
    this.#deps.logger.warn({ err: error, broker: target.broker }, "market feed connect failed");
    if (isBrokerError(error) && error.code === "NEEDS_RELOGIN") await this.#flagRefused(target);
    const current = this.#active;
    if (current !== undefined) {
      // Keep what runs. On the simulator, say why it isn't live; a live broker needs no explanation.
      if (current.conn.target.broker === "PAPER") {
        this.#reason = reason;
        await this.#writeSource(current.conn.target);
      }
      return;
    }
    this.#reason = reason;
    if (this.#deps.selector.mode === "auto") {
      await this.#switchTo({ target: PAPER_TARGET, reason }, signal);
      return;
    }
    this.#retryAt = this.#deps.selector.blockedUntil(target) ?? now;
    this.#statusBroker = target.broker;
    this.#since = now;
    await this.#writeSource(target);
    await this.#writeStatus("down");
  }

  #attach(conn: FeedConnection, signal: AbortSignal): void {
    const writer = new TickWriter(this.#deps.redis, conn.target.broker, this.#deps.logger, this.#now);
    const active: Active = {
      conn,
      writer,
      listeners: [],
      downSince: isUp(conn.feed.status) ? undefined : this.#now(),
      fatal: undefined,
      attachedAt: this.#now(),
    };
    const failing = (): void => {
      if (this.#active === active && this.#isFailing(active) && !signal.aborted) {
        this.#poked = true;
        void this.supervise();
      }
    };
    active.listeners = [
      conn.feed.on("tick", (tick) => {
        writer.push(tick);
      }),
      conn.feed.on("status", (status) => {
        active.downSince = isUp(status) ? undefined : (active.downSince ?? this.#now());
        if (status === "up") active.fatal = undefined;
        if (this.#active !== active) return;
        void this.#writeStatus(status);
        if (status === "down") failing();
        // Closed under us (not by a switch or stepDown, which detach first): connect again.
        if (status === "closed" && !signal.aborted) {
          this.#detach();
          void writer.drain();
          this.#poked = true;
          void this.supervise();
        }
      }),
      conn.feed.on("error", (error) => {
        this.#deps.logger.debug({ err: error, broker: conn.target.broker }, "market feed error");
        // A refused token, or a refusal while disconnected (Dhan 806–810): the feed stops reconnecting by itself.
        const refusal =
          isBrokerError(error) &&
          (error.code === "NEEDS_RELOGIN" || (error.code === "BROKER_REJECTED" && !isUp(conn.feed.status)));
        if (!refusal) return;
        active.fatal = error;
        failing();
      }),
    ];
    this.#active = active;
    this.#statusBroker = conn.target.broker;
  }

  /** Stops listening to the current connection (still open) and returns it. */
  #detach(): Active | undefined {
    const active = this.#active;
    if (active === undefined) return undefined;
    for (const off of active.listeners) off();
    active.listeners = [];
    this.#active = undefined;
    return active;
  }

  async #close(active: Active): Promise<void> {
    await closeQuietly(active.conn, this.#deps.logger);
    await active.writer.drain();
  }

  async #closeActive(): Promise<void> {
    const active = this.#detach();
    if (active === undefined) return;
    await this.#close(active);
    await this.#writeStatus("down", active.conn.target.broker);
  }

  async #reconcileOnce(): Promise<void> {
    const active = this.#active;
    if (active === undefined || !this.isLeader) return;
    const { conn } = active;
    try {
      const desired = await this.#desiredKeys();
      const now = this.#now();
      const candidates = desired.filter((key) => (this.#refused.get(key) ?? 0) <= now);
      const mapped = await conn.mapKeys(candidates);
      if (this.#active !== active) return;
      const streamable = candidates.filter((key) => mapped.has(key));
      const plan = planModes(streamable.length, conn.capacity, conn.limits);
      const modes = new Map<InstrumentKey, FeedMode>();
      for (const [index, key] of streamable.entries()) {
        if (index < plan.full) modes.set(key, "full");
        else if (index < plan.full + plan.ltp) modes.set(key, "ltp");
      }
      const current = conn.feed.subscriptions();
      const toRemove = [...current.keys()].filter((key) => !modes.has(key));
      const toAdd = new Map<FeedMode, InstrumentKey[]>();
      for (const [key, mode] of modes) if (current.get(key) !== mode) push(toAdd, mode, key);
      for (let index = 0; index < toRemove.length; index += SUBSCRIBE_CHUNK) {
        await conn.feed.unsubscribe(toRemove.slice(index, index + SUBSCRIBE_CHUNK));
      }
      // `ltp` first: keys moving down from `full` free full-mode room before any key moves up.
      for (const mode of ["ltp", "quote", "full"] as const) {
        const keys = toAdd.get(mode) ?? [];
        for (let index = 0; index < keys.length; index += SUBSCRIBE_CHUNK) {
          await this.#subscribe(active, keys.slice(index, index + SUBSCRIBE_CHUNK), mode);
        }
      }
      if (toAdd.size > 0 || toRemove.length > 0) {
        this.#deps.logger.debug(
          {
            broker: conn.target.broker,
            added: [...toAdd.values()].reduce((sum, keys) => sum + keys.length, 0),
            removed: toRemove.length,
            unmapped: candidates.length - mapped.size,
          },
          "market feed subscriptions reconciled",
        );
      }
      if (this.#active === active) await this.#writeStatus(conn.feed.status);
    } catch (error: unknown) {
      this.#deps.logger.warn({ err: error, broker: conn.target.broker }, "market feed reconcile failed");
    }
  }

  /** Subscribes `keys`; when the broker refuses the batch, finds the keys it refuses one by one and skips them. */
  async #subscribe(active: Active, keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    try {
      await active.conn.feed.subscribe(keys, mode);
    } catch (error: unknown) {
      if (this.#active !== active || active.conn.feed.status === "closed") return;
      const [only] = keys;
      if (keys.length === 1 && only !== undefined) {
        this.#refused.set(only, this.#now() + REFUSED_KEY_MS);
        this.#deps.logger.debug({ err: error, broker: active.conn.target.broker }, "market feed refused a key");
        return;
      }
      for (const key of keys) await this.#subscribe(active, [key], mode);
    }
  }

  /** The pinned keys, then the wanted ones (sorted) minus those whose grace ran out (dropped from the set here). */
  async #desiredKeys(): Promise<InstrumentKey[]> {
    const wanted = (await this.#deps.redis.smembers(redisKeys.subscriptionsWanted())).filter(
      (key): key is InstrumentKey => isInstrumentKey(key),
    );
    const counts =
      wanted.length === 0 ? [] : await this.#deps.redis.mget(wanted.map((key) => redisKeys.subscriptions(key)));
    const now = this.#now();
    const kept: InstrumentKey[] = [];
    const seen = new Set<InstrumentKey>();
    for (const [index, key] of wanted.entries()) {
      seen.add(key);
      const count = Number(counts[index] ?? "0");
      if (count > 0) {
        this.#zeroSince.delete(key);
        kept.push(key);
        continue;
      }
      const since = this.#zeroSince.get(key) ?? now;
      this.#zeroSince.set(key, since);
      if (now - since >= this.#deps.graceMs && (await this.#deps.releaseIdle(key))) {
        this.#zeroSince.delete(key);
        continue;
      }
      kept.push(key);
    }
    for (const key of this.#zeroSince.keys()) if (!seen.has(key)) this.#zeroSince.delete(key);
    const pinned = new Set(this.#pinned);
    return [...this.#pinned, ...kept.filter((key) => !pinned.has(key)).sort()];
  }

  async #writeSource(target: FeedTarget): Promise<void> {
    try {
      await this.#deps.redis.hset(
        redisKeys.feedSource(),
        feedSourceHash({
          broker: target.broker,
          live: target.broker !== "PAPER",
          accountId: target.broker === "PAPER" ? null : target.accountId,
          since: this.#since,
          reason: this.#reason,
        }),
      );
    } catch (error: unknown) {
      this.#deps.logger.warn({ err: error }, "could not record the market feed source");
    }
  }

  async #writeStatus(status: FeedStatus, broker = this.#statusBroker): Promise<void> {
    if (broker === undefined) return;
    try {
      await this.#deps.redis.set(
        redisKeys.feedStatus(broker),
        encodeFeedStatus({ status, ts: this.#now(), lastTickAt: this.#active?.writer.lastTickAt ?? null }),
        "PX",
        FEED_STATUS_TTL_MS,
      );
    } catch {
      // Best effort: readers take a missing status as "down".
    }
  }
}

/** Up for the "down too long" check: `degraded` is connected, only late. */
function isUp(status: FeedStatus): boolean {
  return status === "up" || status === "degraded";
}

async function closeQuietly(conn: FeedConnection, logger?: Pick<FeedLogger, "warn">): Promise<void> {
  try {
    await conn.feed.close();
  } catch (error: unknown) {
    logger?.warn({ err: error, broker: conn.target.broker }, "market feed close failed");
  }
}

/** DI token for the {@link FeedSourceSelector}. */
export const FEED_SELECTION = Symbol("FEED_SELECTION");

/** The Nest wrapper: one {@link FeedEngine}, started after bootstrap and poked by domain events. */
@Injectable()
export class FeedService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly engine: FeedEngine;
  readonly purge: MarketDataPurge;

  constructor(
    config: ConfigService<Env, true>,
    redis: RedisService,
    prisma: PrismaService,
    @Inject(FEED_CONNECTOR) connector: FeedConnector,
    @Inject(FEED_SELECTION) selector: FeedSourceSelector,
    @Inject(FEED_ACCOUNT_ACCESS) access: FeedAccountAccess,
    logger: PinoLogger,
  ) {
    logger.setContext(FeedService.name);
    const releaseIdle: RedisScript = redis.defineScript({
      name: "feedReleaseIdle",
      numberOfKeys: 2,
      lua: RELEASE_IDLE_LUA,
    });
    const purgeQuote: RedisScript = redis.defineScript({
      name: "feedPurgeSimulatedQuote",
      numberOfKeys: 2,
      lua: PURGE_SIMULATED_QUOTE_LUA,
    });
    this.purge = new MarketDataPurge(
      redis.client,
      purgeQuote,
      { deleteAll: async () => (await prisma.db.candle.deleteMany({})).count },
      logger,
      { purgeCandles: config.get("NODE_ENV", { infer: true }) !== "production" },
    );
    this.engine = new FeedEngine({
      connector,
      selector,
      redis: redis.client as unknown as FeedRedis,
      lockStore: new RedisLockStore(redis),
      releaseIdle: async (key) =>
        (await releaseIdle([redisKeys.subscriptions(key), redisKeys.subscriptionsWanted()], [key])) === 1,
      purge: this.purge,
      onRefused: (target) => access.markNeedsRelogin(target.accountId),
      graceMs: config.get("RT_UNSUB_GRACE_MS", { infer: true }),
      logger,
    });
  }

  onApplicationBootstrap(): void {
    this.engine.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.engine.stop();
  }

  /** An account was activated or deactivated, or an instrument master synced: the best source may have changed. */
  @OnEvent(FEED_EVENTS.brokerAccountActivated)
  @OnEvent(FEED_EVENTS.brokerAccountDeactivated)
  @OnEvent(FEED_EVENTS.instrumentsSynced)
  onSourceHint(): void {
    this.engine.poke();
  }
}
