/**
 * Resolves the Auth.js session cookie into `request.identity` (plan D9). Global, second in line:
 * CsrfGuard → SessionGuard → RateLimitGuard → AuthGuard.
 *
 * - `@Public()` routes: skipped entirely, no cookie read and no lookup.
 * - No cookie, or a malformed one: anonymous, without a database lookup.
 * - A well-formed token from an address this pod already knows is refused (its anonymous bucket is empty,
 *   RateLimitService.knownPublicRefusal): 429 RATE_LIMITED at once, without a lookup. That holds for a valid cookie
 *   too, since nothing tells a valid token from a random one without the lookup; a signed-in user behind that address
 *   waits for Retry-After (under a second at the default 100 per minute).
 * - Otherwise one lookup (SessionService). No matching valid session: anonymous, and the failed lookup is charged once
 *   to the caller's anonymous buckets (RateLimitGuard reuses that charge instead of making its own).
 *
 * What that bounds: random cookies from one address buy as many lookups as its anonymous bucket admits, plus at most
 * one per pod each time that pod has yet to learn the bucket is empty (the refusal cache is per pod). The cache is
 * bounded and evicts the oldest address first, so a flood of more distinct addresses than it holds can buy more; each
 * address is still limited by its own bucket.
 * Never answers 401 by itself: AuthGuard does, on routes that need an identity.
 */
import { SESSION_COOKIE_NAME, SESSION_TOKEN_PATTERN } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";

import { isPublicRoute } from "../../common/decorators/public";
import { enforceRateLimits, RateLimitService } from "../../common/rate-limit/rate-limit.service";
import type { Env } from "../../config/env.schema";

import type { AuthIdentity } from "./auth-identity";
import { SessionService } from "./session.service";

/** How a request's session cookie was resolved. */
export type SessionOutcome = "anonymous" | "authenticated" | "rejected";

/** The session cookie's value, if the request carries one (whatever its format). */
export function sessionCookie(request: Pick<FastifyRequest, "cookies">, cookieName: string): string | undefined {
  return request.cookies[cookieName];
}

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly rateLimits: RateLimitService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieName = SESSION_COOKIE_NAME[config.get("NODE_ENV", { infer: true })];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    request.identity = null;

    const token = this.lookupToken(request);
    if (token === undefined) return true;
    // Before the lookup: an address that is already refused gets its 429 without touching the database.
    const known = this.rateLimits.knownPublicRefusal(request);
    if (known !== undefined) enforceRateLimits(reply, [known]);

    const { outcome, identity } = await this.resolveToken(token);
    request.identity = identity;
    if (outcome === "rejected") enforceRateLimits(reply, await this.rateLimits.chargePublic(request));
    return true;
  }

  /** The identity behind the request's cookie, and how it was found. */
  async resolve(
    request: Pick<FastifyRequest, "cookies">,
  ): Promise<{ outcome: SessionOutcome; identity: AuthIdentity | null }> {
    const token = this.lookupToken(request);
    return token === undefined ? { outcome: "anonymous", identity: null } : this.resolveToken(token);
  }

  /** The cookie's token if it is well-formed, so worth a lookup; otherwise undefined (anonymous). */
  private lookupToken(request: Pick<FastifyRequest, "cookies">): string | undefined {
    const token = sessionCookie(request, this.cookieName);
    return token !== undefined && SESSION_TOKEN_PATTERN.test(token) ? token : undefined;
  }

  private async resolveToken(token: string): Promise<{ outcome: SessionOutcome; identity: AuthIdentity | null }> {
    const identity = await this.sessions.resolve(token);
    return identity === null ? { outcome: "rejected", identity } : { outcome: "authenticated", identity };
  }
}
