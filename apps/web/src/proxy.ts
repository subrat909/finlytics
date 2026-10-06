/**
 * The request proxy (Next.js 16's middleware; plan W8). Runs before every page request:
 *
 * 1. A per-request CSP nonce, passed to the render through the request headers (`x-nonce`, `content-security-policy`).
 * 2. An auth gate on the session cookie's presence (and shape): no cookie on a protected path → `/login?callbackUrl=`.
 *    It never touches the database: the `(app)` layout validates the session with `auth()`, and the api validates it
 *    again on every `/v1` call. Never import @finlytics/database here (lint enforces it).
 *
 * `/v1/*` isn't matched: the api answers it (401 problem+json, not a redirect). Static assets and prefetches aren't
 * matched either.
 */
import { SESSION_COOKIE_NAME, SESSION_TOKEN_PATTERN } from "@finlytics/shared";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, createNonce } from "@/lib/csp";
import { runtimeMode } from "@/lib/env";

/** Paths anyone may open. Everything else needs a session cookie. */
const PUBLIC_PATHS = ["/login", "/verify", "/api/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Where to return after sign-in: the requested path and query, never another origin. */
export function loginRedirectUrl(request: NextRequest): URL {
  const url = new URL("/login", request.nextUrl.origin);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") url.searchParams.set("callbackUrl", `${pathname}${search}`);
  return url;
}

export function proxy(request: NextRequest): NextResponse {
  const mode = runtimeMode();
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME[mode])?.value;
  const hasSession = sessionCookie !== undefined && SESSION_TOKEN_PATTERN.test(sessionCookie);

  if (!hasSession && !isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(loginRedirectUrl(request));
  }

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({ nonce, dev: mode === "development" });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|v1/|v1$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
