/**
 * `GET` and `PATCH /v1/me/settings` end to end (plan D15, US8; docs/04 §2 "Settings"): lenient reads that log what
 * they repaired, strict patches merged under a row lock, one audit row per change, CSRF.
 */
import type { PrismaClient } from "@finlytics/database";
import { DEFAULT_USER_SETTINGS, ProblemDetailsSchema, UserSettingsSchema } from "@finlytics/shared";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, sessionCookie } from "./fixtures";
import type { CreatedUser } from "./fixtures";
import { logCapture } from "./log-capture";

describe("user settings", () => {
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

  const signedIn = async (): Promise<{ user: CreatedUser; cookie: string }> => {
    const user = await createUser(fixtures);
    return { user, cookie: sessionCookie((await createSession(fixtures, user.id)).token) };
  };

  const get = (cookie?: string): Promise<LightMyRequestResponse> =>
    testApp.request({ method: "GET", url: "/v1/me/settings", headers: cookie === undefined ? {} : { cookie } });

  const patch = (cookie: string, body: unknown, headers: Record<string, string> = {}) =>
    testApp.request({
      method: "PATCH",
      url: "/v1/me/settings",
      headers: { cookie, "content-type": "application/json", "user-agent": "settings-test/1.0", ...headers },
      payload: JSON.stringify(body),
    });

  const auditRows = (userId: string) =>
    fixtures.auditLog.findMany({
      where: { userId, action: "settings.update" },
      orderBy: { id: "asc" },
      select: {
        id: true,
        actorType: true,
        actorId: true,
        entityType: true,
        entityId: true,
        requestId: true,
        ip: true,
        userAgent: true,
        data: true,
      },
    });

  it("returns full defaults for a new user", async () => {
    const { cookie } = await signedIn();

    const response = await get(cookie);

    expect(response.statusCode, response.body).toBe(200);
    expect(UserSettingsSchema.parse(json(response))).toEqual(DEFAULT_USER_SETTINGS);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("patches one field without touching others", async () => {
    const { user, cookie } = await signedIn();
    await fixtures.user.update({
      where: { id: user.id },
      data: { settings: { trading: { defaultQtyLots: 4 }, notifications: { sound: false } } },
    });

    const response = await patch(cookie, { appearance: { theme: "dark" } });

    expect(response.statusCode, response.body).toBe(200);
    const expected = {
      ...DEFAULT_USER_SETTINGS,
      appearance: { theme: "dark", density: "comfortable" },
      trading: { ...DEFAULT_USER_SETTINGS.trading, defaultQtyLots: 4 },
      notifications: { ...DEFAULT_USER_SETTINGS.notifications, sound: false },
    };
    expect(json(response)).toEqual(expected);
    expect(json(await get(cookie))).toEqual(expected);
    // Stored: the user's overrides only, so a default they never set can still change.
    const stored = await fixtures.user.findUniqueOrThrow({ where: { id: user.id }, select: { settings: true } });
    expect(stored.settings).toEqual({
      trading: { defaultQtyLots: 4 },
      notifications: { sound: false },
      appearance: { theme: "dark" },
    });
  });

  it("rejects unknown keys with VALIDATION and field errors, applying nothing", async () => {
    const { user, cookie } = await signedIn();

    const responses = [
      await patch(cookie, { appearance: { theme: "dark", fontSize: 14 } }),
      await patch(cookie, { notifications: { categories: { broker: { inApp: false } } } }),
      await patch(cookie, null),
      await patch(cookie, { trading: { defaultQtyLots: 0 } }),
    ];

    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(400);
      expect(ProblemDetailsSchema.parse(json(response)).code).toBe("VALIDATION");
    }
    expect(ProblemDetailsSchema.parse(json(responses[0] as LightMyRequestResponse)).errors).toEqual([
      { path: "appearance.fontSize", message: "Unknown field.", code: "unrecognized_keys" },
    ]);
    expect(ProblemDetailsSchema.parse(json(responses[3] as LightMyRequestResponse)).errors).toEqual([
      { path: "trading.defaultQtyLots", message: expect.any(String) as string, code: "too_small" },
    ]);
    const stored = await fixtures.user.findUniqueOrThrow({ where: { id: user.id }, select: { settings: true } });
    expect(stored.settings).toEqual({});
    expect(await auditRows(user.id)).toEqual([]);
  });

  it("keeps both fields when two tabs patch different fields concurrently", async () => {
    const { user, cookie } = await signedIn();

    const pairs = [
      [{ appearance: { theme: "dark" } }, { appearance: { density: "compact" } }],
      [{ trading: { defaultQtyLots: 7 } }, { trading: { confirmBeforePlace: false } }],
      [{ notifications: { sound: false } }, { notifications: { categories: { alert: { email: true } } } }],
    ];
    for (const [first, second] of pairs) {
      const responses = await Promise.all([patch(cookie, first), patch(cookie, second)]);
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    }

    const settings = UserSettingsSchema.parse(json(await get(cookie)));
    expect(settings.appearance).toEqual({ theme: "dark", density: "compact" });
    expect(settings.trading).toMatchObject({ defaultQtyLots: 7, confirmBeforePlace: false });
    expect(settings.notifications.sound).toBe(false);
    expect(settings.notifications.categories.alert.email).toBe(true);
    expect(await auditRows(user.id)).toHaveLength(6);
  });

  it("writes one audit row with actorId per patch", async () => {
    const { user, cookie } = await signedIn();

    // A client-chosen x-request-id never reaches the audit row: it holds the id the api generated.
    const changed = await patch(
      cookie,
      { appearance: { theme: "light" }, trading: { defaultOrderType: "MARKET" } },
      { "x-request-id": "forged-audit-id-0001" },
    );
    const unchanged = await patch(cookie, { appearance: { theme: "light" } });

    expect([changed.statusCode, unchanged.statusCode]).toEqual([200, 200]);
    const rows = await auditRows(user.id);
    expect(rows).toEqual([
      {
        id: expect.any(BigInt) as bigint,
        actorType: "user",
        actorId: user.id,
        entityType: "User",
        entityId: user.id,
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ) as string,
        ip: "127.0.0.1",
        userAgent: "settings-test/1.0",
        data: { changed: ["appearance.theme", "trading.defaultOrderType"] },
      },
    ]);
    expect(rows[0]?.requestId).toBe(changed.headers["x-request-id"]);
  });

  it("rejects a cross-site PATCH and accepts same-origin and server-to-server ones", async () => {
    const { cookie } = await signedIn();

    const crossSite = [
      await patch(cookie, { appearance: { theme: "dark" } }, { origin: "https://evil.example" }),
      await patch(cookie, { appearance: { theme: "dark" } }, { "sec-fetch-site": "cross-site" }),
    ];
    for (const response of crossSite) {
      expect(response.statusCode).toBe(403);
      expect(ProblemDetailsSchema.parse(json(response)).code).toBe("FORBIDDEN");
    }
    expect(json(await get(cookie))).toEqual(DEFAULT_USER_SETTINGS);

    const accepted = [
      await patch(cookie, { appearance: { theme: "dark" } }, { origin: "http://localhost:3000" }),
      await patch(cookie, { appearance: { density: "compact" } }, { "sec-fetch-site": "same-origin" }),
      await patch(cookie, { notifications: { sound: false } }),
    ];
    expect(accepted.map((response) => response.statusCode)).toEqual([200, 200, 200]);
  });

  it("repairs a corrupted stored value field by field and logs what it repaired", async () => {
    const { user, cookie } = await signedIn();
    await fixtures.user.update({
      where: { id: user.id },
      data: { settings: { appearance: { theme: "neon", density: "compact" }, trading: "oops", legacy: 1 } },
    });
    logCapture.clear();

    const response = await testApp.request({ method: "GET", url: "/v1/me/settings", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const settings = UserSettingsSchema.parse(json(response));
    expect(settings.appearance).toEqual({ theme: "system", density: "compact" });
    expect(settings.trading).toEqual(DEFAULT_USER_SETTINGS.trading);
    const repaired = logCapture
      .forRequest(String(response.headers["x-request-id"]))
      .find((line) => line["msg"] === "stored settings repaired with defaults");
    expect(repaired?.["level"]).toBe("warn");
    expect(repaired?.["issues"]).toEqual([
      expect.stringMatching(/^appearance\.theme: /) as string,
      expect.stringMatching(/^trading: /) as string,
      expect.stringMatching(/^\(root\): .*legacy/) as string,
    ]);
  });

  it("answers UNAUTHENTICATED without a session", async () => {
    const response = await get();

    expect(response.statusCode).toBe(401);
    expect(ProblemDetailsSchema.parse(json(response)).code).toBe("UNAUTHENTICATED");
  });
});
