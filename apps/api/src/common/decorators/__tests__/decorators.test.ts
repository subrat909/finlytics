import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import { UnauthenticatedError } from "../../problem-json/domain-errors";
import { currentIdentity } from "../current-user";
import { idempotencyKeyHeaderSchema, Idempotent, isIdempotentRoute } from "../idempotent";
import { isPublicRoute, Public } from "../public";
import { extraRateLimitPolicies, RateLimit } from "../rate-limit";
import { requestMetadata } from "../request-meta";
import { skipsRateLimit, SkipRateLimit } from "../skip-rate-limit";

const http = (request: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe("decorators", () => {
  it("marks a handler or a whole controller public", () => {
    // Stand-ins for a controller class and its handlers: Reflector reads metadata off any function. The ones @Public()
    // decorates are function declarations: like classes, they have a prototype, which its ApiExtension reads.
    function PublicController(): void {}
    const PrivateController = (): void => undefined;
    Public()(PublicController);
    const handler = (): void => undefined;
    function open(): void {}
    Public()(open);
    const reflector = new Reflector();
    const route = (target: () => void, method: () => void) =>
      ({ getHandler: () => method, getClass: () => target }) as unknown as ExecutionContext;

    expect(isPublicRoute(reflector, route(PublicController, handler))).toBe(true);
    expect(isPublicRoute(reflector, route(PrivateController, open))).toBe(true);
    expect(isPublicRoute(reflector, route(PrivateController, handler))).toBe(false);
  });

  it("reads the identity, and refuses a request without one", () => {
    const identity = { userId: "u1", sessionId: "s1", role: "USER" as const };

    expect(currentIdentity(http({ identity }))).toBe(identity);
    expect(() => currentIdentity(http({ identity: null }))).toThrow(UnauthenticatedError);
  });

  it("bounds the request metadata for audit rows", () => {
    expect(
      requestMetadata({
        id: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f",
        ip: "203.0.113.7",
        headers: { "user-agent": `Mozilla\n${"x".repeat(600)}` },
      }),
    ).toEqual({
      requestId: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f",
      ip: "203.0.113.7",
      userAgent: expect.stringMatching(/^Mozilla x+…$/) as string,
    });
    expect(requestMetadata({ id: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f", ip: "::1", headers: {} })).toMatchObject({
      ip: "::1",
      userAgent: undefined,
    });
  });

  it("records the server's request id, never the client's x-request-id", () => {
    const meta = requestMetadata({
      id: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f",
      ip: "203.0.113.7",
      headers: { "x-request-id": "forged-audit-id-0001" },
    });

    expect(meta.requestId).toBe("3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f");
    expect(JSON.stringify(meta)).not.toContain("forged-audit-id-0001");
  });

  it("records no IP for a client address that isn't one", () => {
    for (const ip of ["unknown", "", "203.0.113.7, 10.0.0.1", "<script>"]) {
      expect(requestMetadata({ id: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f", ip, headers: {} }).ip, ip).toBeNull();
    }
  });
});

describe("rate-limit decorators", () => {
  const route = (target: () => void, method: () => void) =>
    ({ getHandler: () => method, getClass: () => target }) as unknown as ExecutionContext;

  it("merges the policies a handler and its controller add, each once", () => {
    const Controller = (): void => undefined;
    RateLimit("orders")(Controller);
    const handler = (): void => undefined;
    RateLimit("orders")(handler);
    const plain = (): void => undefined;
    const Plain = (): void => undefined;
    const reflector = new Reflector();

    expect(extraRateLimitPolicies(reflector, route(Controller, handler))).toEqual(["orders"]);
    expect(extraRateLimitPolicies(reflector, route(Plain, plain))).toEqual([]);
  });

  it("skips rate limiting for a handler or a whole controller", () => {
    const Skipped = (): void => undefined;
    SkipRateLimit()(Skipped);
    const Plain = (): void => undefined;
    const handler = (): void => undefined;
    const skippedHandler = (): void => undefined;
    SkipRateLimit()(skippedHandler);
    const reflector = new Reflector();

    expect(skipsRateLimit(reflector, route(Skipped, handler))).toBe(true);
    expect(skipsRateLimit(reflector, route(Plain, skippedHandler))).toBe(true);
    expect(skipsRateLimit(reflector, route(Plain, handler))).toBe(false);
  });
});

describe("@Idempotent()", () => {
  class Routes {
    @Idempotent()
    place(): void {}

    list(): void {}
  }
  /** A handler as Nest's router sees it: the function on the controller's prototype. */
  const handler = (name: "place" | "list"): unknown => Reflect.get(Routes.prototype, name);
  const route = (method: unknown) =>
    ({ getHandler: () => method, getClass: () => Routes }) as unknown as ExecutionContext;

  it("marks only the decorated handler", () => {
    const reflector = new Reflector();

    expect(isIdempotentRoute(reflector, route(handler("place")))).toBe(true);
    expect(isIdempotentRoute(reflector, route(handler("list")))).toBe(false);
  });

  it("documents a required Idempotency-Key header with the shared key pattern", () => {
    const headers: unknown = Reflect.getMetadata("swagger/apiParameters", handler("place") as object);

    expect(headers).toEqual([
      expect.objectContaining({
        name: "idempotency-key",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" },
      }),
    ]);
    const pattern = new RegExp(idempotencyKeyHeaderSchema().pattern);
    expect(pattern.test("3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f")).toBe(true);
    expect(pattern.test("has:colon:1234567890")).toBe(false);
  });
});
