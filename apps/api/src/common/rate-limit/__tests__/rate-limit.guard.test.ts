import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../modules/auth/auth-identity";
import { RateLimit } from "../../decorators/rate-limit";
import { SkipRateLimit } from "../../decorators/skip-rate-limit";
import { RateLimitedError } from "../../problem-json/domain-errors";
import type { RateLimitDecision } from "../headers";
import { rateLimitPolicies } from "../policies";
import type { RateLimitPolicyName } from "../policies";
import { RateLimitGuard } from "../rate-limit.guard";
import type { RateLimitService } from "../rate-limit.service";

const POLICIES = rateLimitPolicies({ publicPerMinute: 100, userPerMinute: 600 });
const IDENTITY: AuthIdentity = { userId: "cm0user1", sessionId: "s1", role: "USER" };

const Routes = (): void => undefined; // a controller stand-in
const OrderRoutes = (): void => undefined;
RateLimit("orders")(OrderRoutes);
const handler = (): void => undefined;
const skipped = (): void => undefined;
SkipRateLimit()(skipped);

const allowed = (name: RateLimitPolicyName): RateLimitDecision => ({
  policy: POLICIES[name],
  allowed: true,
  remaining: 3,
  retryAfterMs: 0,
  resetAfterMs: 1_000,
});
const refused = (name: RateLimitPolicyName): RateLimitDecision => ({
  policy: POLICIES[name],
  allowed: false,
  remaining: 0,
  retryAfterMs: 2_500,
  resetAfterMs: 60_000,
});

function setup(decisions: Partial<Record<RateLimitPolicyName, RateLimitDecision | undefined>> = {}) {
  const limits = {
    consume: vi.fn<RateLimitService["consume"]>((name) => Promise.resolve(decisions[name] ?? allowed(name))),
    chargePublic: vi.fn<RateLimitService["chargePublic"]>(() =>
      Promise.resolve(["public" in decisions ? decisions.public : allowed("public")]),
    ),
  };
  const guard = new RateLimitGuard(new Reflector(), limits as unknown as RateLimitService);
  const reply = { header: vi.fn() };
  const context = (identity: AuthIdentity | null, method: () => void = handler, controller: () => void = Routes) =>
    ({
      getHandler: () => method,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ identity, ip: "203.0.113.7" }), getResponse: () => reply }),
    }) as unknown as ExecutionContext;
  return { guard, limits, reply, context };
}

describe("RateLimitGuard", () => {
  it("charges anonymous requests to their IP's public bucket", async () => {
    const { guard, limits, reply, context } = setup();

    await expect(guard.canActivate(context(null))).resolves.toBe(true);

    expect(limits.chargePublic).toHaveBeenCalledWith({ identity: null, ip: "203.0.113.7" });
    expect(limits.consume).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith("ratelimit-policy", '"public";q=100;w=60');
  });

  it("charges signed-in requests to their user's bucket, regardless of IP", async () => {
    const { guard, limits, reply, context } = setup();

    await guard.canActivate(context(IDENTITY));

    expect(limits.consume).toHaveBeenCalledExactlyOnceWith("user", "cm0user1");
    expect(limits.chargePublic).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith("ratelimit", '"user";r=3;t=1');
  });

  it("adds the policies a route declares, for signed-in requests only", async () => {
    const { guard, limits, reply, context } = setup();

    await guard.canActivate(context(IDENTITY, handler, OrderRoutes));
    await guard.canActivate(context(null, handler, OrderRoutes));

    expect(limits.consume.mock.calls).toEqual([
      ["user", "cm0user1"],
      ["orders", "cm0user1"],
    ]);
    expect(reply.header).toHaveBeenCalledWith("ratelimit-policy", '"user";q=600;w=60, "orders";q=10;w=1');
  });

  it("answers RATE_LIMITED with the wait, and doesn't spend the next bucket after a refusal", async () => {
    const { guard, limits, context } = setup({ user: refused("user") });

    const rejection = guard.canActivate(context(IDENTITY, handler, OrderRoutes));

    await expect(rejection).rejects.toBeInstanceOf(RateLimitedError);
    await expect(rejection).rejects.toMatchObject({ retryAfterSec: 3 });
    expect(limits.consume).toHaveBeenCalledTimes(1);
  });

  it("reports every anonymous bucket an IPv6 client was charged to, and refuses on the /48", async () => {
    const { guard, limits, reply, context } = setup();
    limits.chargePublic.mockResolvedValue([allowed("public"), refused("publicNet")]);

    await expect(guard.canActivate(context(null))).rejects.toBeInstanceOf(RateLimitedError);
    expect(reply.header).toHaveBeenCalledWith("ratelimit-policy", '"public";q=100;w=60, "publicNet";q=2000;w=60');
    expect(reply.header).toHaveBeenCalledWith("ratelimit", '"public";r=3;t=1, "publicNet";r=0;t=60');
  });

  it("lets the request through without headers when the store failed open", async () => {
    const { guard, reply, context } = setup({ public: undefined });

    await expect(guard.canActivate(context(null))).resolves.toBe(true);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("leaves @SkipRateLimit() routes alone", async () => {
    const { guard, limits, reply, context } = setup();

    await expect(guard.canActivate(context(null, skipped))).resolves.toBe(true);
    await expect(guard.canActivate(context(IDENTITY, skipped))).resolves.toBe(true);

    expect(limits.chargePublic).not.toHaveBeenCalled();
    expect(limits.consume).not.toHaveBeenCalled();
    expect(reply.header).not.toHaveBeenCalled();
  });
});
