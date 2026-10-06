import { describe, expect, it } from "vitest";

import { loadEnv } from "../../config/env";
import { fastifyOptions, requestDeadlineMs } from "../fastify-options";
import { corsOptions, helmetOptions } from "../http-hardening";

const REQUIRED = { DATABASE_URL: "postgresql://u:p@localhost:5433/db", REDIS_URL: "redis://localhost:6380" };
const development = loadEnv(REQUIRED);
const production = loadEnv({
  ...REQUIRED,
  NODE_ENV: "production",
  API_ALLOWED_ORIGINS: "https://app.finlytics.in",
  API_TRUST_PROXY: "10.0.0.0/8",
  MASTER_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  API_PUBLIC_URL: "https://app.finlytics.in",
});

describe("Fastify options", () => {
  it("applies the security.md limits and never trusts X-Forwarded-For by default", () => {
    expect(fastifyOptions(development)).toMatchObject({
      bodyLimit: 1_048_576,
      requestTimeout: 15_000,
      keepAliveTimeout: 72_000,
      trustProxy: false,
      requestIdHeader: false,
      onProtoPoisoning: "error",
      onConstructorPoisoning: "error",
      logger: false,
      return503OnClosing: false,
      forceCloseConnections: "idle",
      routerOptions: { maxParamLength: 512, caseSensitive: true, ignoreTrailingSlash: false },
    });
    expect(fastifyOptions(production).trustProxy).toEqual(["10.0.0.0/8"]);
  });

  it("leaves Fastify's handlerTimeout off and enforces the 15 s budget with the request deadline", () => {
    // Fastify 5.12 cancels handlerTimeout once a request body has been read (request-deadline.ts).
    expect(fastifyOptions(development)).not.toHaveProperty("handlerTimeout");
    expect(requestDeadlineMs()).toBe(15_000);
    expect(requestDeadlineMs({ handlerTimeoutMs: 250 })).toBe(250);
  });

  it("sends HSTS in production only and an exact CORS allowlist with credentials", () => {
    expect(helmetOptions(development).strictTransportSecurity).toBe(false);
    expect(helmetOptions(production).strictTransportSecurity).toEqual({
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: false,
    });
    expect(corsOptions(production)).toMatchObject({ origin: ["https://app.finlytics.in"], credentials: true });
    expect(corsOptions(development).origin).not.toContain("*");
  });
});
