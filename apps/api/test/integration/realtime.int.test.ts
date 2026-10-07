/**
 * The realtime pipeline end to end (phase 1 plan "WebSocket", P1, P2): one app running `http,gateway,feed` on a real
 * port, the paper feed as leader, and socket.io-client connecting with a real session cookie over msgpack.
 *
 * sub → ref-count and wanted set in Redis → the feed subscribes → ticks to `quote:*` and `q:*` → coalesced `q` events
 * (at most one per 100 ms, 12-tuple rows) → unsub → after the (shortened) grace the feed drops the key. `dsub` streams
 * the simulator's book as `depth` events (also served by `GET /v1/quotes/depth`). Handshakes without a valid session or
 * from a foreign Origin are refused.
 */
import type { PrismaClient } from "@finlytics/database";
import {
  RtDepthAckSchema,
  RtDepthSchema,
  RtQuoteBatchSchema,
  RtStatusSchema,
  RtSubscribeAckSchema,
} from "@finlytics/shared";
import type { RtDepth, RtQuoteBatch } from "@finlytics/shared";
import { Redis } from "ioredis";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import * as msgpackParser from "socket.io-msgpack-parser";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { FeedService } from "../../src/feed/feed.service";

import { createTestApp } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, newSessionToken, sessionCookie, uniqueSuffix } from "./fixtures";

const ORIGIN = "http://localhost:3000";
const GRACE_MS = 300;

/** Polls `check` until it returns true (or fails after `timeoutMs`). */
async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("realtime gateway with the paper feed", () => {
  let testApp: TestApp;
  let fixtures: PrismaClient;
  let redis: Redis;
  let baseUrl: string;
  let cookie: string;
  const sockets: Socket[] = [];
  const keys: string[] = [];

  const connect = (
    headers: Record<string, string>,
    transports: ("websocket" | "polling")[] = ["websocket"],
  ): Socket => {
    const socket = io(`${baseUrl}/rt`, {
      path: "/rt/socket.io",
      transports,
      parser: msgpackParser,
      extraHeaders: headers,
      reconnection: false,
      forceNew: true,
      timeout: 5_000,
    });
    sockets.push(socket);
    return socket;
  };

  /** Resolves on `connect`, rejects with the server's message on `connect_error`. */
  const connected = (socket: Socket): Promise<void> =>
    new Promise((resolve, reject) => {
      socket.once("connect", () => {
        resolve();
      });
      socket.once("connect_error", (error: Error) => {
        reject(error);
      });
    });

  beforeAll(async () => {
    fixtures = fixturesClient();
    redis = new Redis(inject("redisUrl"));
    for (let index = 0; index < 3; index += 1) {
      const key = `NSE_EQ|RT${uniqueSuffix().toUpperCase()}`;
      await fixtures.instrument.create({
        data: {
          key,
          exchange: "NSE",
          segment: "EQ",
          symbol: key.slice(7),
          name: `Realtime test ${String(index)}`,
          brokerTokens: {},
        },
      });
      keys.push(key);
    }
    const user = await createUser(fixtures);
    cookie = sessionCookie((await createSession(fixtures, user.id)).token);

    testApp = await createTestApp(
      {
        APP_ROLE: "http,gateway,feed",
        MARKET_FEED_SOURCE: "paper",
        MARKET_FEED_ALWAYS_ON: "true",
        MARKET_FEED_PAPER_TICK_MS: "20",
        RT_UNSUB_GRACE_MS: String(GRACE_MS),
        API_ALLOWED_ORIGINS: ORIGIN,
      },
      { listen: true, probes: false },
    );
    await testApp.app.listen({ host: "127.0.0.1", port: 0 });
    baseUrl = await testApp.app.getUrl();
    await eventually(() => testApp.app.get(FeedService).engine.isLeader);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await testApp.close();
    await fixtures.instrument.deleteMany({ where: { key: { in: keys } } });
    await fixtures.$disconnect();
    redis.disconnect();
  });

  it("serves REST and Socket.IO on the same port", async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
  });

  it("streams coalesced quotes for a subscription, then unsubscribes the feed after the grace period", async () => {
    const key = keys[0] ?? "";
    const socket = connect({ cookie, origin: ORIGIN });
    const statuses: unknown[] = [];
    socket.on("status", (status: unknown) => statuses.push(status));
    const batches: { at: number; batch: RtQuoteBatch }[] = [];
    socket.on("q", (batch: unknown) => {
      batches.push({ at: Date.now(), batch: RtQuoteBatchSchema.parse(batch) });
    });
    await connected(socket);

    const ack = RtSubscribeAckSchema.parse(
      await socket.timeout(5_000).emitWithAck("sub", { keys: [key, "not a key"] }),
    );
    expect(ack).toEqual({ ok: [key], rejected: [{ key: "not a key", reason: "invalid_key" }] });
    expect(await redis.get(`subs:${key}`)).toBe("1");
    expect(await redis.sismember("subs:wanted", key)).toBe(1);

    await eventually(() => batches.length >= 8);
    expect(RtStatusSchema.parse(statuses[0])).toMatchObject({ source: "PAPER", live: false });
    expect(await redis.hget("feed:source", "broker")).toBe("PAPER");
    expect(testApp.app.get(FeedService).engine.subscribedKeys().map(String)).toContain(key);
    for (const { batch } of batches) {
      const rows = batch.d.filter(([rowKey]) => rowKey === key);
      expect(rows.length).toBeLessThanOrEqual(1);
    }
    // Ticks arrive every 20 ms; the client sees at most one batch per ~100 ms (10 per second).
    const gaps = batches.slice(2).map((entry, index) => entry.at - (batches[index + 1]?.at ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60);
    const quote = await redis.hgetall(`quote:${key}`);
    expect(quote["ltp"]).toMatch(/^\d+(\.\d+)?$/);
    expect(quote["close"]).toMatch(/^\d+(\.\d+)?$/);

    const unsub = (await socket.timeout(5_000).emitWithAck("unsub", { keys: [key] })) as { ok: string[] };
    expect(unsub).toEqual({ ok: [key] });
    expect(await redis.get(`subs:${key}`)).toBe("0");
    await eventually(async () => (await redis.sismember("subs:wanted", key)) === 0);
    await eventually(() => !testApp.app.get(FeedService).engine.subscribedKeys().map(String).includes(key));
    expect(await redis.exists(`subs:${key}`)).toBe(0);
    socket.disconnect();
  });

  it("streams the book of a subscribed key on dsub, at most 4 a second, and serves it over REST", async () => {
    const key = keys[2] ?? "";
    const socket = connect({ cookie, origin: ORIGIN });
    const books: { at: number; depth: RtDepth }[] = [];
    socket.on("depth", (depth: unknown) => {
      books.push({ at: Date.now(), depth: RtDepthSchema.parse(depth) });
    });
    await connected(socket);

    // Depth rides on a quote subscription.
    expect(RtDepthAckSchema.parse(await socket.timeout(5_000).emitWithAck("dsub", { key }))).toEqual({
      ok: false,
      reason: "invalid_key",
    });
    await socket.timeout(5_000).emitWithAck("sub", { keys: [key] });
    expect(RtDepthAckSchema.parse(await socket.timeout(5_000).emitWithAck("dsub", { key }))).toEqual({ ok: true });

    await eventually(() => books.length >= 6);
    expect(books.every(({ depth }) => depth.k === key && depth.bids.length === 5 && depth.asks.length === 5)).toBe(
      true,
    );
    // Ticks every 20 ms; books at most every ~250 ms after the snapshot.
    const gaps = books.slice(2).map((entry, index) => entry.at - (books[index + 1]?.at ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(150);

    const rest = await fetch(`${baseUrl}/v1/quotes/depth?key=${encodeURIComponent(key)}`, { headers: { cookie } });
    expect(rest.status).toBe(200);
    expect(RtDepthSchema.parse(await rest.json()).k).toBe(key);

    expect(await socket.timeout(5_000).emitWithAck("dunsub", { key })).toEqual({ ok: true });
    const count = books.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(books.length).toBeLessThanOrEqual(count + 1);
    socket.disconnect();
  });

  it("releases a disconnected socket's subscriptions", async () => {
    const key = keys[1] ?? "";
    const socket = connect({ cookie, origin: ORIGIN });
    await connected(socket);
    await socket.timeout(5_000).emitWithAck("sub", { keys: [key] });
    expect(await redis.get(`subs:${key}`)).toBe("1");

    socket.disconnect();

    await eventually(async () => (await redis.get(`subs:${key}`)) === "0");
  });

  it("refuses a handshake without a session cookie", async () => {
    const socket = connect({ origin: ORIGIN });
    await expect(connected(socket)).rejects.toThrow("UNAUTHENTICATED");
  });

  it("refuses a handshake with an unknown session", async () => {
    const socket = connect({ origin: ORIGIN, cookie: sessionCookie(newSessionToken()) });
    await expect(connected(socket)).rejects.toThrow("UNAUTHENTICATED");
  });

  it("refuses a handshake from a foreign origin, on both transports", async () => {
    await expect(connected(connect({ cookie, origin: "https://evil.example" }))).rejects.toThrow();
    await expect(connected(connect({ cookie, origin: "https://evil.example" }, ["polling"]))).rejects.toThrow();
    const allowed = connect({ cookie, origin: ORIGIN }, ["polling"]);
    await connected(allowed);
    allowed.disconnect();
  });
});
