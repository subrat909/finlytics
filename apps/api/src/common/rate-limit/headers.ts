/**
 * Rate-limit response headers, as structured fields per draft-ietf-httpapi-ratelimit-headers-11 (plan D7):
 *
 *   RateLimit-Policy: "user";q=600;w=60
 *   RateLimit: "user";r=599;t=1
 *
 * - One list member per policy the request was checked against, in order (`"user", "orders"` on an order route;
 *   `"public", "publicNet"` for an anonymous IPv6 client).
 * - `q`: the quota, the sustained rate (requests per window); `w`: the window in seconds; `r`: requests remaining now;
 *   `t`: seconds until the quota is full again. A token bucket whose burst is `q`: a client that has been idle can send
 *   `q` requests at once, then `q` per window.
 * - Never a partition key (`pk`): it would echo the client's IP or user id.
 * - A 429 also carries `Retry-After` (set from the problem's `retryAfterSec`), which takes precedence over `t`.
 */
import type { GcraDecision } from "./gcra";
import type { RateLimitPolicy } from "./policies";

/** A decided rate-limit check: the policy and the bucket's answer. */
export interface RateLimitDecision extends GcraDecision {
  readonly policy: RateLimitPolicy;
}

/** A structured-field String: the policy names are ASCII words (`public`, `publicNet`), so quoting is all they need. */
function sfString(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(value)) throw new TypeError(`Invalid rate-limit policy name: ${value}`);
  return `"${value}"`;
}

/** `RateLimit-Policy` for the policies checked. */
export function formatRateLimitPolicy(policies: readonly RateLimitPolicy[]): string {
  return policies
    .map((policy) => `${sfString(policy.name)};q=${String(policy.limit)};w=${String(policy.windowSec)}`)
    .join(", ");
}

/** `RateLimit` for the decisions, in the same order. */
export function formatRateLimit(decisions: readonly RateLimitDecision[]): string {
  return decisions
    .map(
      (decision) =>
        `${sfString(decision.policy.name)};r=${String(Math.max(0, decision.remaining))};t=${String(
          Math.max(0, Math.ceil(decision.resetAfterMs / 1_000)),
        )}`,
    )
    .join(", ");
}

/** Whole seconds a refused request should wait: the longest wait among the refusals, at least 1. */
export function retryAfterSeconds(refused: readonly RateLimitDecision[]): number {
  return Math.max(1, ...refused.map((decision) => Math.ceil(decision.retryAfterMs / 1_000)));
}
