/**
 * The realtime gateway's Nest service: the handshake (Origin, session cookie through SessionService, anonymous IP
 * charging like SessionGuard) and the {@link RealtimeEngine} with its Redis connections.
 */
import { RT_CONNECT_ERRORS, SESSION_COOKIE_NAME, SESSION_TOKEN_PATTERN } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";

import { RateLimitService } from "../../common/rate-limit/rate-limit.service";
import type { Env } from "../../config/env.schema";
import { FEED_SOURCE_BROKER } from "../../feed/feed-connector";
import type { AuthIdentity } from "../auth/auth-identity";
import { SessionService } from "../auth/session.service";

import { handshakeClientIp, isAllowedHandshakeOrigin, readCookie, trustedProxies } from "./handshake";
import { QuoteSubscriber } from "./quote-subscriber";
import { RealtimeEngine } from "./realtime.engine";
import { RealtimeRepository } from "./realtime.repository";

/** What the handshake sees of the HTTP upgrade (or first polling) request. */
export interface HandshakeRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly remoteAddress: string | undefined;
}

export type HandshakeResult =
  | { readonly ok: true; readonly identity: AuthIdentity; readonly maxSubscriptions: number }
  | { readonly ok: false; readonly code: (typeof RT_CONNECT_ERRORS)[keyof typeof RT_CONNECT_ERRORS] };

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly engine: RealtimeEngine;
  readonly allowedOrigins: ReadonlySet<string>;
  private readonly cookieName: string;
  private readonly isTrustedProxy: (address: string) => boolean;

  constructor(
    config: ConfigService<Env, true>,
    private readonly repository: RealtimeRepository,
    private readonly sessions: SessionService,
    private readonly rateLimits: RateLimitService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RealtimeService.name);
    this.allowedOrigins = new Set(config.get("API_ALLOWED_ORIGINS", { infer: true }));
    this.cookieName = SESSION_COOKIE_NAME[config.get("NODE_ENV", { infer: true })];
    this.isTrustedProxy = trustedProxies(config.get("API_TRUST_PROXY", { infer: true }));
    const connection = QuoteSubscriber.connect(config.get("REDIS_URL", { infer: true }));
    const quotes = new QuoteSubscriber(
      connection,
      (update) => {
        this.engine.onQuote(update);
      },
      logger,
    );
    this.engine = new RealtimeEngine({
      broker: FEED_SOURCE_BROKER[config.get("MARKET_FEED_SOURCE", { infer: true })],
      repository,
      quotes,
      logger,
    });
  }

  /**
   * Checks a connecting socket: an allowed Origin, then a valid session. Failed lookups are charged to the client's
   * anonymous rate-limit buckets, as on HTTP; a client already refused gets RATE_LIMITED without a lookup.
   */
  async authenticate(request: HandshakeRequest): Promise<HandshakeResult> {
    if (!isAllowedHandshakeOrigin(request.headers, this.allowedOrigins)) {
      return { ok: false, code: RT_CONNECT_ERRORS.forbiddenOrigin };
    }
    const subject = {
      ip: handshakeClientIp(request.remoteAddress, request.headers["x-forwarded-for"], this.isTrustedProxy),
    };
    if (this.rateLimits.knownPublicRefusal(subject) !== undefined) {
      return { ok: false, code: RT_CONNECT_ERRORS.rateLimited };
    }
    const token = readCookie(request.headers["cookie"], this.cookieName);
    let identity: AuthIdentity | null = null;
    if (token !== undefined && SESSION_TOKEN_PATTERN.test(token)) {
      try {
        identity = await this.sessions.resolve(token);
      } catch (error: unknown) {
        this.logger.warn({ err: error }, "session lookup failed during the realtime handshake");
        return { ok: false, code: RT_CONNECT_ERRORS.unavailable };
      }
    }
    if (identity !== null) {
      try {
        return { ok: true, identity, maxSubscriptions: await this.repository.maxSubscriptions(identity.userId) };
      } catch (error: unknown) {
        this.logger.warn({ err: error }, "plan lookup failed during the realtime handshake");
        return { ok: false, code: RT_CONNECT_ERRORS.unavailable };
      }
    }
    const decisions = await this.rateLimits.chargePublic(subject);
    const refused = decisions.some((decision) => decision?.allowed === false);
    return { ok: false, code: refused ? RT_CONNECT_ERRORS.rateLimited : RT_CONNECT_ERRORS.unauthenticated };
  }

  /** After every module's init (Redis is connecting by then): start flushing and polling the feed status. */
  onApplicationBootstrap(): void {
    this.engine.start();
  }

  /** Runs before Nest closes the server: releases every local subscription while Redis is still open. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.engine.close();
  }
}
