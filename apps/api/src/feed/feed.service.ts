/**
 * The shared market feed (phase 1 plan P2, backend.md "Realtime pipeline"): ONE broker market WebSocket per broker for
 * the whole platform, run by whichever `feed` process holds `lock:feed:<BROKER>`.
 *
 * As leader it:
 * - connects through the configured {@link FeedConnector} (paper simulator or Upstox), reconnecting with capped,
 *   jittered backoff when the connection fails or closes, and re-subscribing everything after a reconnect;
 * - reconciles its subscriptions with `subs:wanted:<BROKER>` every second: keys the gateways want are subscribed; a
 *   key whose ref-count `subs:<key>` has stayed at 0 for RT_UNSUB_GRACE_MS is dropped from the set atomically and
 *   unsubscribed;
 * - writes every tick to `ticks:<BROKER>`, `quote:<key>` and `q:<key>` (TickWriter);
 * - reports its state in `feed:status:<BROKER>` (`{status, ts}`, PX 15 s, refreshed every second) for the gateways.
 *
 * Losing the lock (or shutdown) closes the connection at once.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { backoffDelayMs } from "@finlytics/broker-sdk";
import type { FeedStatus, MarketFeed, Unsubscribe } from "@finlytics/broker-sdk";
import { isInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";

import type { Env } from "../config/env.schema";
import { redisKeys } from "../infra/redis/keys";
import { RedisService } from "../infra/redis/redis.service";
import type { RedisScript } from "../infra/redis/redis.service";

import { FEED_CONNECTOR } from "./feed-connector";
import type { FeedConnector } from "./feed-connector";
import { LeaderElector, RedisLockStore } from "./leader-lock";
import type { LockStore } from "./leader-lock";
import { TickWriter } from "./tick-writer";
import type { TickWriterTarget } from "./tick-writer";

/** How often the leader reconciles subscriptions and refreshes its status. */
export const RECONCILE_INTERVAL_MS = 1_000;

/** How long `feed:status:<BROKER>` lives without a refresh. */
export const FEED_STATUS_TTL_MS = 15_000;

/** Keys per subscribe/unsubscribe request to the broker. */
const SUBSCRIBE_CHUNK = 500;

/** The mode every instrument is subscribed in: LTP, previous close, volume and the top of book. */
const FEED_MODE = "quote";

/**
 * Drops an idle key atomically: when `subs:<key>` is still at or below 0, delete it and remove the key from
 * `subs:wanted:<BROKER>`. 1 = dropped, 0 = someone subscribed again.
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

/** The Redis calls the service makes, so tests can pass a fake. */
export interface FeedRedis extends TickWriterTarget {
  smembers(key: string): Promise<string[]>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, px: "PX", ttlMs: number): Promise<unknown>;
}

export interface FeedServiceDeps {
  readonly broker: string;
  readonly connector: FeedConnector;
  readonly redis: FeedRedis;
  readonly lockStore: LockStore;
  readonly releaseIdle: (key: InstrumentKey) => Promise<boolean>;
  readonly graceMs: number;
  readonly logger: Pick<PinoLogger, "info" | "warn" | "error" | "debug">;
  readonly owner?: string;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly lock?: { ttlMs: number; renewMs: number };
}

/** `signal.aborted`, read through a call: it changes across awaits, which flow analysis can't see. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** The feed engine without Nest: leader election, connection, reconciliation and writes. */
export class FeedEngine {
  readonly writer: TickWriter;
  readonly elector: LeaderElector;
  readonly #deps: FeedServiceDeps;
  readonly #now: () => number;
  readonly #zeroSince = new Map<InstrumentKey, number>();
  #feed: MarketFeed | undefined;
  #feedListeners: Unsubscribe[] = [];
  #session: AbortController | undefined;
  #reconcileTimer: NodeJS.Timeout | undefined;
  #reconciling: Promise<void> | undefined;
  #connecting: Promise<void> | undefined;

  constructor(deps: FeedServiceDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.writer = new TickWriter(deps.redis, deps.broker, deps.logger, this.#now);
    this.elector = new LeaderElector(
      deps.lockStore,
      redisKeys.feedLock(deps.broker),
      deps.owner ?? `${hostname()}:${String(process.pid)}:${randomUUID()}`,
      {
        onElected: () => {
          this.#lead();
        },
        onDeposed: () => this.#stepDown(),
        onError: (error, phase) => {
          deps.logger.warn({ err: error, phase, broker: deps.broker }, "feed leader election error");
        },
      },
      deps.lock,
    );
  }

  get isLeader(): boolean {
    return this.elector.isLeader;
  }

  /** The feed's current subscriptions (empty when not leading). */
  subscribedKeys(): InstrumentKey[] {
    return [...(this.#feed?.subscriptions().keys() ?? [])];
  }

  get feedStatus(): FeedStatus | "none" {
    return this.#feed?.status ?? "none";
  }

  start(): void {
    this.elector.start();
  }

  async stop(): Promise<void> {
    await this.elector.stop();
    await this.writer.drain();
  }

  /** One reconciliation pass (serialised). Exposed for tests. */
  reconcile(): Promise<void> {
    this.#reconciling ??= this.#reconcileOnce().finally(() => {
      this.#reconciling = undefined;
    });
    return this.#reconciling;
  }

  #lead(): void {
    this.#deps.logger.info({ broker: this.#deps.broker }, "elected market feed leader");
    this.#session = new AbortController();
    this.#zeroSince.clear();
    this.#connecting = this.#connectLoop(this.#session.signal);
    this.#reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
    this.#reconcileTimer.unref();
  }

  async #stepDown(): Promise<void> {
    this.#deps.logger.info({ broker: this.#deps.broker }, "market feed leader stepping down");
    this.#session?.abort();
    this.#session = undefined;
    if (this.#reconcileTimer !== undefined) clearInterval(this.#reconcileTimer);
    this.#reconcileTimer = undefined;
    await this.#connecting;
    await this.#reconciling;
    await this.#closeFeed();
    await this.#writeStatus("down");
  }

  /** Connects, retrying with backoff until connected or the session ends. */
  async #connectLoop(signal: AbortSignal): Promise<void> {
    for (let attempt = 1; !signal.aborted && this.#feed === undefined; attempt += 1) {
      try {
        const feed = await this.#deps.connector.connect(signal);
        if (isAborted(signal)) {
          await feed.close();
          return;
        }
        this.#attach(feed, signal);
        this.#deps.logger.info({ broker: this.#deps.broker }, "market feed connected");
        await this.reconcile();
        return;
      } catch (error: unknown) {
        const delayMs = backoffDelayMs(attempt, this.#deps.random === undefined ? {} : { random: this.#deps.random });
        this.#deps.logger.warn(
          { err: error, broker: this.#deps.broker, attempt, delayMs },
          "market feed connect failed",
        );
        await this.#writeStatus("down");
        await pause(delayMs, signal);
      }
    }
  }

  #attach(feed: MarketFeed, signal: AbortSignal): void {
    this.#feed = feed;
    this.#feedListeners = [
      feed.on("tick", (tick) => {
        this.writer.push(tick);
      }),
      feed.on("status", (status) => {
        void this.#writeStatus(status);
        // Closed under us (not by stepDown, which detaches first): connect again, then re-subscribe everything.
        if (status === "closed" && this.#feed === feed && !signal.aborted) {
          this.#detach();
          this.#connecting = this.#connectLoop(signal);
        }
      }),
      feed.on("error", (error) => {
        this.#deps.logger.debug({ err: error, broker: this.#deps.broker }, "market feed error");
      }),
    ];
  }

  #detach(): MarketFeed | undefined {
    const feed = this.#feed;
    for (const off of this.#feedListeners) off();
    this.#feedListeners = [];
    this.#feed = undefined;
    return feed;
  }

  async #closeFeed(): Promise<void> {
    const feed = this.#detach();
    try {
      await feed?.close();
    } catch (error: unknown) {
      this.#deps.logger.warn({ err: error, broker: this.#deps.broker }, "market feed close failed");
    }
  }

  async #reconcileOnce(): Promise<void> {
    const feed = this.#feed;
    if (feed === undefined || !this.elector.isLeader) return;
    try {
      const desired = await this.#desiredKeys();
      if (this.#feed !== feed) return;
      const current = new Set(feed.subscriptions().keys());
      const toAdd = [...desired].filter((key) => !current.has(key));
      const toRemove = [...current].filter((key) => !desired.has(key));
      for (let index = 0; index < toRemove.length; index += SUBSCRIBE_CHUNK) {
        await feed.unsubscribe(toRemove.slice(index, index + SUBSCRIBE_CHUNK));
      }
      for (let index = 0; index < toAdd.length; index += SUBSCRIBE_CHUNK) {
        await feed.subscribe(toAdd.slice(index, index + SUBSCRIBE_CHUNK), FEED_MODE);
      }
      if (toAdd.length > 0 || toRemove.length > 0) {
        this.#deps.logger.debug(
          { broker: this.#deps.broker, added: toAdd.length, removed: toRemove.length },
          "market feed subscriptions reconciled",
        );
      }
      await this.#writeStatus(feed.status);
    } catch (error: unknown) {
      this.#deps.logger.warn({ err: error, broker: this.#deps.broker }, "market feed reconcile failed");
    }
  }

  /** The wanted keys, minus the ones whose grace ran out (dropped from the set here). */
  async #desiredKeys(): Promise<Set<InstrumentKey>> {
    const wanted = (await this.#deps.redis.smembers(redisKeys.subscriptionsWanted(this.#deps.broker))).filter(
      (key): key is InstrumentKey => isInstrumentKey(key),
    );
    const counts =
      wanted.length === 0 ? [] : await this.#deps.redis.mget(wanted.map((key) => redisKeys.subscriptions(key)));
    const now = this.#now();
    const desired = new Set<InstrumentKey>();
    const seen = new Set<InstrumentKey>();
    for (const [index, key] of wanted.entries()) {
      seen.add(key);
      const count = Number(counts[index] ?? "0");
      if (count > 0) {
        this.#zeroSince.delete(key);
        desired.add(key);
        continue;
      }
      const since = this.#zeroSince.get(key) ?? now;
      this.#zeroSince.set(key, since);
      if (now - since >= this.#deps.graceMs && (await this.#deps.releaseIdle(key))) {
        this.#zeroSince.delete(key);
        continue;
      }
      desired.add(key);
    }
    for (const key of this.#zeroSince.keys()) if (!seen.has(key)) this.#zeroSince.delete(key);
    return desired;
  }

  async #writeStatus(status: FeedStatus): Promise<void> {
    try {
      await this.#deps.redis.set(
        redisKeys.feedStatus(this.#deps.broker),
        JSON.stringify({ status, ts: this.#now() }),
        "PX",
        FEED_STATUS_TTL_MS,
      );
    } catch {
      // Best effort: gateways read a missing status as "down".
    }
  }
}

/** The Nest wrapper: one {@link FeedEngine} for the configured source, started after bootstrap. */
@Injectable()
export class FeedService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly engine: FeedEngine;

  constructor(
    config: ConfigService<Env, true>,
    redis: RedisService,
    @Inject(FEED_CONNECTOR) connector: FeedConnector,
    logger: PinoLogger,
  ) {
    logger.setContext(FeedService.name);
    const releaseIdle: RedisScript = redis.defineScript({
      name: "feedReleaseIdle",
      numberOfKeys: 2,
      lua: RELEASE_IDLE_LUA,
    });
    const broker = connector.broker;
    this.engine = new FeedEngine({
      broker,
      connector,
      redis: redis.client as unknown as FeedRedis,
      lockStore: new RedisLockStore(redis),
      releaseIdle: async (key) =>
        (await releaseIdle([redisKeys.subscriptions(key), redisKeys.subscriptionsWanted(broker)], [key])) === 1,
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
}
