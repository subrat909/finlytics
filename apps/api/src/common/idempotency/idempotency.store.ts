/**
 * Idempotency records in Redis (plan D8; docs/04 §7 "Idempotency"): `idem:<userId>:<key>`, per user, so two users can
 * never collide on a key.
 *
 * - In flight: `{ v, state: "in-flight", owner, fingerprint }` for at most 30 s (`SET NX PX`).
 * - Completed: `{ v, state: "completed", fingerprint, status, body }` for 24 h; `body` is the response as sent (JSON
 *   text), or null for an empty one.
 *
 * A Redis failure is `ServiceUnavailableError` (503, retryable): idempotency fails closed, because a trade retried
 * without dedupe is worse than a 503. A value that isn't one of the two shapes is a bug and throws TypeError (500).
 *
 * Redis dedupes and replays; it is not the exactly-once guarantee. Side effects get that from database uniqueness
 * (`Order(userId, idempotencyKey)`, 2.1), so an expired lock or a crash between a broker call and the Redis write can
 * never place an order twice.
 */
import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import type { RedisScript } from "../../infra/redis/redis.service";
import { ServiceUnavailableError } from "../problem-json/domain-errors";

import { IDEMPOTENCY_CLAIM_SCRIPT, IDEMPOTENCY_FINALIZE_SCRIPT, IDEMPOTENCY_RELEASE_SCRIPT } from "./idempotency.lua";

/** Fixed in code (plan D3 notes): how long a claim and a completed record live, and the largest body stored. */
export const IDEMPOTENCY_LIMITS = Object.freeze({
  inFlightTtlMs: 30_000,
  recordTtlMs: 86_400_000,
  maxStoredBodyBytes: 65_536,
});

const FingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);

const InFlightSchema = z.strictObject({
  v: z.literal(1),
  state: z.literal("in-flight"),
  owner: z.uuid(),
  fingerprint: FingerprintSchema,
});

const CompletedSchema = z.strictObject({
  v: z.literal(1),
  state: z.literal("completed"),
  fingerprint: FingerprintSchema,
  status: z.int().min(200).max(299),
  body: z.string().nullable(),
});

const EntrySchema = z.discriminatedUnion("state", [InFlightSchema, CompletedSchema]);

/** What a key holds: another request's claim, or a completed response. */
export type IdempotencyEntry = z.infer<typeof EntrySchema>;

/** This request's ownership of a key: the key and the exact marker it wrote. */
export interface IdempotencyClaim {
  readonly key: string;
  readonly marker: string;
  readonly fingerprint: string;
}

export type ClaimResult =
  | { readonly claimed: true; readonly claim: IdempotencyClaim }
  | { readonly claimed: false; readonly existing: IdempotencyEntry };

/** A completed response to store: a 2xx status and the body as sent. */
export interface StoredResponse {
  readonly status: number;
  readonly body: string | null;
}

/** Parses what a key holds. @throws {TypeError} for anything that isn't a record this store wrote. */
export function parseEntry(value: unknown): IdempotencyEntry {
  if (typeof value !== "string") throw new TypeError("Unreadable idempotency record");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Unreadable idempotency record");
  }
  const entry = EntrySchema.safeParse(parsed);
  if (!entry.success) throw new TypeError("Unreadable idempotency record");
  return entry.data;
}

@Injectable()
export class IdempotencyStore {
  private readonly claimScript: RedisScript;
  private readonly finalizeScript: RedisScript;
  private readonly releaseScript: RedisScript;

  constructor(redis: RedisService) {
    this.claimScript = redis.defineScript(IDEMPOTENCY_CLAIM_SCRIPT);
    this.finalizeScript = redis.defineScript(IDEMPOTENCY_FINALIZE_SCRIPT);
    this.releaseScript = redis.defineScript(IDEMPOTENCY_RELEASE_SCRIPT);
  }

  /** Claims `userId`'s `idempotencyKey` for a request with `fingerprint`, or returns what the key already holds. */
  async claim(userId: string, idempotencyKey: string, fingerprint: string): Promise<ClaimResult> {
    const key = redisKeys.idempotency(userId, idempotencyKey);
    const marker = JSON.stringify({ v: 1, state: "in-flight", owner: randomUUID(), fingerprint });
    const reply = await this.run(this.claimScript, key, [marker, IDEMPOTENCY_LIMITS.inFlightTtlMs]);
    if (Array.isArray(reply) && reply.length === 1 && reply[0] === 1) {
      return { claimed: true, claim: { key, marker, fingerprint } };
    }
    if (Array.isArray(reply) && reply.length === 2 && reply[0] === 0) {
      return { claimed: false, existing: parseEntry(reply[1]) };
    }
    throw new TypeError("Unexpected reply from the idempotency claim script");
  }

  /** Stores the completed response in place of this request's claim. False when the claim was lost (expired). */
  async complete(claim: IdempotencyClaim, response: StoredResponse): Promise<boolean> {
    const record = JSON.stringify(
      CompletedSchema.parse({
        v: 1,
        state: "completed",
        fingerprint: claim.fingerprint,
        status: response.status,
        body: response.body,
      }),
    );
    return (
      (await this.run(this.finalizeScript, claim.key, [claim.marker, record, IDEMPOTENCY_LIMITS.recordTtlMs])) === 1
    );
  }

  /** Deletes this request's claim, so the key can be used again. False when the claim was already lost. */
  async release(claim: IdempotencyClaim): Promise<boolean> {
    return (await this.run(this.releaseScript, claim.key, [claim.marker])) === 1;
  }

  private async run(script: RedisScript, key: string, args: readonly (string | number)[]): Promise<unknown> {
    try {
      return await script([key], args);
    } catch (error: unknown) {
      throw new ServiceUnavailableError("Retry the request later.", { cause: error });
    }
  }
}
