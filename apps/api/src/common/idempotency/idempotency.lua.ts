/**
 * The idempotency record's three atomic steps (plan D8), each a Lua script on `idem:<userId>:<key>`:
 *
 * - claim: `SET NX PX` an in-flight marker, or return what the key already holds. One round trip, and no gap between
 *   the failed SET and the read in which the key could vanish.
 * - finalize: replace the marker with the completed record (24 h), only while this request still owns the key: the
 *   marker is compared byte for byte, and it holds a per-request owner token.
 * - release: delete the key, under the same ownership check.
 *
 * An expired lock (the 30 s in-flight TTL) or a released key therefore can't be overwritten or deleted by its former
 * owner.
 */
import type { RedisScriptDefinition } from "../../infra/redis/redis.service";

/** KEYS[1]: the key. ARGV[1]: this request's in-flight marker; ARGV[2]: its TTL in ms. Reply: `{1}` or `{0, value}`. */
export const IDEMPOTENCY_CLAIM_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: "finlyticsIdempotencyClaim",
  numberOfKeys: 1,
  lua: `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return { 1 } end
return { 0, redis.call('GET', KEYS[1]) }
`,
});

/** KEYS[1]: the key. ARGV[1]: the marker; ARGV[2]: the record; ARGV[3]: its TTL in ms. Reply: 1 stored, 0 not owner. */
export const IDEMPOTENCY_FINALIZE_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: "finlyticsIdempotencyFinalize",
  numberOfKeys: 1,
  lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0
`,
});

/** KEYS[1]: the key. ARGV[1]: the marker. Reply: 1 deleted, 0 not owner. */
export const IDEMPOTENCY_RELEASE_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: "finlyticsIdempotencyRelease",
  numberOfKeys: 1,
  lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`,
});
