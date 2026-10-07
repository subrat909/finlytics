import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, isPublicPath, proxy } from "../proxy";

const TOKEN = "Abc_def-0123456789abcdefghijklmnopqrstuvwxy";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe("proxy", () => {
  it("sends a request without a session cookie to /login, remembering where it was going", () => {
    const response = proxy(request("/charts/NIFTY?tf=5m"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/charts/NIFTY?tf=5m");
  });

  it("doesn't add a callbackUrl for the root", () => {
    expect(proxy(request("/")).headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("treats a malformed cookie as none", () => {
    expect(proxy(request("/dashboard", "authjs.session-token=nope")).status).toBe(307);
  });

  it("lets a request with a session cookie through, with a nonce in the request and the CSP on the response", () => {
    const response = proxy(request("/dashboard", `authjs.session-token=${TOKEN}`));
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers through x-middleware-*.
    expect(response.headers.get("x-middleware-request-x-nonce")).toMatch(/^[A-Za-z0-9+/=]{24}$/);
    expect(csp).toContain(`'nonce-${response.headers.get("x-middleware-request-x-nonce") ?? ""}'`);
  });

  it("lets the public auth pages through without a cookie", () => {
    for (const path of ["/login", "/verify", "/api/auth/callback/email"]) {
      expect(proxy(request(path)).status, path).toBe(200);
    }
  });

  it("knows which paths are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/2fa")).toBe(true);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
  });

  it("never runs for /v1, static assets or prefetches", () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher?.source.replace("/(", "/(") ?? ""}$`);
    expect(pattern.test("/dashboard")).toBe(true);
    expect(pattern.test("/v1/me")).toBe(false);
    expect(pattern.test("/v1")).toBe(false);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher?.missing).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "next-router-prefetch" })]),
    );
  });
});
