/**
 * Builds apps for the integration tests with the production bootstrap (createHttpApp: the same Fastify options,
 * hardening, filter and global enhancers as main.ts), against the run's containers. Requests go through Fastify's
 * `inject` unless a test listens on a real port.
 */
import { createServer } from "node:net";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { inject } from "vitest";

import { createHttpApp } from "../../src/bootstrap/http-app";
import type { HttpAppOptions } from "../../src/bootstrap/http-app";
import { loadEnv } from "../../src/config/env";
import type { Env } from "../../src/config/env.schema";
import { ProbeModule } from "../support/probe.module";

import { logCapture } from "./log-capture";

/**
 * Rate limits for test apps. Every test file's `inject()` requests come from 127.0.0.1 and every file shares one Redis,
 * so security.md's limits (100 per minute per IP) would let one file throttle another. rate-limit.int.test.ts sets
 * its own limits, and gives each test its own client addresses.
 */
export const TEST_RATE_LIMITS = Object.freeze({
  API_RATE_LIMIT_PUBLIC_PER_MIN: "100000",
  API_RATE_LIMIT_USER_PER_MIN: "100000",
});

/**
 * The environment of a test app: NODE_ENV=test, the run's database and Redis, debug logs (to the capture, never
 * stdout), generous rate limits, plus `overrides`. An override of `undefined` removes the variable (so the schema's
 * default applies).
 */
export function testEnv(overrides: Readonly<Record<string, string | undefined>> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    REDIS_URL: inject("redisUrl"),
    API_LOG_LEVEL: "debug",
    API_LOG_FORMAT: "json",
    ...TEST_RATE_LIMITS,
    ...overrides,
  });
}

/** Variables a production-mode test app needs (production rules: explicit origins and proxies, JSON logs). */
export const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: "production",
  API_ALLOWED_ORIGINS: "https://app.finlytics.test",
  API_TRUST_PROXY: "false",
  API_SHUTDOWN_DRAIN_MS: "0",
});

export interface TestApp {
  readonly app: NestFastifyApplication;
  readonly env: Env;
  readonly request: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  readonly close: () => Promise<void>;
}

export interface TestAppOptions extends HttpAppOptions {
  /** Add the `/v1/__test__` probe routes (test/support/probe.module.ts). Defaults to true. */
  readonly probes?: boolean;
  /** Skip `init()`, for tests that call `listen()` themselves. */
  readonly listen?: boolean;
}

/** Builds and initialises an app. Close it in the matching teardown. */
export async function createTestApp(
  overrides: Readonly<Record<string, string | undefined>> = {},
  options: TestAppOptions = {},
): Promise<TestApp> {
  const env = testEnv(overrides);
  const { probes = true, listen = false, ...httpOptions } = options;
  const app = await createHttpApp(env, {
    logDestination: logCapture,
    ...httpOptions,
    extraImports: [...(probes ? [ProbeModule] : []), ...(httpOptions.extraImports ?? [])],
  });
  if (!listen) {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }
  return {
    app,
    env,
    request: (requestOptions) => app.inject(requestOptions),
    close: () => app.close(),
  };
}

/** A local TCP port with nothing listening on it: a URL there simulates a dependency that is down. */
export async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string") reject(new Error("no port"));
        else resolve(address.port);
      });
    });
  });
}

/** The response body parsed as JSON. */
export function json(response: LightMyRequestResponse): Record<string, unknown> {
  return response.json<Record<string, unknown>>();
}
