/**
 * Every Redis key the platform uses, built here and nowhere else (plan D6, docs/01 "Redis key namespaces"), so
 * namespaces can't collide across modules and phases.
 *
 * Segments are separated by `:`. A segment may not contain `:` or whitespace: user ids are cuids, instrument keys use
 * `|`, IdempotencyKeySchema forbids `:`. The one exception is a client IP, always the last segment, where an IPv6
 * address or /64 brings its own colons.
 *
 * | Key                                     | Type            | TTL                          | Owner (phase)           |
 * |-----------------------------------------|-----------------|------------------------------|-------------------------|
 * | `rl:<policy>:ip:<ip>`, `rl:<policy>:u:<userId>` | string (GCRA TAT µs) | ≤ the policy period | rate limiting (0.5) |
 * | `idem:<userId>:<key>`                   | string (JSON)   | 30 s in flight, 24 h stored  | idempotency (0.5)       |
 * | `quote:<instrumentKey>`                 | hash            | none (overwritten)           | market feed (1.4)       |
 * | `q:<instrumentKey>`                     | pub/sub channel | —                            | tick fan-out (1.4)      |
 * | `ticks:<broker>`                        | stream          | `MAXLEN ~`                   | feed (1.4)              |
 * | `subs:<instrumentKey>`                  | counter         | 30 s grace at zero           | subscriptions (1.4)     |
 * | `subs:wanted:<broker>`                  | set             | none                         | subscriptions (1.4)     |
 * | `lock:feed:<broker>`                    | string          | 15 s, renewed every 5 s      | feed leader (1.4)       |
 * | `feed:status:<broker>`                  | string (JSON)   | 15 s, renewed by the leader  | feed leader (1.4)       |
 * | `candles:cov:<timeframe>:<instrumentKey>` | sorted set    | none                         | candle backfill (1.4)   |
 * | `oauth:state:<nonce>`                   | string (JSON)   | 10 min, deleted on use       | broker OAuth (1.2)      |
 * | `bull:<queue>:*`                        | BullMQ          | BullMQ                       | jobs (1.2; BullMQ owns them) |
 *
 * No `KEYS` and no unbounded `SCAN` on the request path.
 */
import { isInstrumentKey } from "@finlytics/shared";

/** One key segment: no `:`, no whitespace, not empty. */
const SEGMENT = /^[^:\s]+$/;

/** A client IP key segment: an IPv4 address, an IPv6 address, or an IPv6 /64 or /48 (see bootstrap/client-ip.ts). */
const IP_SEGMENT = /^[0-9A-Fa-f.:]+(?:\/(?:48|64))?$/;

function segment(name: string, value: string): string {
  if (!SEGMENT.test(value)) throw new TypeError(`Invalid Redis key segment for ${name}`);
  return value;
}

/** An instrument key segment: the canonical grammar (never `:`; index names may hold spaces, `NSE_INDEX|NIFTY 50`). */
function instrumentKeySegment(value: string): string {
  if (!isInstrumentKey(value)) throw new TypeError("Invalid Redis key segment for instrumentKey");
  return value;
}

function ipSegment(value: string): string {
  if (!IP_SEGMENT.test(value)) throw new TypeError("Invalid Redis key segment for ip");
  return value;
}

export const redisKeys = Object.freeze({
  /** A rate-limit bucket keyed by client IP: `rl:<policy>:ip:<ip>`. */
  rateLimitByIp: (policy: string, ip: string): string => `rl:${segment("policy", policy)}:ip:${ipSegment(ip)}`,
  /** A rate-limit bucket keyed by user: `rl:<policy>:u:<userId>`. */
  rateLimitByUser: (policy: string, userId: string): string =>
    `rl:${segment("policy", policy)}:u:${segment("userId", userId)}`,
  /** An idempotency record, scoped per user: `idem:<userId>:<key>`. */
  idempotency: (userId: string, key: string): string =>
    `idem:${segment("userId", userId)}:${segment("idempotencyKey", key)}`,
  /** The latest quote of an instrument (hash): `quote:<instrumentKey>`. */
  quote: (instrumentKey: string): string => `quote:${instrumentKeySegment(instrumentKey)}`,
  /** The tick fan-out channel of an instrument: `q:<instrumentKey>`. */
  quoteChannel: (instrumentKey: string): string => `q:${instrumentKeySegment(instrumentKey)}`,
  /** A broker's normalised tick stream: `ticks:<broker>`. */
  ticks: (broker: string): string => `ticks:${segment("broker", broker)}`,
  /** The subscriber count of an instrument: `subs:<instrumentKey>`. */
  subscriptions: (instrumentKey: string): string => `subs:${instrumentKeySegment(instrumentKey)}`,
  /** The instruments a broker's market feed must carry (set, reconciled by the feed leader): `subs:wanted:<broker>`. */
  subscriptionsWanted: (broker: string): string => `subs:wanted:${segment("broker", broker)}`,
  /** The market-feed leader lock of a broker: `lock:feed:<broker>`. */
  feedLock: (broker: string): string => `lock:feed:${segment("broker", broker)}`,
  /** The feed leader's last reported state (JSON `{status, ts}`): `feed:status:<broker>`. */
  feedStatus: (broker: string): string => `feed:status:${segment("broker", broker)}`,
  /** Time ranges already backfilled from a broker (sorted set): `candles:cov:<timeframe>:<instrumentKey>`. */
  candleCoverage: (timeframe: string, instrumentKey: string): string =>
    `candles:cov:${segment("timeframe", timeframe)}:${instrumentKeySegment(instrumentKey)}`,
  /** A pending broker OAuth login (JSON, 10 min, single use: GETDEL): `oauth:state:<nonce>`. */
  oauthState: (nonce: string): string => `oauth:state:${segment("nonce", nonce)}`,
});
