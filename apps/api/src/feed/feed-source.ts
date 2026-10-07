/**
 * Which source drives the one platform market feed (phase-1b "Feed source"), as the feed leader records it and every
 * other role reads it:
 *
 * - `feed:source` hash `{broker, live, accountId, since, reason}`: rewritten by the leader on every switch (no TTL, so
 *   the last source stays known while no leader runs). `accountId` is internal (the candle backfill of users without a
 *   broker account uses it) and never leaves the api; `reason` explains a fallback in our own words.
 * - `feed:status:<broker>` (JSON `{status, ts, lastTickAt}`, PX 15 s): the leader's connection state, refreshed every
 *   second. Missing or older than 15 s reads as `down`.
 *
 * {@link FeedSourceReader} reads both (cached for a second) for the gateway's `status` event, the market overview and
 * the candle sources. Without a record yet, the configured MARKET_FEED_SOURCE stands in.
 */
import { BrokerCodeSchema } from "@finlytics/shared";
import type { BrokerCode, RtFeedState } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env, MarketFeedSource } from "../config/env.schema";
import { redisKeys } from "../infra/redis/keys";
import { RedisService } from "../infra/redis/redis.service";

/** The brokers whose market feed can drive the platform (PAPER is the simulator). */
export type LiveFeedBroker = Extract<BrokerCode, "UPSTOX" | "DHAN">;
export const LIVE_FEED_BROKERS: readonly LiveFeedBroker[] = Object.freeze(["UPSTOX", "DHAN"]);

/** What drives the feed: the simulator, or one broker account's market WebSocket. */
export type FeedTarget = { readonly broker: "PAPER" } | { readonly broker: LiveFeedBroker; readonly accountId: string };

export const PAPER_TARGET: FeedTarget = Object.freeze({ broker: "PAPER" });

/** Display names for reasons and logs. */
export const BROKER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  UPSTOX: "Upstox",
  DHAN: "Dhan",
  PAPER: "Paper",
});

export function isLiveFeedBroker(broker: string): broker is LiveFeedBroker {
  return (LIVE_FEED_BROKERS as readonly string[]).includes(broker);
}

export function sameTarget(a: FeedTarget, b: FeedTarget): boolean {
  if (a.broker !== b.broker) return false;
  return a.broker === "PAPER" || (b.broker !== "PAPER" && a.accountId === b.accountId);
}

/** The `feed:source` record. */
export interface FeedSourceRecord {
  readonly broker: BrokerCode;
  readonly live: boolean;
  readonly accountId: string | null;
  /** When this source took over, epoch ms. */
  readonly since: number;
  readonly reason: string | null;
}

/** The longest reason kept (FeedInfoSchema allows 200 characters). */
const MAX_REASON = 200;

export function feedSourceHash(record: FeedSourceRecord): Record<string, string> {
  return {
    broker: record.broker,
    live: record.live ? "1" : "0",
    accountId: record.accountId ?? "",
    since: String(record.since),
    reason: (record.reason ?? "").slice(0, MAX_REASON),
  };
}

/** A `feed:source` hash read back, or undefined when missing or malformed. */
export function parseFeedSourceHash(hash: Readonly<Record<string, string | undefined>>): FeedSourceRecord | undefined {
  const broker = BrokerCodeSchema.safeParse(hash["broker"]);
  const since = Number(hash["since"]);
  if (!broker.success || !Number.isSafeInteger(since) || since < 0) return undefined;
  const accountId = hash["accountId"] ?? "";
  const reason = hash["reason"] ?? "";
  return {
    broker: broker.data,
    live: hash["live"] === "1" && broker.data !== "PAPER",
    accountId: /^[A-Za-z0-9_-]{1,64}$/.test(accountId) ? accountId : null,
    since,
    reason: reason === "" ? null : reason.slice(0, MAX_REASON),
  };
}

/** The leader's last report (`feed:status:<broker>`). */
export interface FeedStatusReport {
  readonly status: string;
  readonly ts: number;
  readonly lastTickAt: number | null;
}

export function encodeFeedStatus(report: FeedStatusReport): string {
  return JSON.stringify(report);
}

/** A `feed:status:<broker>` value read back, or undefined (missing or malformed). */
export function parseFeedStatus(raw: string | null | undefined): FeedStatusReport | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { status, ts, lastTickAt } = parsed as Record<string, unknown>;
    if (typeof status !== "string" || typeof ts !== "number") return undefined;
    return { status, ts, lastTickAt: typeof lastTickAt === "number" ? lastTickAt : null };
  } catch {
    return undefined;
  }
}

/** A report older than this reads as `down` (the leader refreshes every second, with a 15 s TTL). */
export const STATUS_MAX_AGE_MS = 15_000;

/** No tick for this long while ticks are expected: the feed is `stale`. */
export const STALE_AFTER_MS = 5_000;

/**
 * The client-facing state of the feed: `down` without a fresh report or unless connected; `stale` while degraded, or
 * up with no tick for {@link STALE_AFTER_MS} while ticks are expected (`lastTickAt` undefined: not expected).
 */
export function feedStateOf(report: FeedStatusReport | undefined, now: number, lastTickAt?: number): RtFeedState {
  if (report === undefined || now - report.ts > STATUS_MAX_AGE_MS) return "down";
  switch (report.status) {
    case "up":
      return lastTickAt !== undefined && now - lastTickAt > STALE_AFTER_MS ? "stale" : "up";
    case "degraded":
      return "stale";
    default:
      return "down";
  }
}

/** The source and its status, as one read. */
export interface FeedSnapshot {
  readonly source: FeedSourceRecord;
  readonly status: FeedStatusReport | undefined;
}

/** The record the configured source implies before any leader wrote one. */
export function configuredSource(source: MarketFeedSource, accountId: string | undefined): FeedSourceRecord {
  if (source === "upstox" || source === "dhan") {
    return {
      broker: source === "upstox" ? "UPSTOX" : "DHAN",
      live: true,
      accountId: accountId ?? null,
      since: 0,
      reason: null,
    };
  }
  return { broker: "PAPER", live: false, accountId: null, since: 0, reason: null };
}

/** The Redis reads of {@link FeedSourceReader}. */
export interface FeedSourceRedis {
  hgetall(key: string): Promise<Record<string, string>>;
  get(key: string): Promise<string | null>;
}

/** How long one read is reused. */
const CACHE_MS = 1_000;

/** Reads `feed:source` and the matching `feed:status:<broker>`, cached for a second. */
export class FeedSourceSnapshots {
  #cached: { at: number; value: Promise<FeedSnapshot> } | undefined;

  constructor(
    private readonly redis: FeedSourceRedis,
    private readonly fallback: FeedSourceRecord,
    private readonly now: () => number = Date.now,
  ) {}

  /** The current snapshot; a Redis failure rejects (and isn't cached). */
  current(): Promise<FeedSnapshot> {
    const now = this.now();
    if (this.#cached !== undefined && now - this.#cached.at < CACHE_MS) return this.#cached.value;
    const value = this.#read();
    this.#cached = { at: now, value };
    value.catch(() => {
      if (this.#cached?.value === value) this.#cached = undefined;
    });
    return value;
  }

  async #read(): Promise<FeedSnapshot> {
    const source = parseFeedSourceHash(await this.redis.hgetall(redisKeys.feedSource())) ?? this.fallback;
    const status = parseFeedStatus(await this.redis.get(redisKeys.feedStatus(source.broker)));
    return { source, status };
  }
}

/** {@link FeedSourceSnapshots} on the api's Redis client, with MARKET_FEED_SOURCE as the fallback. */
@Injectable()
export class FeedSourceReader extends FeedSourceSnapshots {
  constructor(config: ConfigService<Env, true>, redis: RedisService) {
    super(
      redis.client,
      configuredSource(
        config.get("MARKET_FEED_SOURCE", { infer: true }),
        config.get("MARKET_FEED_ACCOUNT_ID", { infer: true }),
      ),
    );
  }
}
