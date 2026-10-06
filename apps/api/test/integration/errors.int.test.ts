/**
 * Problem details and HTTP hardening end to end (plan D4, D11): every 4xx/5xx is application/problem+json, passes
 * ProblemDetailsSchema and carries the response's x-request-id; nothing internal ever reaches a body.
 */
import type { PrismaClient } from "@finlytics/database";
import { PROBLEM_JSON_MEDIA_TYPE, ProblemDetailsSchema } from "@finlytics/shared";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GUARD_DELAY_HEADER } from "../support/delay.guard";
import { LEAK_MARKER } from "../support/probe.module";

import { createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, sessionCookie } from "./fixtures";

/** Asserts a well-formed problem: media type, schema, status, code and the x-request-id correlation. */
function expectProblem(response: LightMyRequestResponse, status: number, code: string): Record<string, unknown> {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers["content-type"]).toBe(`${PROBLEM_JSON_MEDIA_TYPE}; charset=utf-8`);
  expect(response.headers["cache-control"]).toBe("no-store");
  const problem = ProblemDetailsSchema.parse(json(response));
  expect(problem.code).toBe(code);
  expect(problem.requestId).toBe(response.headers["x-request-id"]);
  return problem;
}

/** Nothing internal: no stack frames, SQL, Prisma, the probe's secret or a query string. */
function expectNothingInternal(response: LightMyRequestResponse): void {
  expect(response.body).not.toMatch(/\bat \S+ \(|\bSELECT\b|NoSuchTable|prisma|\?token=|stack/i);
  expect(response.body).not.toContain(LEAK_MARKER);
}

describe("problems and hardening", () => {
  let testApp: TestApp;
  let fixtures: PrismaClient;
  let cookie: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    fixtures = fixturesClient();
    const user = await createUser(fixtures);
    cookie = sessionCookie((await createSession(fixtures, user.id)).token);
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
  });

  it("answers unknown routes with a NOT_FOUND problem and x-request-id", async () => {
    const response = await testApp.request({ method: "GET", url: "/v1/nope?token=abc123" });

    const problem = expectProblem(response, 404, "NOT_FOUND");
    expect(problem.instance).toBe("/v1/nope");
    expect(problem).not.toHaveProperty("detail");
    expectNothingInternal(response);
  });

  it("generates every request id on the server, whatever x-request-id the client sends", async () => {
    const responses = [
      await testApp.request({ method: "GET", url: "/v1/nope", headers: { "x-request-id": "req-12345678" } }),
      await testApp.request({ method: "GET", url: "/v1/nope", headers: { "x-request-id": "req-12345678" } }),
      await testApp.request({ method: "GET", url: "/v1/nope", headers: { "x-request-id": "bad id\twith space" } }),
      await testApp.request({ method: "GET", url: "/v1/nope" }),
    ];

    const ids = responses.map((response) => expectProblem(response, 404, "NOT_FOUND").requestId);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("answers a malformed URL with a VALIDATION problem (Fastify's default body would echo the whole URL)", async () => {
    const response = await testApp.request({ method: "GET", url: "/v1/%E0%A4%A?token=abc123" });

    const problem = expectProblem(response, 400, "VALIDATION");
    expect(problem.detail).toBe("The request URL is not valid.");
    expect(problem.instance).toBe("/v1/%E0%A4%A");
    expect(response.body).not.toContain("token");
  });

  it("answers bodies over 1 MiB with PAYLOAD_TOO_LARGE", async () => {
    const response = await testApp.request({
      method: "POST",
      url: "/v1/__test__/echo",
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ value: "x".repeat(1_048_576) }),
    });

    expect(expectProblem(response, 413, "PAYLOAD_TOO_LARGE").detail).toBe("The request body exceeds 1 MiB.");
  });

  it("answers form-encoded and text/plain bodies with UNSUPPORTED_MEDIA_TYPE", async () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const response = await testApp.request({
        method: "POST",
        url: "/v1/__test__/echo",
        headers: { "content-type": contentType, cookie },
        payload: "value=x",
      });

      expect(expectProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE").detail, contentType).toBe(
        "Send request bodies as application/json.",
      );
    }
  });

  it("answers malformed JSON, an empty JSON body and prototype poisoning with VALIDATION", async () => {
    for (const payload of ['{"value":', "", '{"__proto__":{"admin":true},"value":"x"}']) {
      const response = await testApp.request({
        method: "POST",
        url: "/v1/__test__/echo",
        headers: { "content-type": "application/json", cookie },
        payload,
      });

      expect(expectProblem(response, 400, "VALIDATION").detail, payload).toBe("The request body is not valid JSON.");
    }
  });

  it("answers an invalid body with VALIDATION and dot-path field errors, sanitising unknown keys", async () => {
    const response = await testApp.request({
      method: "POST",
      url: "/v1/__test__/echo",
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ value: "", nested: { flag: "yes" }, "evil\nkey": 1 }),
    });

    const problem = expectProblem(response, 400, "VALIDATION");
    expect(problem.detail).toBe("The request is invalid.");
    expect(problem.errors).toEqual([
      { path: "value", message: expect.any(String) as string, code: "too_small" },
      { path: "nested.flag", message: expect.any(String) as string, code: "invalid_type" },
      { path: "evil�key", message: "Unknown field.", code: "unrecognized_keys" },
    ]);
  });

  it("answers SERVICE_UNAVAILABLE when a handler exceeds the request timeout", async () => {
    const short = await createTestApp({}, { handlerTimeoutMs: 200 });
    try {
      const response = await short.request({ method: "GET", url: "/v1/__test__/slow?ms=600" });

      const problem = expectProblem(response, 503, "SERVICE_UNAVAILABLE");
      expect(problem.detail).toBe("The request took too long.");
      expect(problem.retryAfterSec).toBe(5);
      expect(response.headers["retry-after"]).toBe("5");
      // The handler keeps running after the 503; let it finish before closing.
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await short.close();
    }
  });

  it("times out a request with a body over a real socket", async () => {
    // Fastify's handlerTimeout was cancelled as soon as a body had been read, which inject() never showed: this goes
    // through a real connection, with a JSON body, to the request deadline that replaced it.
    const short = await createTestApp({}, { handlerTimeoutMs: 200, listen: true });
    try {
      await short.app.listen({ host: "127.0.0.1", port: 0 });
      const started = Date.now();
      const response = await fetch(`${await short.app.getUrl()}/v1/__test__/slow?ms=1500`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ any: "body" }),
      });
      const elapsedMs = Date.now() - started;

      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      expect(((await response.json()) as { code: string }).code).toBe("SERVICE_UNAVAILABLE");
      expect(response.headers.get("retry-after")).toBe("5");
      expect(elapsedMs).toBeLessThan(1_000);
      // Let the handler finish before closing the server.
      await new Promise((resolve) => setTimeout(resolve, 1_400));
    } finally {
      await short.close();
    }
  });

  it("runs no handler for a request that timed out before its handler started", async () => {
    const short = await createTestApp({}, { handlerTimeoutMs: 200 });
    try {
      const value = `timed-out-${String(Date.now())}`;
      const response = await short.request({
        method: "POST",
        url: "/v1/__test__/guarded",
        headers: { "content-type": "application/json", [GUARD_DELAY_HEADER]: "500" },
        payload: JSON.stringify({ value }),
      });

      expectProblem(response, 503, "SERVICE_UNAVAILABLE");
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(json(await short.request({ method: "GET", url: `/v1/__test__/guarded/${value}` }))).toEqual({
        ran: false,
      });
    } finally {
      await short.close();
    }
  });

  it("runs no handler for a request whose client went away before its handler started", async () => {
    const real = await createTestApp({}, { listen: true });
    try {
      await real.app.listen({ host: "127.0.0.1", port: 0 });
      const base = await real.app.getUrl();
      const send = (value: string, signal?: AbortSignal) =>
        fetch(`${base}/v1/__test__/guarded`, {
          method: "POST",
          headers: { "content-type": "application/json", [GUARD_DELAY_HEADER]: "400" },
          body: JSON.stringify({ value }),
          ...(signal === undefined ? {} : { signal }),
        });
      const ran = async (value: string) =>
        ((await (await fetch(`${base}/v1/__test__/guarded/${value}`)).json()) as { ran: boolean }).ran;

      const abandoned = `abandoned-${String(Date.now())}`;
      await expect(send(abandoned, AbortSignal.timeout(100))).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(await ran(abandoned)).toBe(false);

      // The same request, waited for, runs.
      const kept = `kept-${String(Date.now())}`;
      expect((await send(kept)).status).toBe(200);
      expect(await ran(kept)).toBe(true);
    } finally {
      await real.close();
    }
  });

  it("answers SERVICE_UNAVAILABLE when the pool is exhausted beyond DB_CONNECT_TIMEOUT_MS", async () => {
    const small = await createTestApp({ DB_POOL_MAX: "1", DB_CONNECT_TIMEOUT_MS: "200" });
    try {
      const holder = small.request({ method: "GET", url: "/v1/__test__/db/sleep?ms=1200" });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const waiter = await small.request({ method: "GET", url: "/v1/__test__/db/ping" });

      const problem = expectProblem(waiter, 503, "SERVICE_UNAVAILABLE");
      expect(problem.retryAfterSec).toBe(5);
      expectNothingInternal(waiter);
      expect((await holder).statusCode).toBe(200);
    } finally {
      await small.close();
    }
  });

  it("never includes stack traces, SQL or query strings in any error body", async () => {
    const requests = [
      { method: "GET", url: "/v1/__test__/boom?token=abc" },
      { method: "GET", url: "/v1/__test__/db/bad-sql?token=abc" },
      { method: "GET", url: "/v1/nothing-here?token=abc" },
      { method: "GET", url: "/v1/me?token=abc" },
      { method: "POST", url: "/v1/__test__/echo?token=abc", headers: { "content-type": "text/plain" }, payload: "x" },
    ] as const;
    for (const options of requests) {
      const response = await testApp.request(options);

      expect(response.statusCode, options.url).toBeGreaterThanOrEqual(400);
      expect(response.headers["content-type"]).toBe(`${PROBLEM_JSON_MEDIA_TYPE}; charset=utf-8`);
      ProblemDetailsSchema.parse(json(response));
      expectNothingInternal(response);
    }
    expectProblem(await testApp.request(requests[0]), 500, "INTERNAL");
    expectProblem(await testApp.request(requests[1]), 500, "INTERNAL");
  });

  it("sends the helmet headers and no X-Powered-By", async () => {
    const response = await testApp.request({ method: "GET", url: "/health/live" });

    expect(response.headers).toMatchObject({
      "content-security-policy": "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-site",
      "x-frame-options": "DENY",
    });
    expect(response.headers).not.toHaveProperty("x-powered-by");
    // HSTS is production-only (see health.int.test.ts for the production header).
    expect(response.headers).not.toHaveProperty("strict-transport-security");
  });

  it("answers CORS preflights only for allowed origins", async () => {
    const preflight = (origin: string) =>
      testApp.request({
        method: "OPTIONS",
        url: "/v1/me",
        headers: {
          origin,
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "content-type, idempotency-key",
        },
      });

    const allowed = await preflight("http://localhost:3000");
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers).toMatchObject({
      "access-control-allow-origin": "http://localhost:3000",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
      "access-control-allow-headers": "content-type, idempotency-key, x-request-id",
      "access-control-max-age": "600",
    });

    const refused = await preflight("https://evil.example");
    // Without Access-Control-Allow-Origin the browser refuses the preflight (@fastify/cors still sends
    // allow-credentials, which is harmless on its own).
    expect(refused.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("sets Cache-Control: no-store on /v1, on health and on problems", async () => {
    const responses = [
      await testApp.request({ method: "GET", url: "/v1/me", headers: { cookie } }),
      await testApp.request({ method: "GET", url: "/health/live" }),
      await testApp.request({ method: "GET", url: "/v1/nope" }),
    ];

    expect(responses.map((response) => response.headers["cache-control"])).toEqual([
      "no-store",
      "no-store",
      "no-store",
    ]);
  });

  it("serialises bigint and Decimal values as strings", async () => {
    const response = await testApp.request({ method: "GET", url: "/v1/__test__/bigint" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"id":"9007199254740993","price":"24000.0500"}');
  });
});
