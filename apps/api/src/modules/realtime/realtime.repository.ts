/**
 * Storage for the realtime gateway: subscription ref-counts in Redis (phase 1 plan "Redis keys"), the quote snapshot a
 * new subscriber gets, the feed's reported status, and two reads from PostgreSQL (the user's plan limit, which keys
 * name active instruments).
 *
 * - `subs:<key>` counts subscriptions across every gateway pod. Acquire increments it and adds the key to
 *   `subs:wanted:<BROKER>` in one script; release decrements it, never below 0. At 0 the feed leader waits
 *   RT_UNSUB_GRACE_MS, then drops the key from the set atomically and unsubscribes (feed/feed.service.ts).
 * - Instrument and Plan are reference data (unowned models): no user scoping applies to them. The plan limit is read
 *   through the signed-in user's own row (`where: { id: userId }`).
 */
import { isInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { quoteFromHash } from "../../feed/quote-update";
import type { QuoteUpdate } from "../../feed/quote-update";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import type { RedisScript } from "../../infra/redis/redis.service";

/** `Plan.maxRtSubscriptions`'s default, for users without a plan. */
export const DEFAULT_MAX_RT_SUBSCRIPTIONS = 100;

const ACQUIRE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count < 1 then
  redis.call('SET', KEYS[1], 1)
  count = 1
end
redis.call('SADD', KEYS[2], ARGV[1])
return count
`;

const RELEASE_LUA = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 1 then
  return redis.call('DECR', KEYS[1])
end
if count == 1 then
  redis.call('SET', KEYS[1], 0)
end
return 0
`;

/** The feed leader's last report (`feed:status:<BROKER>`). */
export interface ReportedFeedStatus {
  readonly status: string;
  readonly ts: number;
}

@Injectable()
export class RealtimeRepository {
  readonly #acquire: RedisScript;
  readonly #release: RedisScript;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.#acquire = redis.defineScript({ name: "rtSubsAcquire", numberOfKeys: 2, lua: ACQUIRE_LUA });
    this.#release = redis.defineScript({ name: "rtSubsRelease", numberOfKeys: 1, lua: RELEASE_LUA });
  }

  /** +1 on each key's ref-count, and marks it wanted by `broker`'s feed. */
  async acquire(broker: string, keys: readonly InstrumentKey[]): Promise<void> {
    const wanted = redisKeys.subscriptionsWanted(broker);
    await Promise.all(keys.map((key) => this.#acquire([redisKeys.subscriptions(key), wanted], [key])));
  }

  /** −1 on each key's ref-count (never below 0). */
  async release(keys: readonly InstrumentKey[]): Promise<void> {
    await Promise.all(keys.map((key) => this.#release([redisKeys.subscriptions(key)], [])));
  }

  /** The latest stored quote of each key that has one. */
  async snapshots(keys: readonly InstrumentKey[]): Promise<QuoteUpdate[]> {
    if (keys.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const key of keys) pipeline.hgetall(redisKeys.quote(key));
    const replies = (await pipeline.exec()) ?? [];
    const updates: QuoteUpdate[] = [];
    for (const [index, [error, hash]] of replies.entries()) {
      const key = keys[index];
      if (error !== null || key === undefined || typeof hash !== "object" || hash === null) continue;
      const update = quoteFromHash(key, hash as Record<string, string>);
      if (update !== undefined) updates.push(update);
    }
    return updates;
  }

  /** What the feed leader last reported, or undefined (missing, expired or malformed). */
  async feedStatus(broker: string): Promise<ReportedFeedStatus | undefined> {
    const raw = await this.redis.client.get(redisKeys.feedStatus(broker));
    if (raw === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return undefined;
      const { status, ts } = parsed as Record<string, unknown>;
      return typeof status === "string" && typeof ts === "number" ? { status, ts } : undefined;
    } catch {
      return undefined;
    }
  }

  /** The user's `Plan.maxRtSubscriptions`, or the default without a plan. */
  async maxSubscriptions(userId: string): Promise<number> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { plan: { select: { maxRtSubscriptions: true } } },
    });
    return user?.plan?.maxRtSubscriptions ?? DEFAULT_MAX_RT_SUBSCRIPTIONS;
  }

  /** Which of `keys` name active instruments. */
  async activeInstrumentKeys(keys: readonly InstrumentKey[]): Promise<Set<InstrumentKey>> {
    if (keys.length === 0) return new Set();
    const rows = await this.prisma.db.instrument.findMany({
      where: { key: { in: [...keys] }, isActive: true },
      select: { key: true },
    });
    return new Set(rows.map((row) => row.key).filter((key): key is InstrumentKey => isInstrumentKey(key)));
  }
}
