import {
  BrokerInputError,
  BrokerInternalError,
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerUnavailableError,
  DependencyUnavailableError,
  NeedsReloginError,
  RateLimitedError as BrokerRateLimitedError,
  Secret,
} from "@finlytics/broker-sdk";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import {
  InternalError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  ValidationError,
} from "../../../common/problem-json/domain-errors";
import type { PrismaService, TenantTransaction } from "../../../infra/prisma/prisma.service";
import type { RedisService } from "../../../infra/redis/redis.service";
import type { AuditService } from "../../audit/audit.service";
import { BrokerAccessService } from "../broker-access.service";
import { BROKER_ACCOUNT_EVENTS, BrokerEvents } from "../broker-events";
import { BrokerDomainError, brokerProblem, lastErrorFor } from "../broker-errors";
import { adapterOptions } from "../broker-gateways";
import { OAuthStateService } from "../oauth-state.service";
import { dhanExpiry, jwtExpiry, nextUpstoxExpiry } from "../token-expiry";

import { MemoryAccounts } from "./memory-accounts";
import { events as buildEvents, gateways as buildGateways, logger, vault as buildVault } from "./support";

describe("brokerProblem", () => {
  it("maps each broker error code to a curated problem", () => {
    expect(brokerProblem(new NeedsReloginError("x"), "connect")).toMatchObject({ code: "BROKER_REJECTED" });
    expect(brokerProblem(new NeedsReloginError("x"), "call")).toMatchObject({ code: "NEEDS_RELOGIN" });
    expect(brokerProblem(new BrokerRejectedError("raw broker text"), "call")).toMatchObject({
      code: "BROKER_REJECTED",
      detail: "The broker rejected the request.",
    });
    expect(brokerProblem(new BrokerRateLimitedError("x", { retryAfterMs: 2_500 }), "call")).toEqual(
      expect.objectContaining({ code: "RATE_LIMITED", retryAfterSec: 3 }),
    );
    expect(brokerProblem(new BrokerRateLimitedError("x"), "call")).toBeInstanceOf(RateLimitedError);
    expect(brokerProblem(new BrokerUnavailableError("x"), "call")).toMatchObject({
      code: "BROKER_UNAVAILABLE",
      retryAfterSec: 5,
    });
    expect(brokerProblem(new DependencyUnavailableError("x"), "call")).toBeInstanceOf(ServiceUnavailableError);
    expect(brokerProblem(new BrokerNotFoundError("x"), "call")).toBeInstanceOf(NotFoundError);
    expect(brokerProblem(new BrokerInputError("x"), "call")).toBeInstanceOf(ValidationError);
    expect(brokerProblem(new BrokerInternalError("x"), "call")).toBeInstanceOf(InternalError);
    expect(brokerProblem(new Error("boom"), "call")).toBeInstanceOf(InternalError);
    const domain = new NotFoundError("kept");
    expect(brokerProblem(domain, "call")).toBe(domain);
  });

  it("stores our own words as the account's last error", () => {
    expect(lastErrorFor(new BrokerDomainError("BROKER_REJECTED", "x"))).toMatch(/did not accept/);
    expect(lastErrorFor(new BrokerDomainError("NEEDS_RELOGIN", "x"))).toMatch(/session has ended/);
    expect(lastErrorFor(new RateLimitedError(1))).toMatch(/could not be reached/);
    expect(lastErrorFor(new InternalError("x"))).toBe("The broker connection failed.");
  });
});

describe("token expiry", () => {
  it("expires Upstox tokens at the next 03:30 IST", () => {
    expect(nextUpstoxExpiry(new Date("2026-10-06T10:00:00.000Z"))).toEqual(new Date("2026-10-06T22:00:00.000Z"));
    // 02:00 IST on the 7th: the same morning's 03:30.
    expect(nextUpstoxExpiry(new Date("2026-10-06T20:30:00.000Z"))).toEqual(new Date("2026-10-06T22:00:00.000Z"));
    // 03:30 IST exactly: the next day's.
    expect(nextUpstoxExpiry(new Date("2026-10-06T22:00:00.000Z"))).toEqual(new Date("2026-10-07T22:00:00.000Z"));
  });

  it("reads a JWT's exp without trusting anything else", () => {
    const token = (payload: string) => `x.${Buffer.from(payload).toString("base64url")}.y`;
    expect(jwtExpiry(token('{"exp":1800000000}'))).toEqual(new Date(1_800_000_000_000));
    expect(jwtExpiry(token('{"exp":"soon"}'))).toBeUndefined();
    expect(jwtExpiry(token("null"))).toBeUndefined();
    expect(jwtExpiry(token("not json"))).toBeUndefined();
    expect(jwtExpiry("opaque")).toBeUndefined();
    const now = new Date("2026-10-06T00:00:00.000Z");
    expect(dhanExpiry(new Date(5), "opaque", now)).toEqual(new Date(5));
    // DhanHQ tokens last 24 hours (v2.4).
    expect(dhanExpiry(undefined, "opaque", now)).toEqual(new Date("2026-10-07T00:00:00.000Z"));
  });
});

describe("adapterOptions", () => {
  it("gives paper a quote source and other brokers the user's app as Secrets", () => {
    expect(adapterOptions("PAPER")).toHaveProperty("quotes");
    expect(adapterOptions("DHAN")).toEqual({});
    const options = adapterOptions("UPSTOX", { apiKey: "k", apiSecret: "s" }) as {
      appCredentials: Record<string, Secret>;
    };
    expect(options.appCredentials["apiSecret"]?.reveal()).toBe("s");
    expect(JSON.stringify(options)).not.toContain('"s"');
  });
});

describe("BrokerGateways", () => {
  it("builds one shared gateway per broker and fresh ones for a user's app", async () => {
    const { gateways, log } = buildGateways();

    expect(gateways.gateway("DHAN")).toBe(gateways.gateway("DHAN"));
    expect(gateways.has("UPSTOX")).toBe(true);
    expect(gateways.codes()).toEqual(["UPSTOX", "DHAN", "PAPER"]);
    expect(gateways.appGateway("UPSTOX", { apiKey: "k", apiSecret: "s" })).not.toBe(gateways.gateway("UPSTOX"));
    expect(log.appCredentials.at(-1)).toBeUndefined();
    expect(() => gateways.gateway("ZERODHA")).toThrow(BrokerDomainError);
    await gateways.onApplicationShutdown();
  });
});

describe("OAuthStateService", () => {
  function setup() {
    const store = new Map<string, string>();
    const redis = {
      client: {
        set: vi.fn((key: string, value: string) => {
          store.set(key, value);
          return Promise.resolve("OK");
        }),
        getdel: vi.fn((key: string) => {
          const value = store.get(key) ?? null;
          store.delete(key);
          return Promise.resolve(value);
        }),
      },
    };
    return { service: new OAuthStateService(redis as unknown as RedisService, buildVault()), store, redis };
  }
  const record = { userId: "u1", sessionId: "s1", brokerAccountId: "a1", broker: "UPSTOX" as const };

  it("issues a signed state that works once", async () => {
    const { service, redis } = setup();

    const state = await service.issue(record);

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(redis.client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth:state:/),
      expect.any(String),
      "EX",
      600,
      "NX",
    );
    expect(await service.consume(state)).toEqual(record);
    expect(await service.consume(state)).toBeNull();
  });

  it("refuses a forged signature without touching Redis, and a malformed one", async () => {
    const { service, redis } = setup();
    const state = await service.issue(record);
    const [nonce] = state.split(".");

    expect(await service.consume(`${nonce ?? ""}.${"A".repeat(43)}`)).toBeNull();
    expect(await service.consume("garbage")).toBeNull();
    expect(redis.client.getdel).not.toHaveBeenCalled();
  });

  it("refuses a state signed with another master key", async () => {
    const other = new OAuthStateService(
      { client: { set: () => Promise.resolve("OK") } } as unknown as RedisService,
      buildVault(Buffer.alloc(32, 9).toString("base64")),
    );
    const { service } = setup();

    expect(await service.consume(await other.issue(record))).toBeNull();
  });

  it("ignores a stored record of the wrong shape", async () => {
    const { service, store } = setup();
    const state = await service.issue(record);
    for (const key of store.keys()) store.set(key, "{not json");
    expect(await service.consume(state)).toBeNull();
    const second = await service.issue(record);
    for (const key of store.keys()) store.set(key, JSON.stringify({ userId: "u1" }));
    expect(await service.consume(second)).toBeNull();
  });
});

describe("BrokerAccessService", () => {
  async function setup() {
    const accounts = new MemoryAccounts();
    const vault = buildVault();
    const { gateways } = buildGateways();
    const audit = { record: vi.fn<AuditService["record"]>().mockResolvedValue(1n) };
    const prisma = {
      db: { $transaction: vi.fn((work: (tx: TenantTransaction) => Promise<unknown>) => work({} as TenantTransaction)) },
    };
    const scope = { userId: "alice", brokerAccountId: "acct1" };
    const dataKey = vault.createDataKey(scope);
    const sealed = vault.sealCredentials(scope, dataKey, { accessToken: Secret.of("tok"), clientId: "C1" });
    await accounts.repository.create(
      {},
      {
        id: "acct1",
        userId: "alice",
        broker: "DHAN",
        label: "D",
        status: "ACTIVE",
        isDefault: true,
        encKeyWrapped: dataKey.wrapped,
        encKeyIv: dataKey.iv,
        encryptedCredentials: sealed.ciphertext,
        credentialsIv: sealed.iv,
      },
    );
    const { events, emitted } = buildEvents();
    const service = new BrokerAccessService(
      prisma as unknown as PrismaService,
      accounts.asRepository(),
      vault,
      gateways,
      audit as unknown as AuditService,
      events,
    );
    return { service, accounts, audit, gateways, emitted };
  }

  it("decrypts an ACTIVE account into a ref with the broker's shared gateway", async () => {
    const { service, gateways } = await setup();

    const connected = await service.accountRef("alice", "acct1");

    expect(connected.ref.accountId).toBe("acct1");
    expect(connected.ref.creds.accessToken.reveal()).toBe("tok");
    expect(connected.gateway).toBe(gateways.gateway("DHAN"));
    expect((await service.defaultAccountRef("alice"))?.broker).toBe("DHAN");
    expect((await service.systemAccountRef("acct1"))?.userId).toBe("alice");
  });

  it("never hands out another user's account, or one that needs a login", async () => {
    const { service, accounts } = await setup();

    await expect(service.accountRef("bob", "acct1")).rejects.toBeInstanceOf(NotFoundError);
    expect(await service.defaultAccountRef("bob")).toBeNull();
    expect(await service.systemAccountRef("missing")).toBeNull();
    accounts.rows.set("acct1", { ...accounts.must("acct1"), status: "NEEDS_RELOGIN" });
    await expect(service.accountRef("alice", "acct1")).rejects.toMatchObject({ code: "NEEDS_RELOGIN" });
  });

  it("flags a refused token once, audited as the system, with one deactivated event", async () => {
    const { service, accounts, audit, emitted } = await setup();

    expect(await service.markNeedsRelogin("alice", "acct1")).toBe(true);
    expect(await service.markNeedsRelogin("alice", "acct1")).toBe(false);
    expect(await service.markNeedsRelogin("bob", "acct1")).toBe(false);
    expect(accounts.get("acct1")?.status).toBe("NEEDS_RELOGIN");
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      action: "broker.expire",
      actor: { type: "system" },
      data: { broker: "DHAN", reason: "refused" },
    });
    expect(emitted).toEqual([{ name: "deactivated", event: { userId: "alice", accountId: "acct1", broker: "DHAN" } }]);
  });

  it("doesn't flag an account that changed between the read and the write", async () => {
    const { service, accounts, emitted } = await setup();
    const repository = accounts.repository;
    const update = repository.update;
    repository.update = () => Promise.resolve(false);

    expect(await service.markNeedsRelogin("alice", "acct1")).toBe(false);
    repository.update = update;
    expect(emitted).toEqual([]);
  });
});

describe("BrokerEvents", () => {
  it("emits the broker.account events with exactly userId, accountId and broker", () => {
    const emitter = new EventEmitter2();
    const seen: { name: string; payload: unknown }[] = [];
    for (const name of Object.values(BROKER_ACCOUNT_EVENTS)) {
      emitter.on(name, (payload: unknown) => seen.push({ name, payload }));
    }
    const events = new BrokerEvents(emitter, logger());
    const extra = { userId: "u1", accountId: "a1", broker: "DHAN" as const, token: "never" };

    events.activated(extra);
    events.deactivated({ userId: "u1", accountId: "a1", broker: "DHAN" });

    expect(seen).toEqual([
      { name: "broker.account.activated", payload: { userId: "u1", accountId: "a1", broker: "DHAN" } },
      { name: "broker.account.deactivated", payload: { userId: "u1", accountId: "a1", broker: "DHAN" } },
    ]);
  });

  it("logs a listener's failure instead of failing the change that already happened", () => {
    const emitter = new EventEmitter2();
    emitter.on(BROKER_ACCOUNT_EVENTS.deactivated, () => {
      throw new Error("listener bug");
    });
    const error = vi.fn();
    const events = new BrokerEvents(emitter, { setContext: vi.fn(), error } as unknown as PinoLogger);

    expect(() => {
      events.deactivated({ userId: "u1", accountId: "a1", broker: "UPSTOX" });
    }).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "broker.account.deactivated", brokerAccountId: "a1" }),
      "broker event listener failed",
    );
  });
});
