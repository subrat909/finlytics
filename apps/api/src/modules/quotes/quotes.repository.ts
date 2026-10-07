/**
 * The `quote:<instrumentKey>` hashes and `depth:<instrumentKey>` books the feed worker writes (plan "Redis keys"), and
 * whether a key names an active instrument (reference data, no owner).
 */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class QuotesRepository {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** The raw hash of each key, in order (`{}` for a key without a quote). A Redis error rejects. */
  async hashes(keys: readonly string[]): Promise<Record<string, string>[]> {
    if (keys.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const key of keys) pipeline.hgetall(redisKeys.quote(key));
    const replies = (await pipeline.exec()) ?? [];
    return replies.map(([error, value]) => {
      if (error !== null) throw error;
      return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
    });
  }

  /** The stored book of `key` (JSON), or null. */
  depth(key: string): Promise<string | null> {
    return this.redis.client.get(redisKeys.depth(key));
  }

  /** Whether `key` names an active instrument (primary key lookup). */
  async isActiveInstrument(key: string): Promise<boolean> {
    const row = await this.prisma.db.instrument.findFirst({ where: { key, isActive: true }, select: { key: true } });
    return row !== null;
  }
}
