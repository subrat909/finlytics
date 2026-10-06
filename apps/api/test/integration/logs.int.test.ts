/**
 * Logs end to end (plan D5, docs/06 "log review tests"): correlation and redaction on real requests. Every app in this
 * file logs to the same capture at debug level (see log-capture.ts).
 */
import type { PrismaClient } from "@finlytics/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LEAK_MARKER } from "../support/probe.module";

import { createTestApp } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, daysAgo, fixturesClient, newSessionToken, sessionCookie } from "./fixtures";
import { logCapture } from "./log-capture";

describe("request logs", () => {
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

  it("every log line written during a request carries its requestId", async () => {
    const user = await createUser(fixtures);
    // An idle session: the session service logs its verdict, the filter logs the 401, pino-http logs the access line.
    const { token } = await createSession(fixtures, user.id, { lastSeenAt: daysAgo(8) });
    logCapture.clear();

    const response = await testApp.request({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: sessionCookie(token), "x-request-id": "corr-log-0001" },
    });

    expect(response.statusCode).toBe(401);
    const requestId = response.headers["x-request-id"];
    expect(requestId).not.toBe("corr-log-0001");
    const lines = logCapture.lines();
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.map((line) => line["requestId"])).toEqual(lines.map(() => requestId));
    expect(lines.map((line) => line["msg"])).toEqual(
      expect.arrayContaining(["session rejected", "UNAUTHENTICATED", "request completed"]),
    );
    // The caller's own id links its logs to ours, on the access line only.
    const tagged = lines.filter((line) => "clientRequestId" in line);
    expect(tagged.map((line) => [line["msg"], line["clientRequestId"]])).toEqual([
      ["request completed", "corr-log-0001"],
    ]);
  });

  it("a failing request logs no cookie, token or query string", async () => {
    const token = newSessionToken();
    logCapture.clear();

    const responses = [
      await testApp.request({
        method: "GET",
        url: `/v1/me?code=${LEAK_MARKER}`,
        headers: { cookie: sessionCookie(token), authorization: `Bearer ${LEAK_MARKER}` },
      }),
      await testApp.request({ method: "GET", url: `/v1/__test__/boom?token=${LEAK_MARKER}` }),
      await testApp.request({ method: "GET", url: `/v1/__test__/db/bad-sql?state=${LEAK_MARKER}` }),
      await testApp.request({ method: "GET", url: `/v1/nope?code=${LEAK_MARKER}` }),
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([401, 500, 500, 404]);
    const text = logCapture.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain(`code=`);
    expect(text).not.toContain(`token=`);
    expect(text).not.toMatch(/authjs\.session-token|Bearer|"cookie"|"authorization"/i);
    // The probe's error message and SQL carry the marker; the err serializer keeps Prisma errors to type and code.
    const unhandled = logCapture.lines().find((line) => line["msg"] === "unhandled error");
    expect(unhandled?.["err"]).toMatchObject({ type: "Error" });
    const database = logCapture.lines().find((line) => line["msg"] === "database error");
    expect(database?.["prisma"]).toEqual({ name: "PrismaClientKnownRequestError", code: "P2010", sqlState: "42P01" });
  });

  it("does not access-log health probes", async () => {
    logCapture.clear();

    await testApp.request({ method: "GET", url: "/health/live" });
    await testApp.request({ method: "GET", url: "/health/ready" });

    expect(logCapture.lines().filter((line) => line["msg"] === "request completed")).toEqual([]);
  });
});
