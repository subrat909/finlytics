/**
 * Session authentication and CSRF end to end (plan D9, D10): Auth.js database sessions (rows inserted the way the
 * 0.6 adapter will write them), validated by the api.
 */
import type { PrismaClient } from "@finlytics/database";
import { MeSchema, ProblemDetailsSchema } from "@finlytics/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closedPort, createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, daysAgo, fixturesClient, newSessionToken, sessionCookie } from "./fixtures";

describe("GET /v1/me", () => {
  let testApp: TestApp;
  let fixtures: PrismaClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    fixtures = fixturesClient();
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
  });

  const me = (cookie?: string) =>
    testApp.request({ method: "GET", url: "/v1/me", headers: cookie === undefined ? {} : { cookie } });

  const expectUnauthenticated = async (cookie?: string) => {
    const response = await me(cookie);
    expect(response.statusCode, response.body).toBe(401);
    expect(ProblemDetailsSchema.parse(json(response)).code).toBe("UNAUTHENTICATED");
  };

  it("returns the signed-in user from GET /v1/me", async () => {
    const user = await createUser(fixtures, { name: "Asha" });
    const { token } = await createSession(fixtures, user.id);

    const response = await me(sessionCookie(token));

    expect(response.statusCode, response.body).toBe(200);
    expect(MeSchema.parse(json(response))).toEqual({
      id: user.id,
      email: user.email,
      name: "Asha",
      image: null,
      timezone: "Asia/Kolkata",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
    });
  });

  it("answers UNAUTHENTICATED without a cookie and for malformed or unknown tokens", async () => {
    await expectUnauthenticated();
    await expectUnauthenticated(sessionCookie("short"));
    await expectUnauthenticated(sessionCookie(newSessionToken()));
  });

  it("answers UNAUTHENTICATED for expired, idle, over-age and deleted-user sessions", async () => {
    const user = await createUser(fixtures);
    const deleted = await createUser(fixtures, { deletedAt: new Date() });
    const sessions = [
      await createSession(fixtures, user.id, { expires: daysAgo(0.01) }),
      await createSession(fixtures, user.id, { lastSeenAt: daysAgo(7.01) }),
      await createSession(fixtures, user.id, { createdAt: daysAgo(30.01), lastSeenAt: new Date() }),
      await createSession(fixtures, deleted.id),
    ];

    for (const { token } of sessions) await expectUnauthenticated(sessionCookie(token));
  });

  it("never matches a session stored with the raw token", async () => {
    const user = await createUser(fixtures);
    const { token } = await createSession(fixtures, user.id, { storeRawToken: true });

    await expectUnauthenticated(sessionCookie(token));
  });

  it("writes lastSeenAt at most every 5 minutes", async () => {
    const user = await createUser(fixtures);
    const stale = daysAgo(1);
    const { id, token } = await createSession(fixtures, user.id, { lastSeenAt: stale });
    const lastSeen = async () =>
      (await fixtures.session.findUniqueOrThrow({ where: { id }, select: { lastSeenAt: true } })).lastSeenAt;

    expect((await me(sessionCookie(token))).statusCode).toBe(200);
    const touched = await lastSeen();
    expect(touched.getTime()).toBeGreaterThan(stale.getTime());

    expect((await me(sessionCookie(token))).statusCode).toBe(200);
    expect(await lastSeen()).toEqual(touched);
  });

  it("answers SERVICE_UNAVAILABLE, not UNAUTHENTICATED, when the database is down", async () => {
    const port = await closedPort();
    const down = await createTestApp({ DATABASE_URL: `postgresql://nobody:nothing@127.0.0.1:${String(port)}/none` });
    try {
      const response = await down.request({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: sessionCookie(newSessionToken()) },
      });

      expect(response.statusCode, response.body).toBe(503);
      const problem = ProblemDetailsSchema.parse(json(response));
      expect(problem.code).toBe("SERVICE_UNAVAILABLE");
      expect(problem.retryAfterSec).toBe(5);
      expect(response.headers["retry-after"]).toBe("5");
      expect(response.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|postgres/i);
    } finally {
      await down.close();
    }
  });
});

describe("CSRF", () => {
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

  const post = (headers: Record<string, string>) =>
    testApp.request({
      method: "POST",
      url: "/v1/__test__/echo",
      headers: { "content-type": "application/json", cookie, ...headers },
      payload: JSON.stringify({ value: "hello" }),
    });

  it("rejects a cross-site POST and accepts same-origin and server-to-server ones", async () => {
    const rejected = [
      await post({ origin: "https://evil.example" }),
      await post({ origin: "null" }),
      await post({ "sec-fetch-site": "cross-site" }),
      await post({ "sec-fetch-site": "same-site" }),
    ];
    for (const response of rejected) {
      expect(response.statusCode, response.body).toBe(403);
      expect(ProblemDetailsSchema.parse(json(response)).code).toBe("FORBIDDEN");
    }

    const accepted = [
      await post({ origin: "http://localhost:3000" }),
      await post({ "sec-fetch-site": "same-origin" }),
      await post({ "sec-fetch-site": "none" }),
      await post({}), // a server-to-server call (a Next.js server action forwarding the cookie)
    ];
    for (const response of accepted) {
      expect(response.statusCode, response.body).toBe(200);
      expect(json(response)).toMatchObject({ value: "hello" });
    }
  });

  it("runs CSRF before authentication: a cross-site POST with a dead session is 403, not 401", async () => {
    const response = await testApp.request({
      method: "POST",
      url: "/v1/__test__/echo",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie(newSessionToken()),
        origin: "https://evil.example",
      },
      payload: JSON.stringify({ value: "hello" }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("ignores safe methods and cookie-less requests", async () => {
    const get = await testApp.request({
      method: "GET",
      url: "/v1/me",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(get.statusCode).toBe(200);

    const anonymous = await testApp.request({
      method: "POST",
      url: "/v1/__test__/echo",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      payload: JSON.stringify({ value: "hello" }),
    });
    // No session cookie: not a CSRF risk, but not signed in either.
    expect(anonymous.statusCode).toBe(401);
  });
});
