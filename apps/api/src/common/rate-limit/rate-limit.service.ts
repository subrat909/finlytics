/**
 * Rate limiting against Redis (plan D7, docs/06 "Rate limiting"): one GCRA script call per check (./gcra.lua.ts).
 *
 * - `consume(policy, subject)` charges one bucket and returns its decision.
 * - `chargePublic(request)` charges the client's anonymous buckets at most once per request, whoever asks first:
 *   SessionGuard for a failed session lookup, or RateLimitGuard for an anonymous request. So a request with a random
 *   cookie costs exactly one anonymous request, like any other. The buckets: `public` (the IP, or an IPv6 /64), then,
 *   for IPv6 clients, `publicNet` (the /48), skipped when `public` already refused.
 * - `knownPublicRefusal(request)`: the refusal this pod already knows the anonymous buckets would give (./refusal-cache.ts),
 *   with no Redis call. SessionGuard asks it before a session lookup, so an address that is refused can't buy database
 *   lookups with random cookies; chargePublic asks it before calling Redis.
 * - When Redis fails, `public`, `publicNet` and `user` fail open: the request goes through without RateLimit headers,
 *   and a warning is logged at most every 10 s. Trading policies (`orders`) fail closed: 503 SERVICE_UNAVAILABLE.
 * - A client address that isn't an IP (only possible behind a misconfigured trusted proxy) shares one bucket,
 *   `0.0.0.0`, rather than escaping the limit.
 */
import { HEADERS } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { clientNetwork, normaliseClientIp } from "../../bootstrap/client-ip";
import type { Env } from "../../config/env.schema";
import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import type { RedisScript } from "../../infra/redis/redis.service";
import { RateLimitedError, ServiceUnavailableError } from "../problem-json/domain-errors";

import { assertGcraCost } from "./gcra";
import type { GcraDecision } from "./gcra";
import { GCRA_SCRIPT } from "./gcra.lua";
import { formatRateLimit, formatRateLimitPolicy, retryAfterSeconds } from "./headers";
import type { RateLimitDecision } from "./headers";
import { gcraParams, rateLimitPolicies } from "./policies";
import type { RateLimitPolicies, RateLimitPolicy, RateLimitPolicyName } from "./policies";
import { RefusalCache } from "./refusal-cache";

/** The bucket for a client address that isn't an IP address. */
export const UNPARSEABLE_CLIENT_IP = "0.0.0.0";

const FAIL_OPEN_WARNING_INTERVAL_MS = 10_000;

/** The `public` bucket's subject for a client IP: IPv4, or the IPv6 /64 (bootstrap/client-ip.ts). */
export function clientIpSubject(ip: string): string {
  return normaliseClientIp(ip) ?? UNPARSEABLE_CLIENT_IP;
}

/** One anonymous bucket a request is charged to. */
export interface AnonymousBucket {
  readonly policy: "public" | "publicNet";
  readonly subject: string;
}

/** The anonymous buckets for a client IP, in charging order: `public`, then `publicNet` for IPv6 clients. */
export function anonymousBuckets(ip: string): readonly AnonymousBucket[] {
  const network = clientNetwork(ip);
  const ownBucket: AnonymousBucket = { policy: "public", subject: clientIpSubject(ip) };
  return network === undefined ? [ownBucket] : [ownBucket, { policy: "publicNet", subject: network }];
}

/** The script's reply, `{ allowed, remaining, retryAfterMs, resetAfterMs }`, checked. */
export function parseGcraReply(reply: unknown): GcraDecision {
  if (
    !Array.isArray(reply) ||
    reply.length !== 4 ||
    !reply.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new TypeError("Unexpected reply from the rate-limit script");
  }
  const [allowed, remaining, retryAfterMs, resetAfterMs] = reply as [number, number, number, number];
  return { allowed: allowed === 1, remaining, retryAfterMs, resetAfterMs };
}

/** The Redis key of `policy`'s bucket for `subject`. @throws {TypeError} for a subject that isn't a key segment. */
function bucketKey(policy: RateLimitPolicy, subject: string): string {
  return policy.subject === "ip"
    ? redisKeys.rateLimitByIp(policy.name, subject)
    : redisKeys.rateLimitByUser(policy.name, subject);
}

/**
 * Sends `RateLimit-Policy` and `RateLimit` for the decided checks, then refuses the request (429 RATE_LIMITED, with
 * Retry-After) if any check refused it. A check the store couldn't decide (`undefined`, fail open) sends nothing.
 */
export function enforceRateLimits(
  reply: Pick<FastifyReply, "header">,
  checks: readonly (RateLimitDecision | undefined)[],
): void {
  const decisions = checks.filter((check): check is RateLimitDecision => check !== undefined);
  if (decisions.length === 0) return;
  reply.header(HEADERS.rateLimitPolicy, formatRateLimitPolicy(decisions.map((decision) => decision.policy)));
  reply.header(HEADERS.rateLimit, formatRateLimit(decisions));
  const refused = decisions.filter((decision) => !decision.allowed);
  if (refused.length > 0) throw new RateLimitedError(retryAfterSeconds(refused));
}

@Injectable()
export class RateLimitService {
  readonly policies: RateLimitPolicies;
  private readonly runGcra: RedisScript;
  /** Each request's anonymous charge, so it is made once however many guards ask. */
  private readonly publicCharges = new WeakMap<object, Promise<readonly (RateLimitDecision | undefined)[]>>();
  /** Anonymous buckets this pod knows are empty. */
  private readonly refusals = new RefusalCache();
  private lastFailOpenWarningAt = Number.NEGATIVE_INFINITY;

  constructor(
    redis: RedisService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RateLimitService.name);
    this.policies = rateLimitPolicies({
      publicPerMinute: config.get("API_RATE_LIMIT_PUBLIC_PER_MIN", { infer: true }),
      userPerMinute: config.get("API_RATE_LIMIT_USER_PER_MIN", { infer: true }),
    });
    this.runGcra = redis.defineScript(GCRA_SCRIPT);
  }

  /**
   * Charges `cost` requests to `policy`'s bucket for `subject` (a client IP subject or a user id).
   *
   * @returns the decision, or `undefined` when Redis failed and the policy fails open.
   * @throws {TypeError} for an invalid subject, or a cost that isn't a positive integer or exceeds the policy's burst
   *   (such a request could never be admitted): bugs, never a reason to fail open.
   * @throws {ServiceUnavailableError} when Redis failed and the policy fails closed.
   */
  async consume(name: RateLimitPolicyName, subject: string, cost = 1): Promise<RateLimitDecision | undefined> {
    const policy = this.policies[name];
    const { intervalUs, burst } = gcraParams(policy);
    // Checked outside the try: a bad cost or subject is a bug, never a reason to fail open.
    assertGcraCost(cost, burst);
    const key = bucketKey(policy, subject);
    try {
      return { policy, ...parseGcraReply(await this.runGcra([key], [intervalUs, burst, cost])) };
    } catch (error: unknown) {
      this.storeFailed(policy, error); // throws for a policy that fails closed
      return undefined;
    }
  }

  /**
   * The request's charge to its client's anonymous buckets (`public`, then `publicNet` for IPv6): made on the first
   * call, reused after that. One decision per bucket checked; `undefined` for a bucket whose store failed open.
   */
  chargePublic(request: Pick<FastifyRequest, "ip">): Promise<readonly (RateLimitDecision | undefined)[]> {
    let charge = this.publicCharges.get(request);
    if (charge === undefined) {
      charge = this.chargeAnonymous(request.ip);
      this.publicCharges.set(request, charge);
    }
    return charge;
  }

  /**
   * The refusal this pod already knows the request's anonymous buckets would give, without asking Redis; undefined
   * when it knows of none. Never refuses a request the buckets would admit (./refusal-cache.ts).
   */
  knownPublicRefusal(request: Pick<FastifyRequest, "ip">): RateLimitDecision | undefined {
    for (const bucket of anonymousBuckets(request.ip)) {
      const refusal = this.refusals.get(bucketKey(this.policies[bucket.policy], bucket.subject));
      if (refusal !== undefined) return refusal;
    }
    return undefined;
  }

  private async chargeAnonymous(ip: string): Promise<readonly (RateLimitDecision | undefined)[]> {
    const decisions: (RateLimitDecision | undefined)[] = [];
    for (const bucket of anonymousBuckets(ip)) {
      const key = bucketKey(this.policies[bucket.policy], bucket.subject);
      const known = this.refusals.get(key);
      const decision = known ?? (await this.consume(bucket.policy, bucket.subject));
      if (known === undefined && decision !== undefined) this.refusals.record(key, decision);
      decisions.push(decision);
      // A refused request doesn't spend the next bucket.
      if (decision?.allowed === false) break;
    }
    return decisions;
  }

  /** Fails closed (throws 503) or open (warns at most every 10 s), as the policy says. */
  private storeFailed(policy: RateLimitPolicy, error: unknown): void {
    if (policy.onStoreFailure === "closed") {
      throw new ServiceUnavailableError("Retry the request later.", { cause: error });
    }
    const now = Date.now();
    if (now - this.lastFailOpenWarningAt >= FAIL_OPEN_WARNING_INTERVAL_MS) {
      this.lastFailOpenWarningAt = now;
      this.logger.warn({ policy: policy.name, err: error }, "rate limit store unavailable; failing open");
    }
  }
}
