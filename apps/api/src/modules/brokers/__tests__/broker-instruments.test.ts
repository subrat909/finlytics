import { MemoryRateLimiter } from "@finlytics/broker-sdk";
import type { BrokerLogger, UpstoxInstrumentRef } from "@finlytics/broker-sdk";
import type { BrokerCode, InstrumentKey } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import { fakeRegistry } from "../../../../test/support/fake-broker";
import { adapterOptions, BrokerGateways } from "../broker-gateways";
import { BrokerInstrumentMaps, NO_INSTRUMENT_SOURCE, TOKEN_PAGE_SIZE } from "../broker-instruments";
import type { BrokerInstrumentSource, BrokerTokenRow } from "../broker-instruments";

import { logger, SCRIPTS } from "./support";

const key = (text: string) => text as InstrumentKey;
const HDFC = key("NSE_EQ|HDFCBANK");
const NIFTY_CE = key("NSE_FO|NIFTY|2026-10-27|25000|CE");

function brokerLogger() {
  return { debug: vi.fn(), warn: vi.fn() } satisfies BrokerLogger;
}

/** A source over fixed rows per broker, recording its calls. */
function source(rows: Partial<Record<BrokerCode, BrokerTokenRow[]>>, refs: UpstoxInstrumentRef[] = []) {
  const fake = {
    tokens: vi.fn((broker: BrokerCode, after: string, pageSize: number) =>
      Promise.resolve(
        (rows[broker] ?? [])
          .filter((row) => row.brokerToken > after)
          .sort((a, b) => a.brokerToken.localeCompare(b.brokerToken))
          .slice(0, pageSize),
      ),
    ),
    refsByKeys: vi.fn((_broker: BrokerCode, keys: readonly InstrumentKey[]) =>
      Promise.resolve(refs.filter((ref) => keys.includes(ref.instrumentKey))),
    ),
    keysByTokens: vi.fn((broker: BrokerCode, tokens: readonly string[]) =>
      Promise.resolve((rows[broker] ?? []).filter((row) => tokens.includes(row.brokerToken))),
    ),
  };
  return fake satisfies BrokerInstrumentSource;
}

describe("BrokerInstrumentMaps: Dhan", () => {
  it("loads Dhan's map once, on first use, in pages", async () => {
    const many = Array.from({ length: TOKEN_PAGE_SIZE + 1 }, (_, index) => ({
      instrumentKey: `NSE_EQ|S${String(index)}`,
      brokerToken: `NSE_EQ:${String(100_000 + index)}`,
    }));
    const rows = source({ DHAN: [...many, { instrumentKey: HDFC, brokerToken: "NSE_EQ:1333" }] });
    const maps = new BrokerInstrumentMaps(rows, brokerLogger());

    await Promise.all([maps.prepare("DHAN"), maps.prepare("DHAN")]);
    await maps.prepare("UPSTOX");

    expect(maps.dhan.keyOf("NSE_EQ", "1333")).toBe(HDFC);
    expect(maps.dhan.get(HDFC)?.securityId).toBe("1333");
    expect(maps.dhan.size).toBe(TOKEN_PAGE_SIZE + 2);
    expect(rows.tokens).toHaveBeenCalledTimes(2);
  });

  it("logs a failed load and tries again on the next use", async () => {
    const rows = source({ DHAN: [{ instrumentKey: HDFC, brokerToken: "NSE_EQ:1333" }] });
    rows.tokens.mockRejectedValueOnce(new Error("database down"));
    const log = brokerLogger();
    const maps = new BrokerInstrumentMaps(rows, log);

    await maps.prepare("DHAN");
    expect(maps.dhan.size).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ broker: "DHAN" }),
      "broker instrument map not loaded",
    );

    await maps.prepare("DHAN");
    expect(maps.dhan.keyOf("NSE_EQ", "1333")).toBe(HDFC);
  });

  it("loads Dhan's map again after a sync, and forgets Upstox's lookups", async () => {
    const dhanRows: BrokerTokenRow[] = [{ instrumentKey: HDFC, brokerToken: "NSE_EQ:1333" }];
    const upstoxRows: BrokerTokenRow[] = [{ instrumentKey: NIFTY_CE, brokerToken: "NSE_FO|52618" }];
    const rows = source({ DHAN: dhanRows, UPSTOX: upstoxRows });
    const maps = new BrokerInstrumentMaps(rows, brokerLogger());
    await maps.prepare("DHAN");
    await maps.upstox.byTokens(["NSE_FO|52618"]);

    dhanRows.push({ instrumentKey: NIFTY_CE, brokerToken: "NSE_FNO:52618" });
    await maps.reload("DHAN");
    await maps.reload("UPSTOX");
    await maps.reload("PAPER");
    await maps.upstox.byTokens(["NSE_FO|52618"]);

    expect(maps.dhan.keyOf("NSE_FNO", "52618")).toBe(NIFTY_CE);
    expect(rows.keysByTokens).toHaveBeenCalledTimes(2);
  });
});

describe("BrokerInstrumentMaps: Upstox", () => {
  const ref = (instrumentKey: InstrumentKey, brokerToken: string): UpstoxInstrumentRef => ({
    instrumentKey,
    brokerToken,
    lotSize: 75,
    tickSize: "0.05",
    freezeQty: 1800,
  });

  it("resolves keys and tokens from the table and caches what it found", async () => {
    const rows = source({ UPSTOX: [{ instrumentKey: NIFTY_CE, brokerToken: "NSE_FO|52618" }] }, [
      ref(NIFTY_CE, "NSE_FO|52618"),
      ref(NIFTY_CE, "NSE_FO|11111"), // an older token of the same key: the first (most recent) wins
    ]);
    const maps = new BrokerInstrumentMaps(rows, brokerLogger());

    expect(await maps.upstox.byKeys([NIFTY_CE, HDFC])).toEqual(new Map([[NIFTY_CE, ref(NIFTY_CE, "NSE_FO|52618")]]));
    expect(await maps.upstox.byKeys([NIFTY_CE])).toEqual(new Map([[NIFTY_CE, ref(NIFTY_CE, "NSE_FO|52618")]]));
    expect(await maps.upstox.byTokens(["NSE_FO|52618", "NSE_EQ|INE000000000"])).toEqual(
      new Map([["NSE_FO|52618", NIFTY_CE]]),
    );
    expect(rows.refsByKeys).toHaveBeenCalledTimes(1);
    expect(rows.keysByTokens).toHaveBeenCalledTimes(1);
    expect(rows.keysByTokens.mock.calls[0]?.[1]).toEqual(["NSE_EQ|INE000000000"]);
  });

  it("ignores a row whose key isn't canonical", async () => {
    const maps = new BrokerInstrumentMaps(
      source({ UPSTOX: [{ instrumentKey: "not a key", brokerToken: "NSE_EQ|X" }] }),
      brokerLogger(),
    );

    expect(await maps.upstox.byTokens(["NSE_EQ|X"])).toEqual(new Map());
  });

  it("has nothing without a source", async () => {
    const maps = new BrokerInstrumentMaps(NO_INSTRUMENT_SOURCE, brokerLogger());
    await maps.prepare("DHAN");

    expect(maps.dhan.size).toBe(0);
    expect(await maps.upstox.byKeys([HDFC])).toEqual(new Map());
    expect(await maps.upstox.byTokens(["x"])).toEqual(new Map());
  });
});

describe("BrokerGateways and the instrument maps", () => {
  it("gives Upstox the resolver (with the user's app) and Dhan the map", () => {
    const maps = new BrokerInstrumentMaps(NO_INSTRUMENT_SOURCE, brokerLogger());

    expect(adapterOptions("DHAN", undefined, maps)).toEqual({ instruments: maps.dhan });
    const upstox = adapterOptions("UPSTOX", { apiKey: "k", apiSecret: "s" }, maps) as {
      instruments: unknown;
      appCredentials: { apiKey: { reveal(): string } };
    };
    expect(upstox.instruments).toBe(maps.upstox);
    expect(upstox.appCredentials.apiKey.reveal()).toBe("k");
    expect(adapterOptions("UPSTOX")).toEqual({});
    expect(adapterOptions("ZERODHA", { apiKey: "k", apiSecret: "s" })).toHaveProperty("appCredentials");
    expect(adapterOptions("ZERODHA")).toEqual({});
  });

  it("prepares Dhan's map, and reloads it on instruments.synced", async () => {
    const rows = source({ DHAN: [{ instrumentKey: HDFC, brokerToken: "NSE_EQ:1333" }] });
    const gateways = new BrokerGateways(fakeRegistry(SCRIPTS).registry, new MemoryRateLimiter(), logger(), rows);

    await gateways.prepare("DHAN");
    await gateways.onInstrumentsSynced({ broker: "DHAN", rows: 1 });
    await gateways.onInstrumentsSynced({ broker: "NOPE" });
    await gateways.onInstrumentsSynced(null);

    expect(rows.tokens).toHaveBeenCalledTimes(2);
    await gateways.onApplicationShutdown();
  });
});
