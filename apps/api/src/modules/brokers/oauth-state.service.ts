/**
 * Broker OAuth `state` (plan P4; security.md "state parameter is a signed nonce bound to the session"):
 * `<nonce>.<hmac>`, where the nonce is 32 random bytes and the HMAC-SHA256 is keyed by a key derived from the master key
 * (VaultService.deriveKey). The nonce indexes `oauth:state:<nonce>` in Redis (10 min), which holds the user, the
 * session and the account; the callback consumes it with GETDEL, so a state works once. A forged or altered state is
 * refused before Redis is touched; a replayed one finds nothing.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { BrokerCodeSchema } from "@finlytics/shared";
import type { BrokerCode } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import { VaultService } from "../../infra/vault/vault.service";

/** How long a login may take. */
export const OAUTH_STATE_TTL_SEC = 600;

/** What a state stands for. */
export interface OAuthStateRecord {
  readonly userId: string;
  /** The Session row id of the user's browser session: the callback must come from the same session. */
  readonly sessionId: string;
  readonly brokerAccountId: string;
  readonly broker: BrokerCode;
}

const RecordSchema = z.strictObject({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  brokerAccountId: z.string().min(1),
  broker: BrokerCodeSchema,
});

const STATE = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

@Injectable()
export class OAuthStateService {
  readonly #key: Buffer;

  constructor(
    private readonly redis: RedisService,
    vault: VaultService,
  ) {
    this.#key = vault.deriveKey("oauth-state");
  }

  /** Stores a new single-use state for `record` and returns it. */
  async issue(record: OAuthStateRecord): Promise<string> {
    const nonce = randomBytes(32).toString("base64url");
    await this.redis.client.set(redisKeys.oauthState(nonce), JSON.stringify(record), "EX", OAUTH_STATE_TTL_SEC, "NX");
    return `${nonce}.${this.#sign(nonce)}`;
  }

  /** The record of a state, consuming it; null when it is malformed, forged, expired or already used. */
  async consume(state: string): Promise<OAuthStateRecord | null> {
    const match = STATE.exec(state);
    if (match === null) return null;
    const [, nonce = "", signature = ""] = match;
    const expected = Buffer.from(this.#sign(nonce), "base64url");
    const given = Buffer.from(signature, "base64url");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const stored = await this.redis.client.getdel(redisKeys.oauthState(nonce));
    if (stored === null) return null;
    try {
      const parsed = RecordSchema.safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  #sign(nonce: string): string {
    return createHmac("sha256", this.#key).update(`oauth-state:${nonce}`, "utf8").digest("base64url");
  }
}
