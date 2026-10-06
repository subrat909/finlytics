import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrokerAdapter } from "../adapter";
import { INSTRUMENTS, NIFTY_CE, order } from "../brokers/paper/__tests__/fixtures";
import { CircuitBreakerRegistry } from "../circuit-breaker";
import { Secret } from "../credentials";
import {
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerUnavailableError,
  DependencyUnavailableError,
  isBrokerError,
  NeedsReloginError,
  RateLimitedError,
} from "../errors";
import type { BrokerError } from "../errors";
import type { FeedStatus, MarketFeed, OrderFeed } from "../feed/feed";
import { BrokerGateway } from "../gateway";
import type { BrokerAccountRef, BrokerGatewayOptions } from "../gateway";
import type { Candle, Funds, InstrumentRow, Profile } from "../models";
import { MemoryRateLimiter } from "../rate-limit/memory-rate-limiter";
import type { RateLimiter } from "../rate-limit/rate-limiter";

const TOKEN = "live-token-abcdef123456";
const ACCOUNT: BrokerAccountRef = { accountId: "acc1", creds: { accessToken: Secret.of(TOKEN), clientId: "AB1234" } };
const PROFILE: Profile = { brokerClientId: "AB1234", name: "Asha", exchanges: ["NSE", "NFO"] };
const FUNDS: Funds = { availableMargin: "1000.5", usedMargin: "0", collateral: "0" };
const CANDLES: Candle[] = [
  { ts: 1_000, open: "10", high: "11", low: "9", close: "10.5", volume: 5 },
  { ts: 2_000, open: "10.5", high: "10.5", low: "10", close: "10", volume: 3 },
];
const QUERY = { instrumentKey: NIFTY_CE, timeframe: "M1" as const, from: new Date(0), to: new Date(10_000) };

function fakeFeed(): MarketFeed & OrderFeed {
  let status: FeedStatus = "up";
  return {
    get status() {
      return status;
    },
    subscribe: () => Promise.resolve(),
    unsubscribe: () => Promise.resolve(),
    subscriptions: () => new Map(),
    on: () => () => undefined,
    close: () => {
      status = "closed";
      return Promise.resolve();
    },
  };
}

function stubAdapter(overrides: Partial<BrokerAdapter> = {}): BrokerAdapter {
  return {
    code: "UPSTOX",
    capabilities: { authMode: "oauth", refreshable: false, maxFeedInstruments: 100, orderFeedScope: "app" },
    getAuthUrl: ({ state }) => ({ mode: "oauth", url: `https://broker.example/login?state=${state}` }),
    exchangeToken: () => Promise.resolve({ accessToken: Secret.of("new-token-123456") }),
    refreshToken: () => Promise.reject(new NeedsReloginError("Upstox tokens can't be refreshed")),
    getProfile: () => Promise.resolve(PROFILE),
    getFunds: () => Promise.resolve(FUNDS),
    async *downloadInstrumentMaster() {
      yield* await Promise.resolve(INSTRUMENTS);
    },
    placeOrder: () => Promise.resolve({ brokerOrderId: "B1" }),
    modifyOrder: () => Promise.resolve(),
    cancelOrder: () => Promise.resolve(),
    getOrderBook: () => Promise.resolve([]),
    getPositions: () => Promise.resolve([]),
    getHoldings: () => Promise.resolve([]),
    getHistoricalCandles: () => Promise.resolve(CANDLES),
    connectMarketFeed: () => Promise.resolve(fakeFeed()),
    connectOrderFeed: () => Promise.resolve(fakeFeed()),
    ...overrides,
  };
}

interface Harness {
  readonly gateway: BrokerGateway;
  readonly adapter: BrokerAdapter;
  readonly logs: unknown[][];
  readonly sleep: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<BrokerAdapter> = {}, options: Partial<BrokerGatewayOptions> = {}): Harness {
  const adapter = stubAdapter(overrides);
  const logs: unknown[][] = [];
  const sleep = vi.fn(() => Promise.resolve());
  const gateway = new BrokerGateway({
    adapter,
    rateLimiter: new MemoryRateLimiter(),
    logger: { debug: (...args) => logs.push(["debug", ...args]), warn: (...args) => logs.push(["warn", ...args]) },
    sleep,
    random: () => 0,
    ...options,
  });
  return { gateway, adapter, logs, sleep };
}

async function failure(promise: Promise<unknown>): Promise<BrokerError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isBrokerError(error)) throw new Error(`expected a BrokerError, got ${String(error)}`);
  return error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BrokerGateway calls", () => {
  it("passes valid calls through and returns the validated result", async () => {
    const { gateway, logs } = harness();
    expect(gateway.broker).toBe("UPSTOX");
    expect(gateway.capabilities.authMode).toBe("oauth");
    expect(gateway.getAuthUrl({ state: "s1", redirectUri: "https://finlytics.app/cb" })).toEqual({
      mode: "oauth",
      url: "https://broker.example/login?state=s1",
    });
    expect(await gateway.getProfile(ACCOUNT)).toEqual(PROFILE);
    expect(await gateway.getFunds(ACCOUNT)).toEqual(FUNDS);
    expect(await gateway.placeOrder(ACCOUNT, order())).toEqual({ brokerOrderId: "B1" });
    await gateway.modifyOrder(ACCOUNT, { brokerOrderId: "B1", qty: 150 });
    await gateway.cancelOrder(ACCOUNT, "B1");
    expect(await gateway.getOrderBook(ACCOUNT)).toEqual([]);
    expect(await gateway.getPositions(ACCOUNT)).toEqual([]);
    expect(await gateway.getHoldings(ACCOUNT)).toEqual([]);
    expect(await gateway.getHistoricalCandles(ACCOUNT, QUERY)).toEqual(CANDLES);
    expect((await gateway.exchangeToken({ code: "auth-code-123456" })).accessToken.reveal()).toBe("new-token-123456");
    expect(logs[0]).toEqual([
      "debug",
      {
        broker: "UPSTOX",
        accountId: "acc1",
        operation: "getProfile",
        op: 3,
        durationMs: expect.any(Number) as unknown,
      },
      "broker call succeeded",
    ]);
  });

  it("validates inputs before anything reaches the broker", async () => {
    const placeOrder = vi.fn();
    const { gateway } = harness({ placeOrder });
    const error = await failure(gateway.placeOrder(ACCOUNT, order({ type: "LIMIT" })));
    expect([error.code, error.message]).toEqual(["VALIDATION", "Invalid order: price: Required for this order type"]);
    expect((await failure(gateway.modifyOrder(ACCOUNT, { brokerOrderId: "B1" }))).code).toBe("VALIDATION");
    expect((await failure(gateway.cancelOrder(ACCOUNT, "bad id"))).code).toBe("VALIDATION");
    expect(
      (await failure(gateway.getHistoricalCandles(ACCOUNT, { ...QUERY, instrumentKey: "x" as typeof NIFTY_CE }))).code,
    ).toBe("VALIDATION");
    expect((await failure(gateway.getHistoricalCandles(ACCOUNT, { ...QUERY, timeframe: "M2" as "M1" }))).code).toBe(
      "VALIDATION",
    );
    expect(
      (await failure(gateway.getHistoricalCandles(ACCOUNT, { ...QUERY, from: new Date(20_000) }))).message,
    ).toMatch(/from must be before to/);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("treats invalid adapter output as an internal error, outcome unknown for state changes", async () => {
    const { gateway } = harness({
      getFunds: () => Promise.resolve({ ...FUNDS, availableMargin: 1000.5 } as unknown as Funds),
      placeOrder: () => Promise.resolve({ brokerOrderId: "" }),
      getHistoricalCandles: () => Promise.resolve([...CANDLES].reverse()),
      exchangeToken: () =>
        Promise.resolve({ accessToken: "plain" } as unknown as Awaited<ReturnType<BrokerAdapter["exchangeToken"]>>),
      getAuthUrl: () => ({ mode: "oauth", url: "http://insecure" }),
    });
    const funds = await failure(gateway.getFunds(ACCOUNT));
    expect([funds.code, funds.message, funds.outcomeUnknown]).toEqual([
      "INTERNAL",
      "Adapter returned an invalid funds",
      false,
    ]);
    const placed = await failure(gateway.placeOrder(ACCOUNT, order()));
    expect([placed.code, placed.outcomeUnknown, placed.operation]).toEqual(["INTERNAL", true, "placeOrder"]);
    expect((await failure(gateway.getHistoricalCandles(ACCOUNT, QUERY))).code).toBe("INTERNAL");
    expect((await failure(gateway.exchangeToken({ code: "c" }))).message).toBe("Adapter returned invalid credentials");
    expect(() => gateway.getAuthUrl({ state: "s", redirectUri: "https://x" })).toThrow(
      "Adapter returned an invalid auth start",
    );
  });

  it("accepts credentials with an expiry and a refresh token", async () => {
    const creds = { accessToken: Secret.of("a-123456"), refreshToken: Secret.of("r-123456"), expiresAt: new Date(1) };
    const { gateway } = harness({ refreshToken: () => Promise.resolve(creds) });
    expect(await gateway.refreshToken(ACCOUNT)).toBe(creds);
  });
});

describe("BrokerGateway retries and timeouts", () => {
  it("retries a read on a retryable error with backoff, then succeeds", async () => {
    const getPositions = vi
      .fn<BrokerAdapter["getPositions"]>()
      .mockRejectedValueOnce(new BrokerUnavailableError("502"))
      .mockRejectedValueOnce(new RateLimitedError("429", { retryAfterMs: 300 }))
      .mockResolvedValue([]);
    const { gateway, sleep } = harness({ getPositions });
    expect(await gateway.getPositions(ACCOUNT)).toEqual([]);
    expect(getPositions).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call: unknown[]) => call[0])).toEqual([100, 300]);
  });

  it("gives up after the configured retries, or when the broker asks to wait too long", async () => {
    const getFunds = vi.fn<BrokerAdapter["getFunds"]>().mockRejectedValue(new BrokerUnavailableError("down"));
    const { gateway } = harness({ getFunds }, { retry: { retries: 1 } });
    expect((await failure(gateway.getFunds(ACCOUNT))).code).toBe("BROKER_UNAVAILABLE");
    expect(getFunds).toHaveBeenCalledTimes(2);

    const getHoldings = vi
      .fn<BrokerAdapter["getHoldings"]>()
      .mockRejectedValue(new RateLimitedError("429", { retryAfterMs: 60_000 }));
    const second = harness({ getHoldings });
    expect((await failure(second.gateway.getHoldings(ACCOUNT))).retryAfterMs).toBe(60_000);
    expect(getHoldings).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-retryable error or a state change", async () => {
    const getOrderBook = vi.fn<BrokerAdapter["getOrderBook"]>().mockRejectedValue(new NeedsReloginError("expired"));
    const placeOrder = vi.fn<BrokerAdapter["placeOrder"]>().mockRejectedValue(new BrokerUnavailableError("reset"));
    const { gateway } = harness({ getOrderBook, placeOrder });
    expect((await failure(gateway.getOrderBook(ACCOUNT))).code).toBe("NEEDS_RELOGIN");
    const placed = await failure(gateway.placeOrder(ACCOUNT, order()));
    expect([placed.code, placed.outcomeUnknown, placed.retryable]).toEqual(["BROKER_UNAVAILABLE", true, false]);
    expect(getOrderBook).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });

  it("times a placement out after 5 s as outcome unknown, once, and aborts the adapter's signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const placeOrder = vi.fn<BrokerAdapter["placeOrder"]>((ctx) => {
      signal = ctx.signal;
      return new Promise<never>(() => undefined);
    });
    const { gateway } = harness({ placeOrder });
    const pending = failure(gateway.placeOrder(ACCOUNT, order()));
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await pending;
    expect([error.name, error.code, error.outcomeUnknown, error.operation]).toEqual([
      "BrokerTimeoutError",
      "BROKER_UNAVAILABLE",
      true,
      "placeOrder",
    ]);
    expect(signal?.aborted).toBe(true);
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });

  it("uses per-method timeouts", async () => {
    vi.useFakeTimers();
    const { gateway } = harness(
      { getFunds: () => new Promise<never>(() => undefined) },
      { timeoutsMs: { getFunds: 50 } },
    );
    const pending = failure(gateway.getFunds(ACCOUNT));
    await vi.advanceTimersByTimeAsync(50 * 3 + 1_000);
    expect((await pending).message).toBe("Timed out after 50 ms");
  });

  it("passes the caller's abort through without counting it against the broker", async () => {
    const controller = new AbortController();
    const breakers = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const { gateway } = harness(
      {
        getFunds: () => {
          controller.abort(new Error("client went away"));
          return Promise.reject(new BrokerUnavailableError("aborted"));
        },
      },
      { breakers },
    );
    await expect(gateway.getFunds(ACCOUNT, { signal: controller.signal })).rejects.toThrow("client went away");
    expect(breakers.get("UPSTOX", "acc1").state).toBe("closed");
    await expect(gateway.getFunds(ACCOUNT, { signal: controller.signal })).rejects.toThrow("client went away");
  });
});

describe("BrokerGateway guard rails", () => {
  it("opens the circuit after repeated failures and stops calling the broker", async () => {
    const getProfile = vi.fn<BrokerAdapter["getProfile"]>().mockRejectedValue(new BrokerUnavailableError("down"));
    const breakers = new CircuitBreakerRegistry({ failureThreshold: 2 });
    const { gateway } = harness({ getProfile }, { breakers, retry: { retries: 0 } });
    await failure(gateway.getProfile(ACCOUNT));
    await failure(gateway.getProfile(ACCOUNT));
    const open = await failure(gateway.getProfile(ACCOUNT));
    expect([open.name, open.broker, open.operation, open.outcomeUnknown]).toEqual([
      "CircuitOpenError",
      "UPSTOX",
      "getProfile",
      false,
    ]);
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(breakers.get("UPSTOX", "other").state).toBe("closed");
  });

  it("refuses with RATE_LIMITED when no token comes in time, without touching the breaker", async () => {
    const limiter: RateLimiter = {
      tryAcquire: () => Promise.reject(new Error("unused")),
      acquire: () => Promise.reject(new RateLimitedError("budget used up", { retryAfterMs: 120 })),
    };
    const breakers = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const placeOrder = vi.fn();
    const { gateway } = harness({ placeOrder }, { rateLimiter: limiter, breakers });
    const error = await failure(gateway.placeOrder(ACCOUNT, order()));
    expect([error.code, error.retryAfterMs, error.outcomeUnknown]).toEqual(["RATE_LIMITED", 120, false]);
    expect(placeOrder).not.toHaveBeenCalled();
    expect(breakers.get("UPSTOX", "acc1").acquire()).toBeDefined();
  });

  it("charges each class to its own bucket", async () => {
    const acquire = vi.fn<RateLimiter["acquire"]>(() => Promise.resolve());
    const { gateway } = harness(
      {},
      { rateLimiter: { tryAcquire: vi.fn(), acquire }, rateLimitMaxWaitMs: { orders: 0 } },
    );
    await gateway.placeOrder(ACCOUNT, order());
    await gateway.getHistoricalCandles(ACCOUNT, QUERY);
    await gateway.exchangeToken({});
    expect(
      acquire.mock.calls.map(([scope, options]) => [scope.accountId, scope.rateClass, options?.maxWaitMs]),
    ).toEqual([
      ["acc1", "orders", 0],
      ["acc1", "data", 5_000],
      ["app", "standard", 2_000],
    ]);
  });

  it("fails closed when the limiter's store is down, and passes the caller's abort through", async () => {
    const down: RateLimiter = {
      tryAcquire: vi.fn(),
      acquire: () => Promise.reject(new DependencyUnavailableError("redis down")),
    };
    expect((await failure(harness({}, { rateLimiter: down }).gateway.getFunds(ACCOUNT))).code).toBe(
      "SERVICE_UNAVAILABLE",
    );

    const controller = new AbortController();
    const waiting: RateLimiter = {
      tryAcquire: vi.fn(),
      acquire: () => {
        controller.abort(new Error("shutdown"));
        return Promise.reject(new Error("aborted"));
      },
    };
    await expect(
      harness({}, { rateLimiter: waiting }).gateway.getFunds(ACCOUNT, { signal: controller.signal }),
    ).rejects.toThrow("shutdown");
  });

  it("redacts tokens from errors and logs, keeping the broker's code", async () => {
    const leak = `Invalid token ${TOKEN} (Authorization: Bearer ${TOKEN})`;
    const { gateway, logs } = harness({
      getFunds: () =>
        Promise.reject(new BrokerRejectedError(leak, { brokerError: { code: "UDAPI100050", message: leak } })),
      getProfile: () => Promise.reject(new TypeError(`fetch failed for access_token=${TOKEN}`)),
      exchangeToken: () => Promise.reject(new BrokerRejectedError("code auth-code-123456 was already used")),
    });
    const rejected = await failure(gateway.getFunds(ACCOUNT));
    expect(rejected.message).toBe("Invalid token [REDACTED] (Authorization: Bearer [REDACTED])");
    expect(rejected.brokerError).toEqual({
      code: "UDAPI100050",
      message: "Invalid token [REDACTED] (Authorization: Bearer [REDACTED])",
    });
    expect(rejected.retryable).toBe(false);

    const internal = await failure(gateway.getProfile(ACCOUNT));
    expect([internal.code, internal.message]).toEqual([
      "INTERNAL",
      "Unexpected adapter error (TypeError: fetch failed for access_token=[REDACTED])",
    ]);

    expect((await failure(gateway.exchangeToken({ code: "auth-code-123456" }))).message).toBe(
      "code [REDACTED] was already used",
    );
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(JSON.stringify(logs)).not.toContain("auth-code-123456");
    expect(logs.at(-1)?.[0]).toBe("warn");
  });

  it("describes non-Error throws without their content", async () => {
    const { gateway } = harness({
      // A buggy adapter throwing a plain object is exactly the case under test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      getHoldings: () => Promise.reject(Object.assign(Object.create(null) as object, { token: TOKEN })),
    });
    expect((await failure(gateway.getHoldings(ACCOUNT))).message).toBe("Unexpected adapter error (object)");
  });

  it("maps a thrown getAuthUrl and keeps its own context on errors", () => {
    const { gateway } = harness({
      getAuthUrl: () => {
        throw new BrokerNotFoundError("no app");
      },
    });
    let error: unknown;
    try {
      gateway.getAuthUrl({ state: "s", redirectUri: "https://x" });
    } catch (caught: unknown) {
      error = caught;
    }
    expect(isBrokerError(error) && [error.code, error.operation]).toEqual(["NOT_FOUND", "getAuthUrl"]);
  });
});

describe("BrokerGateway instrument master", () => {
  const collect = async (rows: AsyncIterable<InstrumentRow>): Promise<string[]> => {
    const keys: string[] = [];
    for await (const row of rows) keys.push(row.instrumentKey);
    return keys;
  };

  it("streams valid rows and skips invalid ones", async () => {
    const [option, equity] = INSTRUMENTS as [InstrumentRow, InstrumentRow];
    const { gateway, logs } = harness({
      async *downloadInstrumentMaster() {
        yield* await Promise.resolve([option, { ...equity, lotSize: 0 }, equity]);
      },
    });
    expect(await collect(gateway.downloadInstrumentMaster())).toEqual([option.instrumentKey, equity.instrumentKey]);
    expect(logs.at(-1)?.[1]).toMatchObject({
      operation: "downloadInstrumentMaster",
      rows: 2,
      skipped: 1,
      accountId: "app",
    });
  });

  it("maps adapter errors, and times out the whole download", async () => {
    const failing = harness({
      // eslint-disable-next-line require-yield -- an iterator that fails before its first row
      async *downloadInstrumentMaster() {
        await Promise.resolve();
        throw new BrokerUnavailableError("CDN down");
      },
    });
    expect((await failure(collect(failing.gateway.downloadInstrumentMaster()))).message).toBe("CDN down");

    vi.useFakeTimers();
    const slow = harness(
      {
        downloadInstrumentMaster: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
        }),
      },
      { timeoutsMs: { downloadInstrumentMaster: 1_000 } },
    );
    const pending = failure(collect(slow.gateway.downloadInstrumentMaster()));
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).name).toBe("BrokerTimeoutError");
  });

  it("maps an adapter that throws before streaming", async () => {
    const { gateway } = harness({
      downloadInstrumentMaster: () => {
        throw new BrokerUnavailableError("no master today");
      },
    });
    expect((await failure(collect(gateway.downloadInstrumentMaster()))).message).toBe("no master today");
  });

  it("stops when the caller aborts or breaks out early", async () => {
    const controller = new AbortController();
    const { gateway } = harness({
      async *downloadInstrumentMaster() {
        yield* await Promise.resolve(INSTRUMENTS);
        controller.abort(new Error("job cancelled"));
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    });
    await expect(collect(gateway.downloadInstrumentMaster({ signal: controller.signal }))).rejects.toThrow(
      "job cancelled",
    );
    await expect(collect(gateway.downloadInstrumentMaster({ signal: controller.signal }))).rejects.toThrow(
      "job cancelled",
    );

    const fresh = harness();
    for await (const row of fresh.gateway.downloadInstrumentMaster({ creds: ACCOUNT.creds })) {
      expect(row.instrumentKey).toBe(NIFTY_CE);
      break;
    }
  });
});

describe("BrokerGateway feeds", () => {
  it("shares one market feed per broker and reconnects only after it closed", async () => {
    const connectMarketFeed = vi.fn(() => Promise.resolve(fakeFeed()));
    const { gateway } = harness({ connectMarketFeed });
    const [first, second] = await Promise.all([gateway.connectMarketFeed(ACCOUNT), gateway.connectMarketFeed(ACCOUNT)]);
    expect(first).toBe(second);
    expect(await gateway.connectMarketFeed({ ...ACCOUNT, accountId: "acc2" })).toBe(first);
    expect(connectMarketFeed).toHaveBeenCalledTimes(1);
    await first.close();
    const third = await gateway.connectMarketFeed(ACCOUNT);
    expect(third).not.toBe(first);
    expect(connectMarketFeed).toHaveBeenCalledTimes(2);
  });

  it("tries again after a failed connect", async () => {
    const connectMarketFeed = vi
      .fn<BrokerAdapter["connectMarketFeed"]>()
      .mockRejectedValueOnce(new BrokerUnavailableError("ws refused"))
      .mockResolvedValue(fakeFeed());
    const { gateway } = harness({ connectMarketFeed });
    const failed = gateway.connectMarketFeed(ACCOUNT);
    const waiting = gateway.connectMarketFeed(ACCOUNT);
    expect((await failure(failed)).code).toBe("BROKER_UNAVAILABLE");
    expect((await waiting).status).toBe("up");
    expect(await gateway.connectMarketFeed(ACCOUNT)).toBe(await waiting);

    const connectOrderFeed = vi
      .fn<BrokerAdapter["connectOrderFeed"]>()
      .mockRejectedValueOnce(new BrokerUnavailableError("ws refused"))
      .mockResolvedValue(fakeFeed());
    const orders = harness({ connectOrderFeed });
    await failure(orders.gateway.connectOrderFeed(ACCOUNT));
    expect((await orders.gateway.connectOrderFeed(ACCOUNT)).status).toBe("up");
  });

  it("keeps one order feed per broker, or per account when the broker requires it", async () => {
    const appScoped = harness();
    const shared = await appScoped.gateway.connectOrderFeed(ACCOUNT);
    expect(await appScoped.gateway.connectOrderFeed({ ...ACCOUNT, accountId: "acc2" })).toBe(shared);

    const adapter = stubAdapter();
    const perAccount = new BrokerGateway({
      adapter: { ...adapter, capabilities: { ...adapter.capabilities, orderFeedScope: "account" } },
      rateLimiter: new MemoryRateLimiter(),
    });
    const mine = await perAccount.connectOrderFeed(ACCOUNT);
    expect(await perAccount.connectOrderFeed(ACCOUNT)).toBe(mine);
    expect(await perAccount.connectOrderFeed({ ...ACCOUNT, accountId: "acc2" })).not.toBe(mine);
  });

  it("closes every feed on shutdown, including ones that never connected", async () => {
    const { gateway } = harness({ connectOrderFeed: () => Promise.reject(new BrokerUnavailableError("down")) });
    const market = await gateway.connectMarketFeed(ACCOUNT);
    const orders = gateway.connectOrderFeed(ACCOUNT).catch(() => undefined);
    await gateway.close();
    await orders;
    expect(market.status).toBe("closed");
    await gateway.close();
  });
});
