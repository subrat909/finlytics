/**
 * Instruments (search, lookup, the master import's repository, the admin sync trigger), watchlists (CRUD, ownership,
 * plan limits) and quotes (from the `quote:*` hashes) against the real database and Redis.
 */
import type { InstrumentRow } from "@finlytics/broker-sdk";
import { createPrismaClient } from "@finlytics/database";
import type { PrismaClient } from "@finlytics/database";
import { InstrumentListSchema, WatchlistListSchema, WatchlistSchema } from "@finlytics/shared";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { QUEUE_NAMES } from "../../src/infra/queue/queue-names";
import { withTenancyGuard } from "../../src/infra/prisma/prisma.service";
import type { PrismaService } from "../../src/infra/prisma/prisma.service";
import { InstrumentsRepository } from "../../src/modules/instruments/instruments.repository";

import { createTestApp, json } from "./app";
import type { TestApp } from "./app";
import { createSession, createUser, fixturesClient, sessionCookie, uniqueSuffix } from "./fixtures";
import type { CreatedUser } from "./fixtures";

/** Instruments with symbols unique to this run, so parallel files never see each other's rows. */
async function seedInstruments(fixtures: PrismaClient) {
  const tag = `T${uniqueSuffix().toUpperCase()}`;
  const keys = {
    eq: `NSE_EQ|${tag}`,
    eqLong: `NSE_EQ|${tag}LONG`,
    index: `NSE_INDEX|${tag} INDEX`,
    fut: `NSE_FO|${tag}|2026-10-27`,
    ce: `NSE_FO|${tag}|2026-10-13|25000|CE`,
    pe: `NSE_FO|${tag}|2026-10-13|25000|PE`,
    inactive: `NSE_EQ|${tag}OLD`,
  };
  const base = { lotSize: 1, tickSize: "0.05", brokerTokens: {} };
  await fixtures.instrument.createMany({
    data: [
      {
        ...base,
        key: keys.eq,
        exchange: "NSE",
        segment: "EQ",
        symbol: tag,
        tradingSymbol: tag,
        name: `${tag} Industries`,
      },
      { ...base, key: keys.eqLong, exchange: "NSE", segment: "EQ", symbol: `${tag}LONG`, name: `${tag} Long Ltd` },
      { ...base, key: keys.index, exchange: "NSE", segment: "INDEX", symbol: `${tag} INDEX`, name: `${tag} Index` },
      {
        ...base,
        key: keys.fut,
        exchange: "NFO",
        segment: "FUT",
        symbol: tag,
        name: `${tag} FUT`,
        expiry: new Date("2026-10-27T00:00:00Z"),
        lotSize: 50,
      },
      ...(["CE", "PE"] as const).map((optionType) => ({
        ...base,
        key: optionType === "CE" ? keys.ce : keys.pe,
        exchange: "NFO" as const,
        segment: "OPT" as const,
        symbol: tag,
        name: `${tag} 13 OCT 25000 ${optionType}`,
        expiry: new Date("2026-10-13T00:00:00Z"),
        strike: "25000",
        optionType,
        lotSize: 50,
      })),
      {
        ...base,
        key: keys.inactive,
        exchange: "NSE",
        segment: "EQ",
        symbol: `${tag}OLD`,
        name: "Old",
        isActive: false,
      },
    ],
  });
  return { tag, keys };
}

describe("market data", () => {
  let testApp: TestApp;
  let fixtures: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    testApp = await createTestApp();
    fixtures = fixturesClient();
    redis = new Redis(inject("redisUrl"));
  });

  afterAll(async () => {
    await testApp.close();
    await fixtures.$disconnect();
    redis.disconnect();
  });

  const signedIn = async (): Promise<{ user: CreatedUser; cookie: string }> => {
    const user = await createUser(fixtures);
    return { user, cookie: sessionCookie((await createSession(fixtures, user.id)).token) };
  };
  const get = (cookie: string, url: string) => testApp.request({ method: "GET", url, headers: { cookie } });
  const send = (cookie: string, method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown) =>
    testApp.request({
      method,
      url,
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  describe("instruments", () => {
    it("searches active instruments with the prefix boost: index and equity before derivatives", async () => {
      const { cookie } = await signedIn();
      const { tag, keys } = await seedInstruments(fixtures);

      const response = await get(cookie, `/v1/instruments?q=${tag.toLowerCase()}&limit=10`);

      expect(response.statusCode, response.body).toBe(200);
      const found = InstrumentListSchema.parse(response.json()).map((instrument) => instrument.key);
      expect(found.slice(0, 3)).toEqual([keys.index, keys.eq, keys.eqLong]);
      expect(found).toContain(keys.fut);
      expect(found).not.toContain(keys.inactive);
    });

    it("reads option terms out of the query and filters by segment", async () => {
      const { cookie } = await signedIn();
      const { tag, keys } = await seedInstruments(fixtures);

      const options = await get(cookie, `/v1/instruments?q=${encodeURIComponent(`${tag} 25000 pe`)}`);
      expect(InstrumentListSchema.parse(options.json())[0]).toMatchObject({
        key: keys.pe,
        strike: "25000",
        expiry: "2026-10-13",
        tickSize: "0.05",
      });
      const futures = await get(cookie, `/v1/instruments?q=${tag}&segment=FUT`);
      expect(InstrumentListSchema.parse(futures.json()).map((instrument) => instrument.key)).toEqual([keys.fut]);
      expect((await get(cookie, "/v1/instruments?q=")).statusCode).toBe(400);
    });

    it("gets one instrument by its URL-encoded key", async () => {
      const { cookie } = await signedIn();
      const { keys } = await seedInstruments(fixtures);

      const found = await get(cookie, `/v1/instruments/${encodeURIComponent(keys.ce)}`);
      expect(found.statusCode, found.body).toBe(200);
      expect(json(found)).toMatchObject({ key: keys.ce, optionType: "CE", lotSize: 50 });
      expect((await get(cookie, `/v1/instruments/${encodeURIComponent("NSE_EQ|NOPE9X")}`)).statusCode).toBe(404);
      expect((await get(cookie, "/v1/instruments/garbage")).statusCode).toBe(400);
    });

    it("queues an on-demand sync for admins only", async () => {
      const user = await signedIn();
      const admin = await signedIn();
      await fixtures.user.update({ where: { id: admin.user.id }, data: { role: "ADMIN" } });

      expect((await send(user.cookie, "POST", "/v1/admin/instruments/sync", {})).statusCode).toBe(403);
      const response = await send(admin.cookie, "POST", "/v1/admin/instruments/sync", {});
      expect(response.statusCode, response.body).toBe(202);
      const queue = testApp.app.get<Queue>(getQueueToken(QUEUE_NAMES.instrumentMasterSync));
      for (const { jobId } of (json(response) as { jobs: { jobId: string }[] }).jobs) {
        expect((await queue.getJob(jobId))?.data).toMatchObject({ requestedBy: admin.user.id });
      }
    });
  });

  describe("InstrumentsRepository (master import)", () => {
    let base: PrismaClient;
    let repository: InstrumentsRepository;

    beforeAll(() => {
      base = createPrismaClient({ url: inject("databaseUrl"), poolMax: 2 });
      repository = new InstrumentsRepository({
        db: withTenancyGuard(base),
        unscoped: base,
      } as unknown as PrismaService);
    });

    afterAll(async () => {
      await base.$disconnect();
    });

    const masterRow = (tag: string, index: number, token = `${tag}-${String(index)}`): InstrumentRow => ({
      instrumentKey: `NSE_EQ|${tag}M${String(index)}` as InstrumentRow["instrumentKey"],
      brokerToken: token,
      exchange: "NSE",
      segment: "EQ",
      tradingSymbol: `${tag}M${String(index)}`,
      name: `Master ${String(index)}`,
      lotSize: 1,
      tickSize: "0.05",
    });

    it("upserts batches with the reverse map, merges broker tokens and deactivates what a later run didn't see", async () => {
      const tag = `R${uniqueSuffix().toUpperCase()}`;
      const option: InstrumentRow = {
        ...masterRow(tag, 9),
        instrumentKey: `NSE_FO|${tag}|2026-10-13|82.5|CE` as InstrumentRow["instrumentKey"],
        exchange: "NFO",
        segment: "OPT",
        expiry: "2026-10-13",
        strike: "82.5",
        optionType: "CE",
        lotSize: 75,
      };
      const first = new Date("2026-10-06T02:30:00.000Z");
      await repository.upsertBatch("UPSTOX", [masterRow(tag, 1), masterRow(tag, 2), option], first);
      await repository.upsertBatch("DHAN", [masterRow(tag, 1, `D-${tag}`)], first);

      const stored = await fixtures.instrument.findUniqueOrThrow({ where: { key: `NSE_EQ|${tag}M1` } });
      expect(stored.brokerTokens).toEqual({ UPSTOX: `${tag}-1`, DHAN: `D-${tag}` });
      expect(stored.symbol).toBe(`${tag}M1`);
      const storedOption = await fixtures.instrument.findUniqueOrThrow({ where: { key: option.instrumentKey } });
      expect(storedOption.strike?.toFixed()).toBe("82.5");
      expect(storedOption.expiry).toEqual(new Date("2026-10-13T00:00:00.000Z"));
      expect(
        await fixtures.instrumentBrokerToken.findUnique({
          where: { broker_token: { broker: "UPSTOX", token: `${tag}-2` } },
        }),
      ).toMatchObject({ instrumentKey: `NSE_EQ|${tag}M2`, isActive: true, seenAt: first });

      // The next run sees only M1 and the option: M2 loses its only token and goes inactive; M1 keeps Dhan's anyway.
      const second = new Date("2026-10-07T02:30:00.000Z");
      await repository.upsertBatch("UPSTOX", [{ ...masterRow(tag, 1), name: "Renamed" }, option], second);
      const deactivated = await repository.deactivateMissing("UPSTOX", second);

      expect(deactivated).toBeGreaterThanOrEqual(1);
      const after = await fixtures.instrument.findMany({
        where: { key: { in: [`NSE_EQ|${tag}M1`, `NSE_EQ|${tag}M2`] } },
        select: { key: true, isActive: true, name: true },
        orderBy: { key: "asc" },
      });
      expect(after).toEqual([
        { key: `NSE_EQ|${tag}M1`, isActive: true, name: "Renamed" },
        { key: `NSE_EQ|${tag}M2`, isActive: false, name: "Master 2" },
      ]);
      expect(await repository.activeTokenCount("DHAN")).toBeGreaterThanOrEqual(1);
      // Re-running the same import changes nothing more.
      expect(await repository.deactivateMissing("UPSTOX", second)).toBe(0);
    });
  });

  describe("watchlists", () => {
    it("creates, lists, renames, moves, reorders items and deletes", async () => {
      const { cookie } = await signedIn();
      const { keys } = await seedInstruments(fixtures);

      const created = await send(cookie, "POST", "/v1/watchlists", { name: "Swing" });
      expect(created.statusCode, created.body).toBe(201);
      const list = WatchlistSchema.parse(json(created));
      const second = WatchlistSchema.parse(json(await send(cookie, "POST", "/v1/watchlists", { name: "Options" })));
      const a = await send(cookie, "POST", `/v1/watchlists/${list.id}/items`, { instrumentKey: keys.eq });
      const b = await send(cookie, "POST", `/v1/watchlists/${list.id}/items`, { instrumentKey: keys.ce });
      expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
      expect(json(b)).toMatchObject({ position: 1, instrument: { key: keys.ce, strike: "25000" } });
      const duplicate = await send(cookie, "POST", `/v1/watchlists/${list.id}/items`, { instrumentKey: keys.eq });
      expect(duplicate.statusCode).toBe(409);
      expect(
        (await send(cookie, "POST", `/v1/watchlists/${list.id}/items`, { instrumentKey: keys.inactive })).statusCode,
      ).toBe(404);

      const [aId, bId] = [(json(a) as { id: string }).id, (json(b) as { id: string }).id];
      const reordered = await send(cookie, "PUT", `/v1/watchlists/${list.id}/items/order`, { itemIds: [bId, aId] });
      expect(WatchlistSchema.parse(json(reordered)).items.map((item) => item.id)).toEqual([bId, aId]);
      expect((await send(cookie, "PUT", `/v1/watchlists/${list.id}/items/order`, { itemIds: [aId] })).statusCode).toBe(
        400,
      );

      const moved = await send(cookie, "PATCH", `/v1/watchlists/${second.id}`, { name: "Opts", position: 0 });
      expect(json(moved)).toMatchObject({ name: "Opts", position: 0 });
      const all = WatchlistListSchema.parse((await get(cookie, "/v1/watchlists")).json());
      expect(all.map((watchlist) => [watchlist.name, watchlist.items.length])).toEqual([
        ["Opts", 0],
        ["Swing", 2],
      ]);

      expect((await send(cookie, "DELETE", `/v1/watchlists/${list.id}/items/${aId}`)).statusCode).toBe(204);
      expect((await send(cookie, "DELETE", `/v1/watchlists/${list.id}/items/${aId}`)).statusCode).toBe(404);
      expect((await send(cookie, "DELETE", `/v1/watchlists/${list.id}`)).statusCode).toBe(204);
      expect(WatchlistListSchema.parse((await get(cookie, "/v1/watchlists")).json())).toHaveLength(1);
    });

    it("keeps lists to their owner: another user's ids are 404s", async () => {
      const alice = await signedIn();
      const bob = await signedIn();
      const { keys } = await seedInstruments(fixtures);
      const list = json(await send(alice.cookie, "POST", "/v1/watchlists", { name: "Mine" })) as { id: string };
      const item = json(
        await send(alice.cookie, "POST", `/v1/watchlists/${list.id}/items`, { instrumentKey: keys.eq }),
      ) as { id: string };

      const attempts = await Promise.all([
        send(bob.cookie, "PATCH", `/v1/watchlists/${list.id}`, { name: "Stolen" }),
        send(bob.cookie, "DELETE", `/v1/watchlists/${list.id}`),
        send(bob.cookie, "POST", `/v1/watchlists/${list.id}/items`, { instrumentKey: keys.fut }),
        send(bob.cookie, "DELETE", `/v1/watchlists/${list.id}/items/${item.id}`),
        send(bob.cookie, "PUT", `/v1/watchlists/${list.id}/items/order`, { itemIds: [item.id] }),
      ]);

      expect(attempts.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404]);
      expect((await get(bob.cookie, "/v1/watchlists")).json()).toEqual([]);
      expect(WatchlistListSchema.parse((await get(alice.cookie, "/v1/watchlists")).json())[0]).toMatchObject({
        name: "Mine",
        items: [expect.objectContaining({ id: item.id })],
      });
    });

    it("enforces the plan's limits, also under concurrent requests", async () => {
      const { user, cookie } = await signedIn();
      const { keys } = await seedInstruments(fixtures);
      const plan = await fixtures.plan.create({
        data: {
          code: `tiny-${uniqueSuffix()}`,
          name: "Tiny",
          priceInrMonthly: "0",
          maxWatchlists: 2,
          maxWatchlistItems: 2,
        },
      });
      await fixtures.user.update({ where: { id: user.id }, data: { planId: plan.id } });

      const creates = await Promise.all(
        ["A", "B", "C", "D"].map((name) => send(cookie, "POST", "/v1/watchlists", { name })),
      );
      expect(creates.map((response) => response.statusCode).sort()).toEqual([201, 201, 403, 403]);
      const createdList = creates.find((response) => response.statusCode === 201);
      if (createdList === undefined) throw new Error("no list was created");
      const listId = (json(createdList) as { id: string }).id;
      const adds = await Promise.all(
        [keys.eq, keys.eqLong, keys.fut].map((instrumentKey) =>
          send(cookie, "POST", `/v1/watchlists/${listId}/items`, { instrumentKey }),
        ),
      );
      expect(adds.map((response) => response.statusCode).sort()).toEqual([201, 201, 403]);
      expect(await fixtures.watchlist.count({ where: { userId: user.id } })).toBe(2);
    });

    it("refuses a duplicate list name with 409", async () => {
      const { cookie } = await signedIn();
      await send(cookie, "POST", "/v1/watchlists", { name: "Same" });
      expect((await send(cookie, "POST", "/v1/watchlists", { name: "Same" })).statusCode).toBe(409);
    });
  });

  describe("quotes", () => {
    it("answers from the feed's quote hashes, leaving out keys without one", async () => {
      const { cookie } = await signedIn();
      const tag = `Q${uniqueSuffix().toUpperCase()}`;
      const key = `NSE_INDEX|${tag} 50`;
      await redis.hset(`quote:${key}`, {
        ltp: "25012.35",
        close: "24950",
        chg: "62.35",
        chgPct: "0.2499",
        ts: "1791273600000",
      });

      const response = await get(cookie, `/v1/quotes?keys=${encodeURIComponent(`${key},NSE_EQ|${tag}NONE`)}`);

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        [key]: { ltp: "25012.35", close: "24950", chg: "62.35", chgPct: "0.2499", ts: 1_791_273_600_000 },
      });
      expect((await get(cookie, "/v1/quotes?keys=bad")).statusCode).toBe(400);
    });
  });
});
