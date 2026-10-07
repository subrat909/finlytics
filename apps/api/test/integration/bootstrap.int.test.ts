/**
 * The bootstrap wiring (plan D2, D9, D11): which routes exist, and the order of the global guards.
 */
import { ApplicationConfig } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import { createTestApp } from "./app";

describe("bootstrap", () => {
  it("registers only /v1, /health and /docs routes", async () => {
    const { app, close } = await createTestApp({}, { probes: false, listen: true });
    const routes: string[] = [];
    app
      .getHttpAdapter()
      .getInstance()
      .addHook("onRoute", (route) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) routes.push(`${method} ${route.url}`);
      });
    try {
      await app.init();

      const ours = routes.filter((route) => route !== "OPTIONS *"); // @fastify/cors's preflight route
      expect(ours.length).toBeGreaterThan(0);
      for (const route of ours) expect(route).toMatch(/^[A-Z]+ \/(?:v1\/|health\/|docs)/);
      expect(ours).toEqual(expect.arrayContaining(["GET /health/live", "GET /health/ready", "GET /v1/me"]));
      expect(ours.some((route) => route.includes("__test__"))).toBe(false);
    } finally {
      await close();
    }
  });

  it("runs the global guards in registration order (429 before 401 for an anonymous flood)", async () => {
    const { app, request, close } = await createTestApp({ API_RATE_LIMIT_PUBLIC_PER_MIN: "1" }, { probes: false });
    try {
      const guards = app
        .get(ApplicationConfig)
        .getGlobalGuards()
        .map((guard) => guard.constructor.name);

      expect(guards).toEqual(["CsrfGuard", "SessionGuard", "RateLimitGuard", "AuthGuard"]);

      // One anonymous request per minute from this address: the second is throttled before authentication runs.
      // TEST-NET-1 (192.0.2.0/24): outside the 198.18.0.0/15 range rate-limit.int.test.ts draws its addresses from.
      const flood = () => request({ method: "GET", url: "/v1/me", remoteAddress: "192.0.2.250" });
      expect((await flood()).statusCode).toBe(401);
      expect((await flood()).statusCode).toBe(429);
    } finally {
      await close();
    }
  });
});
