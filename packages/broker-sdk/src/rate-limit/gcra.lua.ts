/**
 * The GCRA step (./gcra.ts) as one Lua script (plan B6): one key, one round trip, atomic, and on the Redis clock
 * (`TIME`), so clock skew between pods doesn't matter. Times are integer microseconds; the TAT is stored with `%.0f`
 * so it never turns into exponent notation. A refused request writes nothing. The key expires when the bucket is full
 * again, so an idle account leaves no key behind.
 *
 * KEYS[1]: `brl:<BROKER>:<accountId>:<class>`.
 * ARGV: the emission interval in µs, the burst, the cost (positive integers).
 * Reply: `{ allowed (1 or 0), remaining, retryAfterMs, resetAfterMs }`, all integers.
 */
import { createHash } from "node:crypto";

export const GCRA_LUA = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000000 + tonumber(time[2])
local interval = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local stored = tonumber(redis.call('GET', KEYS[1]))
local tat = now
if stored and stored > now then tat = stored end
local newTat = tat + interval * cost
local allowAt = newTat - interval * burst
if now < allowAt then
  return { 0, 0, math.ceil((allowAt - now) / 1000), math.ceil((tat - now) / 1000) }
end
redis.call('SET', KEYS[1], string.format('%.0f', newTat), 'PX', math.max(1, math.ceil((newTat - now) / 1000)))
return { 1, math.floor((now - allowAt) / interval), 0, math.ceil((newTat - now) / 1000) }
`;

/** SHA-1 of {@link GCRA_LUA}, for EVALSHA. */
export const GCRA_SHA1 = createHash("sha1").update(GCRA_LUA).digest("hex");
