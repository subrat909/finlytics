/**
 * `/v1/portfolio/{funds,positions,holdings}` end to end: fake adapters behind the real registry → gateway path, the
 * vault, PostgreSQL (accounts, the instrument master) and Redis (quotes, the 5-second view cache). Covers which account
 * answers (default, named, another user's, none), enrichment, the cache and a refused broker token.
 */
import { NeedsReloginError, Secret } from "@finlytics/broker-sdk";
import type { BrokerHolding, BrokerPosition } from "@finlytics/broker-sdk";
import type { PrismaClient } from "@finlytics/database";
import { FundsViewSchema, HoldingsViewSchema, PositionsViewSchema, ProblemDetailsSchema } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { VaultService } from "../../src/infra/vault/vault.service";
import { BROKER_ACCOUNT_EVENTS } from "../../src/modules/brokers/broker-events";
import type { BrokerAccountEvent } from "../../src/modules/brokers/broker-events";

import { json } from "./app";
import { createBrokerTestApp, FAKE_SCRIPTS } from "./broker-app";
import type { BrokerTestApp } from "./broker-app";
import { createSession, createUser, fixturesClient, sessionCookie, uniqueSuffix } from "./fixtures";
import type { CreatedUser } from "./fixtures";

const TAG = `P${uniqueSuffix().toUpperCase()}`;
const EQ = `NSE_EQ|${TAG}` as InstrumentKey;
const UNKNOWN_FUT = `NSE_FO|${TAG}X|2026-10-27` as InstrumentKey;

const POSITIONS: BrokerPosition[] = [
  {
    instrumentKey: EQ,
    product: "INTRADAY",
    netQty: 0,
    buyQty: 5,
    sellQty: 5,
    buyAvg: "100",
    sellAvg: "101",
    realisedPnl: "5",
  },
  {
    instrumentKey: UNKNOWN_FUT,
    product: "MARGIN",
    netQty: 50,
    buyQty: 50,
    sellQty: 0,
    buyAvg: "200",
    sellAvg: "0",
    realisedPnl: "0",
  },
];
const HOLDINGS: BrokerHolding[] = [{ instrumentKey: EQ, qty: 10, avgPrice: "90" }];

interface SignedIn {
  readonly user: CreatedUser;
  readonly cookie: string;
}

describe("portfolio", () => {
  let testApp: BrokerTestApp;
  let fixtures: PrismaClient;
  let redis: Redis;
  const events: { name: string; event: BrokerAccountEvent }[] = [];

  beforeAll(async () => {
    testApp = await createBrokerTestApp({
      ...FAKE_SCRIPTS,
      DHAN: {
        ...FAKE_SCRIPTS.DHAN,
        funds: { availableMargin: "50000.25", usedMargin: "1000", collateral: "0", withdrawable: "49000" },
        positions: POSITIONS,
        holdings: HOLDINGS,
      },
      UPSTOX: { ...FAKE_SCRIPTS.UPSTOX, portfolioError: new NeedsReloginError("Token expired") },
    });
    fixtures = fixturesClient();
    redis = new Redis(inject("redisUrl"));
    await fixtures.instrument.create({
      data: {
        key: EQ,
        exchange: "NSE",
        segment: "EQ",
        symbol: TAG,
        tradingSymbol: TAG,
        name: `${TAG} Industries`,
        lotSize: 1,
        tickSize: "0.05",
        brokerTokens: {},
      },
    });
    await redis.hset(`quote:${UNKNOWN_FUT}`, { ltp: "210.5", close: "205", ts: String(Date.now()) });
    await redis.hset(`quote:${EQ}`, { ltp: "120.123456", close: "118", ts: String(Date.now()) });
    const emitter = testApp.app.get(EventEmitter2);
    for (const name of Object.values(BROKER_ACCOUNT_EVENTS)) {
      emitter.on(name, (event: BrokerAccountEvent) => events.push({ name, event }));
    }
  });

  afterAll(async () => {
    await redis.del(`quote:${UNKNOWN_FUT}`, `quote:${EQ}`);
    redis.disconnect();
    await testApp.close();
    await fixtures.$disconnect();
  });

  const signedIn = async (): Promise<SignedIn> => {
    const user = await createUser(fixtures);
    return { user, cookie: sessionCookie((await createSession(fixtures, user.id)).token) };
  };

  const get = (who: SignedIn, url: string) => testApp.request({ method: "GET", url, headers: { cookie: who.cookie } });

  const connectDhan = async (who: SignedIn, label = "Dhan") => {
    const response = await testApp.request({
      method: "POST",
      url: "/v1/brokers/dhan",
      headers: { cookie: who.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ label, clientId: "1100", accessToken: "dhan-token-0123456789" }),
    });
    expect(response.statusCode, response.body).toBe(201);
    return (json(response) as { id: string }).id;
  };

  /** An ACTIVE Upstox account written the way BrokersService writes it (its fake refuses every portfolio call). */
  const upstoxAccount = async (who: SignedIn) => {
    const vault = testApp.app.get(VaultService);
    const id = `c${uniqueSuffix()}${uniqueSuffix()}`.slice(0, 25);
    const scope = { userId: who.user.id, brokerAccountId: id };
    const key = vault.createDataKey(scope);
    const creds = vault.sealCredentials(scope, key, { accessToken: Secret.of("upstox-token"), clientId: "UPX42" });
    await fixtures.brokerAccount.create({
      data: {
        id,
        userId: who.user.id,
        broker: "UPSTOX",
        label: "Upstox",
        status: "ACTIVE",
        encKeyWrapped: key.wrapped,
        encKeyIv: key.iv,
        encryptedCredentials: creds.ciphertext,
        credentialsIv: creds.iv,
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return id;
  };

  it("answers 404 'Connect a broker' to a user without a broker account", async () => {
    const alice = await signedIn();

    for (const kind of ["funds", "positions", "holdings"]) {
      const response = await get(alice, `/v1/portfolio/${kind}`);
      expect(response.statusCode).toBe(404);
      expect(ProblemDetailsSchema.parse(json(response))).toMatchObject({
        code: "NOT_FOUND",
        detail: "Connect a broker to see your funds, positions and holdings.",
      });
    }
  });

  it("reads the default account's funds, positions and holdings, enriched and never with credentials", async () => {
    const alice = await signedIn();
    const id = await connectDhan(alice);

    const funds = await get(alice, "/v1/portfolio/funds");
    const positions = await get(alice, "/v1/portfolio/positions");
    const holdings = await get(alice, "/v1/portfolio/holdings");

    expect(funds.statusCode, funds.body).toBe(200);
    expect(FundsViewSchema.parse(json(funds))).toMatchObject({
      accountId: id,
      broker: "DHAN",
      availableMargin: "50000.25",
      withdrawable: "49000",
    });
    const positionRows = PositionsViewSchema.parse(json(positions)).positions;
    expect(positionRows.map((row) => row.instrumentKey)).toEqual([UNKNOWN_FUT, EQ]);
    expect(positionRows[0]).toMatchObject({
      symbol: `${TAG}X 2026-10-27 FUT`,
      exchange: "NFO",
      segment: "FUT",
      name: null,
      ltp: "210.5",
      unrealisedPnl: "525",
    });
    expect(positionRows[1]).toMatchObject({ symbol: TAG, name: `${TAG} Industries`, lotSize: 1, ltp: "120.1235" });
    expect(HoldingsViewSchema.parse(json(holdings)).holdings).toEqual([
      {
        instrumentKey: EQ,
        symbol: TAG,
        name: `${TAG} Industries`,
        exchange: "NSE",
        segment: "EQ",
        lotSize: 1,
        qty: 10,
        t1Qty: 0,
        avgPrice: "90",
        ltp: "120.1235",
        close: "118",
      },
    ]);
    for (const body of [funds.body, positions.body, holdings.body]) {
      expect(body).not.toContain("dhan-token-0123456789");
      expect(body).not.toContain("1100");
    }
  });

  it("serves repeated requests from the 5-second cache", async () => {
    const alice = await signedIn();
    await connectDhan(alice);
    const before = testApp.log.calls.filter((call) => call.method === "getFunds").length;

    const first = await get(alice, "/v1/portfolio/funds");
    const second = await get(alice, "/v1/portfolio/funds");

    expect(json(second)).toEqual(json(first));
    expect(testApp.log.calls.filter((call) => call.method === "getFunds")).toHaveLength(before + 1);
  });

  it("keeps every account to its owner: another user's account id is a 404, and unknown query keys a 400", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    const id = await connectDhan(alice);
    const calls = testApp.log.calls.length;

    const stolen = await get(bob, `/v1/portfolio/positions?accountId=${id}`);

    expect(stolen.statusCode).toBe(404);
    expect(json(stolen)).toMatchObject({ code: "NOT_FOUND", detail: "Broker account not found." });
    expect(testApp.log.calls).toHaveLength(calls);
    expect((await get(alice, `/v1/portfolio/funds?accountId=${id}`)).statusCode).toBe(200);
    expect((await get(alice, "/v1/portfolio/funds?account=x")).statusCode).toBe(400);
    expect((await testApp.request({ method: "GET", url: "/v1/portfolio/funds" })).statusCode).toBe(401);
  });

  it("flags the account NEEDS_RELOGIN and answers 409 when the broker refuses the token", async () => {
    const alice = await signedIn();
    const id = await upstoxAccount(alice);

    const refused = await get(alice, "/v1/portfolio/holdings");

    expect(refused.statusCode).toBe(409);
    expect(ProblemDetailsSchema.parse(json(refused))).toMatchObject({ code: "NEEDS_RELOGIN" });
    expect(
      await fixtures.brokerAccount.findUniqueOrThrow({ where: { id }, select: { status: true, lastError: true } }),
    ).toEqual({ status: "NEEDS_RELOGIN", lastError: "The broker session has ended. Log in again." });
    expect(events.filter((entry) => entry.event.accountId === id)).toEqual([
      { name: "broker.account.deactivated", event: { userId: alice.user.id, accountId: id, broker: "UPSTOX" } },
    ]);
    // With no ACTIVE account left, the default lookup says "log in again", not "connect a broker".
    const again = await get(alice, "/v1/portfolio/funds");
    expect(again.statusCode).toBe(409);
    expect(json(again)).toMatchObject({ code: "NEEDS_RELOGIN" });
  });
});
