/**
 * CSRF protection (plan D10, docs/06): Origin and Fetch Metadata checks, on top of SameSite=Lax cookies and
 * JSON-only bodies (a cross-origin JSON write always needs a CORS preflight, which the allowlist refuses). No
 * synchronizer or double-submit token. Global, first in line: CsrfGuard → SessionGuard → RateLimitGuard → AuthGuard.
 *
 * Applies to unsafe methods (anything but GET, HEAD and OPTIONS) on routes that aren't `@Public()`, when the request
 * carries the session cookie:
 * - with `Origin`: it must be one of API_ALLOWED_ORIGINS;
 * - without `Origin`: `Sec-Fetch-Site` must be absent, `same-origin` or `none`;
 * - with neither header: allowed. Browsers always send `Origin` on cross-origin unsafe requests, so this is a
 *   non-browser client, e.g. a Next.js server action forwarding the cookie.
 * Anything else is 403 FORBIDDEN.
 */
import { SESSION_COOKIE_NAME } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import type { Env } from "../../config/env.schema";
import { isPublicRoute } from "../decorators/public";
import { ForbiddenError } from "../problem-json/domain-errors";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
const SAME_SITE_FETCHES: ReadonlySet<string> = new Set(["same-origin", "none"]);

export interface CsrfRequest {
  readonly method: string;
  readonly hasSessionCookie: boolean;
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
}

/** The CSRF decision for a request (pure). */
export function csrfVerdict(request: CsrfRequest, allowedOrigins: ReadonlySet<string>): "allow" | "reject" {
  if (SAFE_METHODS.has(request.method.toUpperCase()) || !request.hasSessionCookie) return "allow";
  if (request.origin !== undefined) return allowedOrigins.has(request.origin) ? "allow" : "reject";
  if (request.secFetchSite === undefined || SAME_SITE_FETCHES.has(request.secFetchSite)) return "allow";
  return "reject";
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly cookieName: string;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.allowedOrigins = new Set(config.get("API_ALLOWED_ORIGINS", { infer: true }));
    this.cookieName = SESSION_COOKIE_NAME[config.get("NODE_ENV", { infer: true })];
  }

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const verdict = csrfVerdict(
      {
        method: request.method,
        hasSessionCookie: request.cookies[this.cookieName] !== undefined,
        origin: singleHeader(request.headers.origin),
        secFetchSite: singleHeader(request.headers["sec-fetch-site"]),
      },
      this.allowedOrigins,
    );
    if (verdict === "reject") throw new ForbiddenError("This request was blocked as a cross-site request.");
    return true;
  }
}
