import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import { Public } from "../../../common/decorators/public";
import { RateLimitedError, UnauthenticatedError } from "../../../common/problem-json/domain-errors";
import type { RateLimitDecision } from "../../../common/rate-limit/headers";
import { rateLimitPolicies } from "../../../common/rate-limit/policies";
import type { RateLimitService } from "../../../common/rate-limit/rate-limit.service";
import type { Env } from "../../../config/env.schema";
import type { AuthIdentity } from "../auth-identity";
import { AuthGuard } from "../auth.guard";
import { SessionGuard } from "../session.guard";
import type { SessionService } from "../session.service";

const IDENTITY: AuthIdentity = { userId: "u1", sessionId: "s1", role: "USER" };
const TOKEN = "t".repeat(43);
const POLICIES = rateLimitPolicies({ publicPerMinute: 100, userPerMinute: 600 });

const Routes = (): void => undefined; // a controller stand-in
const me = (): void => undefined;
// A function declaration: like a controller class it has a prototype, which @Public()'s ApiExtension reads.
function live(): void {}
Public()(live);

interface FakeRequest {
  cookies: Record<string, string>;
  identity: AuthIdentity | null;
  ip?: string;
}

function context(request: FakeRequest, handler: () => void = me, reply = { header: vi.fn() }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;
}

function publicDecision(allowed: boolean): RateLimitDecision {
  return {
    policy: POLICIES.public,
    allowed,
    remaining: allowed ? 99 : 0,
    retryAfterMs: allowed ? 0 : 600,
    resetAfterMs: allowed ? 600 : 60_000,
  };
}

/** `charge`: the public bucket's answer; `undefined` means the store failed open. */
function sessionGuard(
  nodeEnv: Env["NODE_ENV"] = "test",
  identity: AuthIdentity | null = IDENTITY,
  ...charge: [RateLimitDecision | undefined] | []
) {
  const sessions = { resolve: vi.fn<SessionService["resolve"]>().mockResolvedValue(identity) };
  const decision = charge.length === 0 ? publicDecision(true) : charge[0];
  const rateLimits = {
    chargePublic: vi.fn<RateLimitService["chargePublic"]>().mockResolvedValue([decision]),
    knownPublicRefusal: vi.fn<RateLimitService["knownPublicRefusal"]>().mockReturnValue(undefined),
  };
  const config = { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
  return {
    guard: new SessionGuard(
      new Reflector(),
      sessions as unknown as SessionService,
      rateLimits as unknown as RateLimitService,
      config,
    ),
    sessions,
    rateLimits,
  };
}

describe("SessionGuard", () => {
  it("treats a missing cookie as anonymous", async () => {
    const { guard, sessions } = sessionGuard();
    const request: FakeRequest = { cookies: {}, identity: null };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.identity).toBeNull();
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it("skips the lookup for a malformed cookie", async () => {
    const { guard, sessions } = sessionGuard();

    await expect(guard.resolve({ cookies: { "authjs.session-token": "not a token!" } })).resolves.toEqual({
      outcome: "anonymous",
      identity: null,
    });
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it("sets request.identity from the session cookie", async () => {
    const { guard, sessions, rateLimits } = sessionGuard();
    const request: FakeRequest = { cookies: { "authjs.session-token": TOKEN }, identity: null };

    await guard.canActivate(context(request));

    expect(sessions.resolve).toHaveBeenCalledWith(TOKEN);
    expect(request.identity).toEqual(IDENTITY);
    expect(rateLimits.chargePublic).not.toHaveBeenCalled();
  });

  it("reads the __Host- cookie in production and reports a rejected lookup", async () => {
    const { guard } = sessionGuard("production", null);

    await expect(guard.resolve({ cookies: { "authjs.session-token": TOKEN } })).resolves.toMatchObject({
      outcome: "anonymous",
    });
    await expect(guard.resolve({ cookies: { "__Host-authjs.session-token": TOKEN } })).resolves.toEqual({
      outcome: "rejected",
      identity: null,
    });
  });

  it("charges a failed lookup to the caller's public bucket and reports it in the headers", async () => {
    const { guard, rateLimits } = sessionGuard("test", null);
    const request: FakeRequest = { cookies: { "authjs.session-token": TOKEN }, identity: null, ip: "203.0.113.7" };
    const reply = { header: vi.fn() };

    await expect(guard.canActivate(context(request, me, reply))).resolves.toBe(true);

    expect(request.identity).toBeNull();
    expect(rateLimits.chargePublic).toHaveBeenCalledExactlyOnceWith(request);
    expect(reply.header).toHaveBeenCalledWith("ratelimit", '"public";r=99;t=1');
  });

  it("answers RATE_LIMITED for a failed lookup once the caller's public bucket is empty", async () => {
    const { guard } = sessionGuard("test", null, publicDecision(false));
    const request: FakeRequest = { cookies: { "authjs.session-token": TOKEN }, identity: null, ip: "203.0.113.7" };

    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("lets a failed lookup through when the rate-limit store failed open", async () => {
    const { guard } = sessionGuard("test", null, undefined);
    const request: FakeRequest = { cookies: { "authjs.session-token": TOKEN }, identity: null };
    const reply = { header: vi.fn() };

    await expect(guard.canActivate(context(request, me, reply))).resolves.toBe(true);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("refuses an address it already knows is limited before looking its cookie up", async () => {
    const { guard, sessions, rateLimits } = sessionGuard("test", null);
    rateLimits.knownPublicRefusal.mockReturnValue(publicDecision(false));
    const request: FakeRequest = { cookies: { "authjs.session-token": TOKEN }, identity: null, ip: "203.0.113.7" };
    const reply = { header: vi.fn() };

    await expect(guard.canActivate(context(request, me, reply))).rejects.toBeInstanceOf(RateLimitedError);

    expect(rateLimits.knownPublicRefusal).toHaveBeenCalledExactlyOnceWith(request);
    expect(sessions.resolve).not.toHaveBeenCalled();
    expect(rateLimits.chargePublic).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith("ratelimit", '"public";r=0;t=60');
  });

  it("checks for a known refusal only when a lookup would follow", async () => {
    const { guard, rateLimits } = sessionGuard();
    rateLimits.knownPublicRefusal.mockReturnValue(publicDecision(false));

    for (const cookies of [{}, { "authjs.session-token": "not a token!" }]) {
      await expect(guard.canActivate(context({ cookies, identity: null }))).resolves.toBe(true);
    }
    expect(rateLimits.knownPublicRefusal).not.toHaveBeenCalled();
  });

  it("skips public routes entirely", async () => {
    const { guard, sessions } = sessionGuard();
    const request: FakeRequest = { cookies: { "authjs.session-token": TOKEN }, identity: null };

    await expect(guard.canActivate(context(request, live))).resolves.toBe(true);
    expect(sessions.resolve).not.toHaveBeenCalled();
  });
});

describe("AuthGuard", () => {
  const guard = new AuthGuard(new Reflector());

  it("answers UNAUTHENTICATED without an identity, except on public routes", () => {
    expect(() => guard.canActivate(context({ cookies: {}, identity: null }))).toThrow(UnauthenticatedError);
    expect(guard.canActivate(context({ cookies: {}, identity: null }, live))).toBe(true);
    expect(guard.canActivate(context({ cookies: {}, identity: IDENTITY }))).toBe(true);
  });
});
