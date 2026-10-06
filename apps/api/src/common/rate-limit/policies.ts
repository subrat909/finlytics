/**
 * Rate-limit policies (plan D7, docs/04 §7 "Rate limits", docs/06 "Rate limiting", security.md "API hardening"). Each
 * is a GCRA token bucket (./gcra.ts) whose burst equals its limit: `limit` requests per window sustained, and up to
 * `limit` at once from a full bucket.
 *
 * | Policy      | Bucket                       | Limit                                         | Applied to                               | Redis fails |
 * |-------------|------------------------------|-----------------------------------------------|------------------------------------------|-------------|
 * | `public`    | `rl:public:ip:<ip>`          | API_RATE_LIMIT_PUBLIC_PER_MIN per minute      | requests without a valid session; failed session lookups (charged once) | fail open |
 * | `publicNet` | `rl:publicNet:ip:<ipv6>/48`  | 20 × API_RATE_LIMIT_PUBLIC_PER_MIN per minute | the same requests, from IPv6 clients only | fail open  |
 * | `user`      | `rl:user:u:<userId>`         | API_RATE_LIMIT_USER_PER_MIN per minute        | authenticated requests                   | fail open   |
 * | `orders`    | `rl:orders:u:<userId>`       | 10 per second (fixed)                         | routes with `@RateLimit("orders")` (2.1) | fail closed |
 *
 * `public` keys an IPv6 client by its /64, the prefix one subscriber usually gets. A subscriber delegated a /48 holds
 * 65 536 of those, so `publicNet` adds a coarser bucket on the /48, sized for many real users behind one site.
 */

export const RATE_LIMIT_POLICY_NAMES = ["public", "publicNet", "user", "orders"] as const;
export type RateLimitPolicyName = (typeof RATE_LIMIT_POLICY_NAMES)[number];

/** Policies a route adds with `@RateLimit()`. The anonymous and `user` policies apply to every rate-limited route. */
export type ExtraRateLimitPolicyName = Exclude<RateLimitPolicyName, "public" | "publicNet" | "user">;

export interface RateLimitPolicy {
  readonly name: RateLimitPolicyName;
  /** Requests admitted per window, sustained (`q` in RateLimit-Policy); also the burst. */
  readonly limit: number;
  /** The window in seconds (`w` in RateLimit-Policy). */
  readonly windowSec: number;
  /** What the bucket is keyed by: the client's IP (or IPv6 prefix), or the user id. */
  readonly subject: "ip" | "user";
  /** When Redis fails: admit the request and warn (`open`), or refuse it with 503 (`closed`, trading policies). */
  readonly onStoreFailure: "open" | "closed";
}

export type RateLimitPolicies = Readonly<Record<RateLimitPolicyName, RateLimitPolicy>>;

/** security.md "10 orders/sec/user hard cap". Fixed in code, not configurable (plan D3 notes). */
export const ORDERS_PER_SECOND = 10;

/** `publicNet` (an IPv6 /48) admits this many times the `public` limit (one /64). Fixed in code. */
export const PUBLIC_NET_MULTIPLIER = 20;

export interface RateLimitSettings {
  readonly publicPerMinute: number;
  readonly userPerMinute: number;
}

/** The policies for the configured limits. */
export function rateLimitPolicies(settings: RateLimitSettings): RateLimitPolicies {
  return Object.freeze({
    public: Object.freeze({
      name: "public",
      limit: settings.publicPerMinute,
      windowSec: 60,
      subject: "ip",
      onStoreFailure: "open",
    }),
    publicNet: Object.freeze({
      name: "publicNet",
      limit: settings.publicPerMinute * PUBLIC_NET_MULTIPLIER,
      windowSec: 60,
      subject: "ip",
      onStoreFailure: "open",
    }),
    user: Object.freeze({
      name: "user",
      limit: settings.userPerMinute,
      windowSec: 60,
      subject: "user",
      onStoreFailure: "open",
    }),
    orders: Object.freeze({
      name: "orders",
      limit: ORDERS_PER_SECOND,
      windowSec: 1,
      subject: "user",
      onStoreFailure: "closed",
    }),
  } as const satisfies RateLimitPolicies);
}

/**
 * The GCRA parameters of a policy: one request every `intervalUs` microseconds, at most `burst` at once. The interval
 * is rounded to a whole microsecond, so the bucket's arithmetic stays in integers (exact in Lua's doubles) whatever the
 * limit; the rounding error is under one microsecond per request.
 */
export function gcraParams(policy: RateLimitPolicy): { intervalUs: number; burst: number } {
  return { intervalUs: Math.max(1, Math.round((policy.windowSec * 1_000_000) / policy.limit)), burst: policy.limit };
}
