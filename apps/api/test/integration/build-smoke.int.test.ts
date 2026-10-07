/**
 * The compiled app as production runs it (plan D1, D2, D16): `node --enable-source-maps dist/main.js`, built by tsc
 * (decorator metadata from tsc, not Oxc). Run after `pnpm build`; `turbo run test:integration` builds first.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, inject, it } from "vitest";

import { PRODUCTION_ENV, closedPort } from "./app";
import { createAppRole, fixturesClient } from "./fixtures";

const APP_ROOT = path.resolve(__dirname, "../..");
const MAIN = path.join(APP_ROOT, "dist", "main.js");

interface Started {
  readonly child: ChildProcess;
  readonly output: { stdout: string; stderr: string };
  readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Starts dist/main.js with exactly `env` (plus PATH): nothing from the shell or the root .env leaks in. */
function start(env: Readonly<Record<string, string>>): Started {
  const child = spawn(process.execPath, ["--enable-source-maps", MAIN], {
    cwd: APP_ROOT,
    env: { PATH: process.env["PATH"] ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output.stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output.stderr += chunk));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return { child, output, exit };
}

/** Polls `url` until it answers, or fails after `timeoutMs`. */
async function waitFor(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fetch(url);
    } catch (error: unknown) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => {
        reject(new Error(`${what} timed out`));
      }, ms),
    ),
  ]);
}

describe("build smoke test (dist/main.js)", () => {
  beforeAll(() => {
    if (!existsSync(MAIN)) throw new Error("dist/main.js is missing: run `pnpm --filter @finlytics/api build` first");
  });

  const baseEnv = () => ({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    REDIS_URL: inject("redisUrl"),
    API_HOST: "127.0.0.1",
    API_LOG_LEVEL: "info",
    API_LOG_FORMAT: "json",
  });

  it("boots the compiled CJS server, answers /health/live and exits 0 on SIGTERM", async () => {
    const port = await closedPort();
    const { child, output, exit } = start({ ...baseEnv(), API_PORT: String(port) });
    try {
      const live = await waitFor(`http://127.0.0.1:${String(port)}/health/live`, 20_000);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: "ok" });
      expect(live.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      const ready = await fetch(`http://127.0.0.1:${String(port)}/health/ready`);
      expect(ready.status).toBe(200);

      child.kill("SIGTERM");
      expect(await withTimeout(exit, 10_000, "shutdown")).toEqual({ code: 0, signal: null });
      // JSON logs only, one object per line, with the ordered shutdown in them.
      const lines = output.stdout.split("\n").filter((line) => line !== "");
      const messages = lines.map((line) => (JSON.parse(line) as { msg: string }).msg);
      expect(messages).toEqual(
        expect.arrayContaining([
          "shutting down: readiness reports draining",
          "shutdown complete: database and redis closed",
        ]),
      );
      expect(output.stdout).not.toContain(inject("databaseUrl"));
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("serves /docs from the compiled server in development, and not at all in production", async () => {
    // Development: Swagger UI and the OpenAPI document, listing exactly the api's routes (no test probes in dist).
    const devPort = await closedPort();
    const dev = start({ ...baseEnv(), NODE_ENV: "development", API_PORT: String(devPort) });
    try {
      const docs = await waitFor(`http://127.0.0.1:${String(devPort)}/docs/json`, 20_000);
      expect(docs.status).toBe(200);
      const document = (await docs.json()) as { openapi: string; paths: Record<string, unknown> };
      expect(document.openapi).toBe("3.1.0");
      expect(Object.keys(document.paths).sort()).toEqual([
        "/health/live",
        "/health/ready",
        "/v1/admin/instruments/sync",
        "/v1/brokers",
        "/v1/brokers/dhan",
        "/v1/brokers/limits",
        "/v1/brokers/paper",
        "/v1/brokers/upstox",
        "/v1/brokers/upstox/callback",
        "/v1/brokers/{id}",
        "/v1/brokers/{id}/relogin",
        "/v1/candles",
        "/v1/instruments",
        "/v1/instruments/{key}",
        "/v1/market/overview",
        "/v1/me",
        "/v1/me/settings",
        "/v1/notifications",
        "/v1/notifications/read",
        "/v1/portfolio/funds",
        "/v1/portfolio/holdings",
        "/v1/portfolio/positions",
        "/v1/quotes",
        "/v1/quotes/depth",
        "/v1/udf/config",
        "/v1/udf/history",
        "/v1/udf/search",
        "/v1/udf/symbols",
        "/v1/udf/time",
        "/v1/watchlists",
        "/v1/watchlists/{id}",
        "/v1/watchlists/{id}/items",
        "/v1/watchlists/{id}/items/order",
        "/v1/watchlists/{id}/items/{itemId}",
      ]);
      const ui = await fetch(`http://127.0.0.1:${String(devPort)}/docs`);
      expect(ui.status).toBe(200);
      expect(ui.headers.get("content-type")).toMatch(/^text\/html/);
    } finally {
      dev.child.kill("SIGTERM");
      await withTimeout(dev.exit, 10_000, "development shutdown");
    }

    // Production, as a role that may start it (not a superuser): no docs routes at all.
    const fixtures = fixturesClient();
    const appRoleUrl = await createAppRole(fixtures, inject("databaseUrl"));
    await fixtures.$disconnect();
    const prodPort = await closedPort();
    const prod = start({ ...baseEnv(), ...PRODUCTION_ENV, DATABASE_URL: appRoleUrl, API_PORT: String(prodPort) });
    try {
      expect((await waitFor(`http://127.0.0.1:${String(prodPort)}/health/live`, 20_000)).status).toBe(200);
      for (const path of ["/docs", "/docs/json", "/docs/swagger-ui.css"]) {
        const response = await fetch(`http://127.0.0.1:${String(prodPort)}${path}`);
        expect(response.status, path).toBe(404);
        expect(response.headers.get("content-type"), path).toBe("application/problem+json; charset=utf-8");
      }
      prod.child.kill("SIGTERM");
      expect(await withTimeout(prod.exit, 10_000, "production shutdown")).toEqual({ code: 0, signal: null });
    } finally {
      prod.child.kill("SIGKILL");
    }
  });

  it("exits 1 on an invalid environment, naming the variable without its value", async () => {
    const { output, exit } = start({ ...baseEnv(), API_PORT: "abc", REDIS_URL: "http://user:hunter2@example" });

    expect(await withTimeout(exit, 10_000, "exit")).toEqual({ code: 1, signal: null });
    expect(output.stderr).toContain("API_PORT: must be an integer from 0 to 65535");
    expect(output.stderr).toContain("REDIS_URL: must be a redis:// or rediss:// URL");
    expect(output.stderr).not.toMatch(/abc|hunter2/);
  });

  it("refuses to start in production as a superuser", async () => {
    const port = await closedPort();
    const { output, exit } = start({ ...baseEnv(), ...PRODUCTION_ENV, API_PORT: String(port) });

    expect(await withTimeout(exit, 20_000, "exit")).toEqual({ code: 1, signal: null });
    const fatal = output.stderr
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { msg: string; err: { type: string } });
    expect(fatal).toEqual([
      expect.objectContaining({
        msg: "startup failed",
        err: expect.objectContaining({ type: "UnsafeDatabaseRoleError" }) as unknown,
      }),
    ]);
    expect(output.stderr).not.toContain(inject("databaseUrl"));
  });
});
