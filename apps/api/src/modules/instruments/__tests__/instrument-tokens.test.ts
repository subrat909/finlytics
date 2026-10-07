import type { BrokerCode, InstrumentKey } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import type { BrokerGateways } from "../../brokers/broker-gateways";
import { DbUpstoxInstrumentResolver, InstrumentTokenCache } from "../instrument-tokens";
import type { InstrumentTokenRef, InstrumentTokenStore } from "../instrument-tokens";
import { InstrumentTokens, MarketGateways } from "../market-gateways";
import type { InstrumentTokensRepository } from "../instrument-tokens";

const INFY = "NSE_EQ|INFY" as InstrumentKey;
const TCS = "NSE_EQ|TCS" as InstrumentKey;
const NOPE = "NSE_EQ|NOPE" as InstrumentKey;

function ref(key: InstrumentKey, token: string): InstrumentTokenRef {
  return { instrumentKey: key, brokerToken: token, lotSize: 1, tickSize: "0.05", freezeQty: undefined };
}

/** A token store over two instruments, with its spies apart (so assertions never unbind a method). */
function store() {
  const byKeys = vi.fn((_broker: BrokerCode, keys: readonly InstrumentKey[]) =>
    Promise.resolve(
      keys.flatMap((key) =>
        key === INFY ? [ref(INFY, "NSE_EQ|INE009A01021"), ref(INFY, "OLD")] : key === TCS ? [ref(TCS, "TOK-TCS")] : [],
      ),
    ),
  );
  const byTokens = vi.fn((_broker: BrokerCode, tokens: readonly string[]) =>
    Promise.resolve(
      tokens.flatMap((token) =>
        token === "TOK-TCS"
          ? [{ token, instrumentKey: TCS }]
          : token === "BAD"
            ? [{ token, instrumentKey: "bad key" }]
            : [],
      ),
    ),
  );
  const hasAny = vi.fn((broker: BrokerCode) => Promise.resolve(broker === "UPSTOX"));
  const source: InstrumentTokenStore = { byKeys, byTokens, hasAny };
  return { source, byKeys, byTokens, hasAny };
}

describe("InstrumentTokenCache", () => {
  it("looks tokens up once, keeps the most recently seen token, and caches misses for a minute", async () => {
    let now = 0;
    const { source, byKeys, byTokens } = store();
    const cache = new InstrumentTokenCache(source, () => now);

    const found = await cache.tokensFor("UPSTOX", [INFY, NOPE, INFY]);
    expect([...found.keys()]).toEqual([INFY]);
    expect(found.get(INFY)?.brokerToken).toBe("NSE_EQ|INE009A01021");
    await cache.tokensFor("UPSTOX", [INFY, NOPE]);
    expect(byKeys).toHaveBeenCalledTimes(1);

    now = 61_000; // the miss expired, the hit didn't
    await cache.tokensFor("UPSTOX", [INFY, NOPE]);
    expect(byKeys).toHaveBeenCalledTimes(2);
    expect(byKeys).toHaveBeenLastCalledWith("UPSTOX", [NOPE]);

    // The reverse lookup knows tokens seen forward, and asks for the rest.
    expect(await cache.keysFor("UPSTOX", ["NSE_EQ|INE009A01021", "TOK-TCS", "BAD", "NONE"])).toEqual(
      new Map([
        ["NSE_EQ|INE009A01021", INFY],
        ["TOK-TCS", TCS],
      ]),
    );
    expect(byTokens).toHaveBeenCalledWith("UPSTOX", ["TOK-TCS", "BAD", "NONE"]);
    await cache.keysFor("UPSTOX", ["TOK-TCS", "NONE"]);
    expect(byTokens).toHaveBeenCalledTimes(1);
  });

  it("answers whether a broker has any token, cached for 30 s, and forgets everything on clear", async () => {
    let now = 0;
    const { source, byKeys, hasAny } = store();
    const cache = new InstrumentTokenCache(source, () => now);
    expect(await cache.hasAny("UPSTOX")).toBe(true);
    expect(await cache.hasAny("DHAN")).toBe(false);
    expect(await cache.hasAny("UPSTOX")).toBe(true);
    expect(hasAny).toHaveBeenCalledTimes(2);
    now = 31_000;
    await cache.hasAny("UPSTOX");
    expect(hasAny).toHaveBeenCalledTimes(3);

    await cache.tokensFor("UPSTOX", [TCS]);
    cache.clear();
    await cache.tokensFor("UPSTOX", [TCS]);
    expect(byKeys).toHaveBeenCalledTimes(2);
  });
});

describe("DbUpstoxInstrumentResolver", () => {
  it("answers Upstox refs and keys from the cache", async () => {
    const resolver = new DbUpstoxInstrumentResolver(new InstrumentTokenCache(store().source));
    expect(await resolver.byKeys([TCS, NOPE])).toEqual(
      new Map([
        [TCS, { instrumentKey: TCS, brokerToken: "TOK-TCS", lotSize: 1, tickSize: "0.05", freezeQty: undefined }],
      ]),
    );
    expect(await resolver.byTokens(["TOK-TCS"])).toEqual(new Map([["TOK-TCS", TCS]]));
  });
});

describe("MarketGateways", () => {
  function setup() {
    const { source, byKeys } = store();
    const tokens = new InstrumentTokens(source as unknown as InstrumentTokensRepository);
    const prepare = vi.fn(() => Promise.resolve());
    const gateways = {
      has: (broker: BrokerCode) => broker !== "ZERODHA",
      gateway: (broker: BrokerCode) => ({ broker }),
      prepare,
    };
    const market = new MarketGateways(gateways as unknown as BrokerGateways, tokens);
    return { byKeys, tokens, prepare, market };
  }

  it("maps keys to those with a token, readying the adapter's map; paper streams anything", async () => {
    const { market, prepare } = setup();
    expect(await market.mapKeys("DHAN", [INFY, NOPE])).toEqual(new Set([INFY]));
    expect(prepare).toHaveBeenCalledWith("DHAN");
    expect(await market.mapKeys("PAPER", [NOPE])).toEqual(new Set([NOPE]));
    expect(market.has("UPSTOX")).toBe(true);
    expect(market.gateway("UPSTOX")).toEqual({ broker: "UPSTOX" });
    expect(await market.hasInstruments("PAPER")).toBe(true);
    expect(await market.hasInstruments("DHAN")).toBe(false);
  });

  it("forgets cached tokens when an instrument master synced", async () => {
    const { market, byKeys, tokens } = setup();
    await market.mapKeys("UPSTOX", [NOPE]);
    tokens.onInstrumentsSynced();
    await market.mapKeys("UPSTOX", [NOPE]);
    expect(byKeys).toHaveBeenCalledTimes(2);
  });
});
