import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RateLimitService } from "../../../common/rate-limit/rate-limit.service";
import type { Env } from "../../../config/env.schema";
import type { SessionService } from "../../auth/session.service";
import type { RealtimeRepository } from "../realtime.repository";
import { RealtimeService } from "../realtime.service";

const TOKEN = "a".repeat(43);
const IDENTITY = { userId: "user-1", sessionId: "s1", role: "USER" as const };
const ORIGIN = "http://localhost:3000";

function setup(
  options: {
    resolve?: () => Promise<typeof IDENTITY | null>;
    maxSubscriptions?: () => Promise<number>;
    known?: boolean;
    refusedCharge?: boolean;
  } = {},
) {
  const values: Record<string, unknown> = {
    API_ALLOWED_ORIGINS: [ORIGIN],
    NODE_ENV: "test",
    API_TRUST_PROXY: ["10.0.0.0/8"],
    REDIS_URL: "redis://127.0.0.1:1",
    MARKET_FEED_SOURCE: "paper",
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  const sessions = { resolve: vi.fn(options.resolve ?? (() => Promise.resolve(IDENTITY))) };
  const repository = { maxSubscriptions: vi.fn(options.maxSubscriptions ?? (() => Promise.resolve(25))) };
  const rateLimits = {
    knownPublicRefusal: vi.fn(() => (options.known === true ? { allowed: false } : undefined)),
    chargePublic: vi.fn(() => Promise.resolve([{ allowed: options.refusedCharge !== true }])),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const service = new RealtimeService(
    config,
    repository as unknown as RealtimeRepository,
    sessions as unknown as SessionService,
    rateLimits as unknown as RateLimitService,
    logger as unknown as PinoLogger,
  );
  return { service, sessions, repository, rateLimits, logger };
}

const request = (headers: Record<string, string | undefined>) => ({
  headers: { origin: ORIGIN, cookie: `authjs.session-token=${TOKEN}`, ...headers },
  remoteAddress: "10.0.0.2",
});

describe("RealtimeService.authenticate", () => {
  const services: RealtimeService[] = [];
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.beforeApplicationShutdown()));
  });

  it("accepts a valid session from an allowed origin, with the plan's limit", async () => {
    const { service, sessions } = setup();
    services.push(service);

    expect(await service.authenticate(request({}))).toEqual({ ok: true, identity: IDENTITY, maxSubscriptions: 25 });
    expect(sessions.resolve).toHaveBeenCalledWith(TOKEN);
    service.onApplicationBootstrap();
  });

  it("rejects a foreign origin before looking at the cookie", async () => {
    const { service, sessions } = setup();
    services.push(service);

    expect(await service.authenticate(request({ origin: "https://evil.example" }))).toEqual({
      ok: false,
      code: "FORBIDDEN_ORIGIN",
    });
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed cookie without a lookup, and charges the client's IP", async () => {
    const { service, sessions, rateLimits } = setup();
    services.push(service);

    expect(await service.authenticate(request({ cookie: undefined }))).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await service.authenticate(request({ cookie: "authjs.session-token=short" }))).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(sessions.resolve).not.toHaveBeenCalled();
    expect(rateLimits.chargePublic).toHaveBeenCalledWith({ ip: "10.0.0.2" });
  });

  it("rejects an unknown session, and says RATE_LIMITED once the IP is out of budget", async () => {
    const unknown = setup({ resolve: () => Promise.resolve(null) });
    services.push(unknown.service);
    expect(await unknown.service.authenticate(request({}))).toEqual({ ok: false, code: "UNAUTHENTICATED" });

    const refused = setup({ resolve: () => Promise.resolve(null), refusedCharge: true });
    services.push(refused.service);
    expect(await refused.service.authenticate(request({}))).toEqual({ ok: false, code: "RATE_LIMITED" });

    const known = setup({ known: true });
    services.push(known.service);
    expect(await known.service.authenticate(request({}))).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(known.sessions.resolve).not.toHaveBeenCalled();
  });

  it("answers SERVICE_UNAVAILABLE when the session or plan lookup fails", async () => {
    const sessionDown = setup({ resolve: () => Promise.reject(new Error("db down")) });
    services.push(sessionDown.service);
    expect(await sessionDown.service.authenticate(request({}))).toEqual({ ok: false, code: "SERVICE_UNAVAILABLE" });

    const planDown = setup({ maxSubscriptions: () => Promise.reject(new Error("db down")) });
    services.push(planDown.service);
    expect(await planDown.service.authenticate(request({}))).toEqual({ ok: false, code: "SERVICE_UNAVAILABLE" });
  });
});
