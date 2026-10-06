/** The `quote:<instrumentKey>` hashes the feed worker writes (plan "Redis keys"), read in one pipeline. */
import { Injectable } from "@nestjs/common";

import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class QuotesRepository {
  constructor(private readonly redis: RedisService) {}

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
}
