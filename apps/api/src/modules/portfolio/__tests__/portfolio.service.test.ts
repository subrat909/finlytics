import {
  BrokerUnavailableError,
  createBrokerRegistry,
  MemoryRateLimiter,
  NeedsReloginError,
  RateLimitedError,
  Secret,
} from "@finlytics/broker-sdk";
import type { BrokerGateway, BrokerHolding, BrokerPosition } from "@finlytics/broker-sdk";
import { FundsViewSchema, HoldingsViewSchema, PositionsViewSchema } from "@finlytics/shared";
import type { BrokerCode, InstrumentKey } from "@finlytics/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { FakeBrokerScript } from "../../../../test/support/fake-broker";
import type { Clock } from "../../../common/clock";
import { NotFoundError } from "../../../common/problem-json/domain-errors";
import type { BrokerAccessService, ConnectedAccount } from "../../brokers/broker-access.service";
import { BrokerGateways } from "../../brokers/broker-gateways";
import { gateways as buildGateways, logger } from "../../brokers/__tests__/support";
import type { InstrumentInfo, QuotePrices } from "../portfolio.mapper";
import type { PortfolioAccountRow, PortfolioRepository } from "../portfolio.repository";
import { NO_ACCOUNT_DETAIL, PORTFOLIO_CACHE_TTL_MS, PortfolioService, RELOGIN_DETAIL } from "../portfolio.service";

const NOW = new Date("2026-10-06T05:00:00.000Z");
const key = (text: string) => text as InstrumentKey;
const INFY = key("NSE_EQ|INFY");
const TCS = key("NSE_EQ|TCS");
const NIFTY_CE = key("NSE_FO|NIFTY|2026-10-27|25000|CE");
const UNKNOWN_FUT = key("NSE_FO|ZZZ|2026-10-27");

const POSITIONS: BrokerPosition[] = [
  {
    instrumentKey: INFY,
    product: "INTRADAY",
    netQty: 0,
    buyQty: 10,
    sellQty: 10,
    buyAvg: "1500",
    sellAvg: "1510",
    realisedPnl: "100",
  },
  {
    instrumentKey: UNKNOWN_FUT,
    product: "MARGIN",
    netQty: 25,
    buyQty: 25,
    sellQty: 0,
    buyAvg: "100",
    sellAvg: "0",
    realisedPnl: "0",
    ltp: "110",
    unrealisedPnl: "250",
  },
  {
    instrumentKey: NIFTY_CE,
    product: "MARGIN",
    netQty: -50,
    buyQty: 0,
    sellQty: 50,
    buyAvg: "0",
    sellAvg: "120.5",
    realisedPnl: "0",
  },
];

const HOLDINGS: BrokerHolding[] = [
  { instrumentKey: INFY, qty: 10, avgPrice: "1400", ltp: "1500" },
  { instrumentKey: TCS, qty: 5, t1Qty: 1, avgPrice: "3000" },
];

const INSTRUMENTS: InstrumentInfo[] = [
  { key: INFY, exchange: "NSE", segment: "EQ", symbol: "INFY", tradingSymbol: null, name: "Infosys", lotSize: 1 },
  { key: TCS, exchange: "NSE", segment: "EQ", symbol: "TCS", tradingSymbol: "TCS", name: "TCS Ltd", lotSize: 1 },
  {
    key: NIFTY_CE,
    exchange: "NFO",
    segment: "OPT",
    symbol: "NIFTY",
    tradingSymbol: "NIFTY26OCT25000CE",
    name: "NIFTY 27 OCT 25000 CE",
    lotSize: 75,
  },
];

const QUOTES: Record<string, QuotePrices> = {
  [NIFTY_CE]: { ltp: "100.25", close: "90" },
  [TCS]: { ltp: "3500.123456", close: "3450" },
  [INFY]: { ltp: "1499", close: "1490" },
};

interface Options {
  readonly accounts?: (PortfolioAccountRow & { userId: string; isDefault?: boolean })[];
  readonly script?: Partial<FakeBrokerScript>;
  readonly broker?: BrokerCode;
  /** Replaces the fake broker's gateway (a stub that fails without the gateway's retry backoff, or a real one). */
  readonly gateway?: BrokerGateway;
}

/** A gateway whose portfolio calls all fail with `error`, at once (`fail` records them). */
function failingGateway(error: Error) {
  const fail = vi.fn(() => Promise.reject(error));
  return { fail, gateway: { getFunds: fail, getPositions: fail, getHoldings: fail } as unknown as BrokerGateway };
}

function setup(options: Options = {}) {
  const accounts = options.accounts ?? [{ id: "acct1", userId: "alice", broker: "DHAN", status: "ACTIVE" }];
  const cache = new Map<string, string>();
  const repository = {
    findAccount: vi.fn((userId: string, id: string) =>
      Promise.resolve(accounts.find((row) => row.id === id && row.userId === userId) ?? null),
    ),
    findDefaultAccount: vi.fn((userId: string) =>
      Promise.resolve(
        accounts.find((row) => row.userId === userId && row.status === "ACTIVE" && row.isDefault === true) ??
          accounts.find((row) => row.userId === userId && row.status === "ACTIVE") ??
          null,
      ),
    ),
    needsLogin: vi.fn((userId: string) =>
      Promise.resolve(accounts.some((row) => row.userId === userId && row.status === "NEEDS_RELOGIN")),
    ),
    instruments: vi.fn((keys: readonly string[]) =>
      Promise.resolve(INSTRUMENTS.filter((row) => keys.includes(row.key))),
    ),
    quotes: vi.fn((keys: readonly string[]) =>
      Promise.resolve(new Map(keys.flatMap((k) => (QUOTES[k] === undefined ? [] : [[k, QUOTES[k]] as const])))),
    ),
    readCache: vi.fn((cacheKey: string) => Promise.resolve(cache.get(cacheKey) ?? null)),
    writeCache: vi.fn((cacheKey: string, json: string) => {
      cache.set(cacheKey, json);
      return Promise.resolve();
    }),
  };
  const broker = options.broker ?? "DHAN";
  const { gateways, log } = buildGateways({
    [broker]: { authMode: "token", positions: POSITIONS, holdings: HOLDINGS, ...options.script },
  });
  const access = {
    accountRef: vi.fn((userId: string, id: string): Promise<ConnectedAccount> => {
      const row = accounts.find((candidate) => candidate.id === id && candidate.userId === userId);
      if (row === undefined) return Promise.reject(new NotFoundError("Broker account not found."));
      return Promise.resolve({
        userId,
        broker: row.broker,
        ref: { accountId: id, creds: { accessToken: Secret.of(`token-${id}`), clientId: "1100" } },
        gateway: options.gateway ?? gateways.gateway(row.broker),
      });
    }),
    markNeedsRelogin: vi.fn().mockResolvedValue(true),
  };
  const clock: Clock = { now: () => NOW };
  const warn = vi.fn();
  const service = new PortfolioService(
    repository as unknown as PortfolioRepository,
    access as unknown as BrokerAccessService,
    clock,
    { setContext: vi.fn(), warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as PinoLogger,
  );
  return { service, repository, access, cache, log, warn };
}

describe("PortfolioService: which account", () => {
  it("reads the user's default ACTIVE account when no account is named", async () => {
    const { service, access } = setup({
      accounts: [
        { id: "a-old", userId: "alice", broker: "DHAN", status: "ACTIVE" },
        { id: "a-default", userId: "alice", broker: "DHAN", status: "ACTIVE", isDefault: true },
      ],
    });

    const funds = await service.funds("alice", {});

    expect(funds).toMatchObject({ accountId: "a-default", broker: "DHAN", asOf: NOW.toISOString() });
    expect(access.accountRef).toHaveBeenCalledWith("alice", "a-default");
  });

  it("reads a named account of the user's, and 404s for another user's without calling the broker", async () => {
    const { service, log } = setup({
      accounts: [
        { id: "mine", userId: "alice", broker: "DHAN", status: "ACTIVE" },
        { id: "bobs", userId: "bob", broker: "DHAN", status: "ACTIVE" },
      ],
    });

    expect(await service.funds("alice", { accountId: "mine" })).toMatchObject({ accountId: "mine" });
    await expect(service.funds("alice", { accountId: "bobs" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      detail: "Broker account not found.",
    });
    expect(log.calls.map((call) => call.token)).toEqual(["token-mine"]);
  });

  it("answers 404 'Connect a broker' without any account, and 409 when one needs a new login", async () => {
    await expect(setup({ accounts: [] }).service.positions("alice", {})).rejects.toMatchObject({
      code: "NOT_FOUND",
      detail: NO_ACCOUNT_DETAIL,
    });
    const expired = setup({ accounts: [{ id: "a1", userId: "alice", broker: "UPSTOX", status: "NEEDS_RELOGIN" }] });
    await expect(expired.service.positions("alice", {})).rejects.toMatchObject({
      code: "NEEDS_RELOGIN",
      detail: RELOGIN_DETAIL,
    });
    await expect(expired.service.positions("alice", { accountId: "a1" })).rejects.toMatchObject({
      code: "NEEDS_RELOGIN",
    });
    expect(expired.access.accountRef).not.toHaveBeenCalled();
  });
});

describe("PortfolioService: cache", () => {
  it("serves a view from the 5-second cache, per user, account and kind", async () => {
    const { service, repository, log } = setup();

    const first = await service.funds("alice", {});
    const second = await service.funds("alice", {});

    expect(second).toEqual(first);
    expect(log.calls.filter((call) => call.method === "getFunds")).toHaveLength(1);
    expect(repository.writeCache).toHaveBeenCalledWith(
      "portfolio:alice:acct1:funds",
      JSON.stringify(first),
      PORTFOLIO_CACHE_TTL_MS,
    );
    expect(PORTFOLIO_CACHE_TTL_MS).toBe(5_000);
    await service.holdings("alice", {});
    expect(log.calls.map((call) => call.method)).toEqual(["getFunds", "getHoldings"]);
  });

  it("shares one broker call between concurrent misses (single-flight)", async () => {
    const { service, log } = setup();

    const views = await Promise.all([service.positions("alice", {}), service.positions("alice", {})]);

    expect(views[0]).toEqual(views[1]);
    expect(log.calls).toHaveLength(1);
  });

  it("treats a cached value that isn't a valid view as a miss", async () => {
    const { service, cache, log } = setup();
    cache.set("portfolio:alice:acct1:funds", "{not json");
    cache.set("portfolio:alice:acct1:holdings", JSON.stringify({ accountId: "acct1" }));

    expect(FundsViewSchema.parse(await service.funds("alice", {}))).toBeDefined();
    expect(HoldingsViewSchema.parse(await service.holdings("alice", {}))).toBeDefined();
    expect(log.calls).toHaveLength(2);
  });
});

describe("PortfolioService: views", () => {
  it("maps funds, with null for what the broker doesn't report", async () => {
    const { service } = setup({
      script: { funds: { availableMargin: "1000.5", usedMargin: "200", collateral: "0" } },
    });

    expect(await service.funds("alice", {})).toEqual({
      accountId: "acct1",
      broker: "DHAN",
      asOf: NOW.toISOString(),
      availableMargin: "1000.5",
      usedMargin: "200",
      collateral: "0",
      withdrawable: null,
    });
  });

  it("enriches positions from the instrument master and quote cache, open positions first", async () => {
    const { service, repository } = setup();

    const view = PositionsViewSchema.parse(await service.positions("alice", {}));

    expect(view.positions.map((row) => [row.symbol, row.netQty])).toEqual([
      ["NIFTY26OCT25000CE", -50],
      ["ZZZ 2026-10-27 FUT", 25],
      ["INFY", 0],
    ]);
    expect(view.positions[0]).toMatchObject({
      name: "NIFTY 27 OCT 25000 CE",
      exchange: "NFO",
      segment: "OPT",
      lotSize: 75,
      ltp: "100.25",
      unrealisedPnl: "1012.5",
    });
    expect(view.positions[1]).toMatchObject({
      name: null,
      exchange: "NFO",
      segment: "FUT",
      lotSize: null,
      ltp: "110",
      unrealisedPnl: "250",
    });
    expect(view.positions[2]).toMatchObject({ ltp: "1499", unrealisedPnl: "0", realisedPnl: "100" });
    // Quotes only for rows the broker sent without a price.
    expect(repository.quotes).toHaveBeenCalledWith([INFY, NIFTY_CE]);
  });

  it("enriches holdings and sorts them by value", async () => {
    const { service } = setup();

    const view = HoldingsViewSchema.parse(await service.holdings("alice", {}));

    expect(view.holdings).toEqual([
      {
        instrumentKey: TCS,
        symbol: "TCS",
        name: "TCS Ltd",
        exchange: "NSE",
        segment: "EQ",
        lotSize: 1,
        qty: 5,
        t1Qty: 1,
        avgPrice: "3000",
        ltp: "3500.1235",
        close: "3450",
      },
      {
        instrumentKey: INFY,
        symbol: "INFY",
        name: "Infosys",
        exchange: "NSE",
        segment: "EQ",
        lotSize: 1,
        qty: 10,
        t1Qty: 0,
        avgPrice: "1400",
        ltp: "1500",
        close: "1490",
      },
    ]);
  });

  it("reads paper accounts through the paper adapter, like any broker", async () => {
    const paper = new BrokerGateways(createBrokerRegistry(), new MemoryRateLimiter(), logger()).gateway("PAPER");
    const { service } = setup({
      broker: "PAPER",
      accounts: [{ id: "paper1", userId: "alice", broker: "PAPER", status: "ACTIVE" }],
      gateway: paper,
    });

    expect(await service.funds("alice", {})).toEqual({
      accountId: "paper1",
      broker: "PAPER",
      asOf: NOW.toISOString(),
      availableMargin: "1000000",
      usedMargin: "0",
      collateral: "0",
      withdrawable: "1000000",
    });
    expect(await service.positions("alice", {})).toMatchObject({ broker: "PAPER", positions: [] });
    expect(await service.holdings("alice", {})).toMatchObject({ broker: "PAPER", holdings: [] });
    await paper.close();
  });
});

describe("PortfolioService: broker failures", () => {
  it("flags the account and answers 409 when the broker refuses the token", async () => {
    const { service, access, repository, log } = setup({ script: { portfolioError: new NeedsReloginError("401") } });

    await expect(service.holdings("alice", {})).rejects.toMatchObject({ code: "NEEDS_RELOGIN" });
    expect(access.markNeedsRelogin).toHaveBeenCalledWith("alice", "acct1");
    expect(repository.writeCache).not.toHaveBeenCalled();
    expect(log.calls).toHaveLength(1);
  });

  it("still answers 409 when flagging the account fails", async () => {
    const { service, access, warn } = setup({ script: { portfolioError: new NeedsReloginError("401") } });
    access.markNeedsRelogin.mockRejectedValueOnce(new Error("database down"));

    await expect(service.funds("alice", {})).rejects.toMatchObject({ code: "NEEDS_RELOGIN" });
    expect(warn).toHaveBeenCalled();
  });

  it("answers 503 BROKER_UNAVAILABLE for an outage, caches nothing and asks again next time", async () => {
    const { gateway, fail } = failingGateway(new BrokerUnavailableError("down"));
    const { service, access, repository } = setup({ gateway });

    await expect(service.funds("alice", {})).rejects.toMatchObject({ code: "BROKER_UNAVAILABLE", retryAfterSec: 5 });
    await expect(service.funds("alice", {})).rejects.toMatchObject({ code: "BROKER_UNAVAILABLE" });
    expect(access.markNeedsRelogin).not.toHaveBeenCalled();
    expect(repository.writeCache).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it("passes the broker's rate limit on as 429", async () => {
    const { service } = setup({
      gateway: failingGateway(new RateLimitedError("slow down", { retryAfterMs: 2_000 })).gateway,
    });

    await expect(service.positions("alice", {})).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 2 });
  });
});
