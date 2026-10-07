import { MARKET_INDEX_KEYS, parseInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey, ParsedInstrumentKey } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { MARKET_INDEX_ALIASES } from "../../../index-aliases";
import { InstrumentRowSchema } from "../../../models";
import {
  csvRecords,
  decodeUtf8,
  dhanBrokerToken,
  dhanDate,
  dhanInstrumentFor,
  DhanInstrumentMap,
  dhanMarketIndex,
  dhanMasterRow,
  dhanSegmentForToken,
  parseCsv,
  segmentFromCode,
  tokenForDhanSegment,
} from "../instruments";

import { fixtureText } from "./fake-dhan";

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield await Promise.resolve(part);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function parsed(key: string): ParsedInstrumentKey {
  const result = parseInstrumentKey(key);
  if (!result.ok) throw new Error(key);
  return result.value;
}

describe("parseCsv", () => {
  it("splits records on LF, CR and CRLF and skips empty lines", async () => {
    expect(await collect(parseCsv(chunks("a,b\r\nc,d\n\ne,f\rg,h")))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("reads quoted fields with commas, escaped quotes and newlines, also across chunk boundaries", async () => {
    const records = await collect(parseCsv(chunks('x,"a, ""b', '"",c"\n"line\none",', "", "\r", "\nlast,")));
    expect(records).toEqual([
      ["x", 'a, "b",c'],
      ["line\none", ""],
      ["last", ""],
    ]);
  });

  it("keeps empty quoted fields and a final record without a newline", async () => {
    expect(await collect(parseCsv(chunks('"",x\n1,2')))).toEqual([
      ["", "x"],
      ["1", "2"],
    ]);
    expect(await collect(parseCsv(chunks("")))).toEqual([]);
  });
});

describe("csvRecords and decodeUtf8", () => {
  it("maps cells to upper-cased header names and decodes UTF-8 split across chunks", async () => {
    const bytes = new TextEncoder().encode("﻿exch_id, name\nNSE,Ré\n");
    async function* body(): AsyncGenerator<Uint8Array> {
      yield await Promise.resolve(bytes.slice(0, 18));
      yield bytes.slice(18);
    }
    expect(await collect(csvRecords(decodeUtf8(body())))).toEqual([{ EXCH_ID: "NSE", NAME: "Ré" }]);
  });

  it("fills missing cells with empty strings", async () => {
    expect(await collect(csvRecords(chunks("A,B\n1\n")))).toEqual([{ A: "1", B: "" }]);
  });
});

describe("dhanMasterRow", () => {
  const masterRows = async (options?: Parameters<typeof dhanMasterRow>[1]) =>
    (await collect(csvRecords(chunks(fixtureText("scrip-master.csv"))))).map((record) =>
      dhanMasterRow(record, options),
    );

  it("maps the fixture to canonical, valid rows and skips what the platform doesn't trade", async () => {
    const rows = (await masterRows({ freezeQuantities: { NIFTY: 1800 } })).filter((row) => row !== undefined);
    for (const { row } of rows) expect(InstrumentRowSchema.safeParse(row).success, row.instrumentKey).toBe(true);
    expect(rows.map(({ row }) => row.instrumentKey)).toEqual([
      "NSE_INDEX|NIFTY 50",
      "BSE_INDEX|SENSEX",
      "NSE_EQ|HDFCBANK",
      "NSE_EQ|HDFCBANK", // the BE-series duplicate: the adapter keeps only the first
      "NSE_EQ|BAJAJ-AUTO",
      "NSE_FO|NIFTY|2025-10-30|24000|CE",
      "NSE_FO|NIFTY|2025-10-30|24000|PE",
      "NSE_FO|NIFTY|2025-10-28",
      "MCX_FO|GOLD|2025-12-05",
      "NSE_CD|USDINR|2025-10-29|83.25|CE",
    ]);
    const option = rows.find(({ row }) => row.optionType === "CE" && row.exchange === "NFO");
    expect(option).toEqual({
      row: {
        instrumentKey: "NSE_FO|NIFTY|2025-10-30|24000|CE",
        brokerToken: "NSE_FNO:52175",
        exchange: "NFO",
        segment: "OPT",
        tradingSymbol: "NIFTY-Oct2025-24000-CE",
        name: "NIFTY 30 OCT 24000 CALL",
        expiry: "2025-10-30",
        strike: "24000",
        optionType: "CE",
        lotSize: 75,
        tickSize: "0.05",
        freezeQty: 1800,
      },
      ref: { exchangeSegment: "NSE_FNO", securityId: "52175", instrument: "OPTIDX" },
    });
    const equity = rows.find(({ row }) => row.instrumentKey === "NSE_EQ|BAJAJ-AUTO")?.row;
    expect(equity).toMatchObject({ name: 'Bajaj Auto, "Ltd"', isin: "INE917I01010", tickSize: "0.5", lotSize: 1 });
    expect(rows.find(({ row }) => row.instrumentKey === "MCX_FO|GOLD|2025-12-05")?.row.tickSize).toBe("1");
    expect(rows.find(({ row }) => row.segment === "OPT" && row.exchange === "CDS")?.row.tickSize).toBe("0.0025");
    // An index with a zero tick size gets the default.
    expect(rows.find(({ row }) => row.instrumentKey === "BSE_INDEX|SENSEX")?.row.tickSize).toBe("0.05");
  });

  it("reads tick sizes in rupees when told to", async () => {
    const rows = (await masterRows({ tickSizeUnit: "rupee" })).filter((row) => row !== undefined);
    expect(rows.find(({ row }) => row.instrumentKey === "NSE_EQ|HDFCBANK")?.row.tickSize).toBe("5");
  });

  it("reads the compact file's column names and derives the underlying from the trading symbol", () => {
    const mapped = dhanMasterRow({
      SEM_EXM_EXCH_ID: "BSE",
      SEM_SEGMENT: "D",
      SEM_SMST_SECURITY_ID: "1150001",
      SEM_INSTRUMENT_NAME: "OPTIDX",
      SEM_TRADING_SYMBOL: "SENSEX-Oct2025-82000-PE",
      SEM_LOT_UNITS: "20.0",
      SEM_CUSTOM_SYMBOL: "SENSEX 30 OCT 82000 PUT",
      SEM_EXPIRY_DATE: "30-10-2025",
      SEM_STRIKE_PRICE: "82000.00000",
      SEM_OPTION_TYPE: "PE",
      SEM_TICK_SIZE: "5.0000",
    });
    expect(mapped?.row).toMatchObject({
      instrumentKey: "BSE_FO|SENSEX|2025-10-30|82000|PE",
      brokerToken: "BSE_FNO:1150001",
      lotSize: 20,
    });
    expect(mapped?.ref.instrument).toBe("OPTIDX");
  });

  it("skips rows with an unknown segment, exchange or a missing security id", () => {
    const base = { EXCH_ID: "NSE", SEGMENT: "E", SECURITY_ID: "1", INSTRUMENT: "EQUITY", UNDERLYING_SYMBOL: "ABC" };
    expect(dhanMasterRow(base)?.row.instrumentKey).toBe("NSE_EQ|ABC");
    expect(dhanMasterRow({ ...base, SECURITY_ID: "" })).toBeUndefined();
    expect(dhanMasterRow({ ...base, SEGMENT: "D" })).toBeUndefined();
    expect(dhanMasterRow({ ...base, EXCH_ID: "MCX" })).toBeUndefined();
    expect(dhanMasterRow({ ...base, INSTRUMENT: "INDEX", EXCH_ID: "MCX" })).toBeUndefined();
    expect(
      dhanMasterRow({ ...base, INSTRUMENT: "FUTSTK", SEGMENT: "X", SM_EXPIRY_DATE: "2025-10-28" }),
    ).toBeUndefined();
    expect(dhanMasterRow({ ...base, INSTRUMENT: "FUTCOM", EXCH_ID: "MCX", SEGMENT: "D" })).toBeUndefined();
    expect(dhanMasterRow({ ...base, INSTRUMENT: "FUTSTK", EXCH_ID: "XYZ", SEGMENT: "D" })).toBeUndefined();
    expect(
      dhanMasterRow({ ...base, INSTRUMENT: "OPTSTK", SEGMENT: "D", SM_EXPIRY_DATE: "2025-10-28" }),
    ).toBeUndefined();
  });

  it("falls back to the symbol for the trading symbol and name, and to lot size 1", () => {
    const row = dhanMasterRow({
      EXCH_ID: "NSE",
      SEGMENT: "E",
      SECURITY_ID: "7",
      INSTRUMENT: "EQUITY",
      UNDERLYING_SYMBOL: "XYZ",
      LOT_SIZE: "NA",
    })?.row;
    expect(row).toMatchObject({ tradingSymbol: "XYZ", name: "XYZ", lotSize: 1, tickSize: "0.05" });
    expect(row?.isin).toBeUndefined();
  });
});

describe("dhanMasterRow: market indices and NIFTY 50 stocks", () => {
  const mapped = async (): Promise<NonNullable<ReturnType<typeof dhanMasterRow>>[]> =>
    (await collect(csvRecords(chunks(fixtureText("scrip-master-indices.csv"))))).flatMap((record) => {
      const row = dhanMasterRow(record);
      return row === undefined ? [] : [row];
    });

  it("produces exactly the pinned market index keys, with the seed's trading symbol and name", async () => {
    const rows = await mapped();
    for (const { row } of rows) expect(InstrumentRowSchema.safeParse(row).success, row.instrumentKey).toBe(true);
    const pinned = rows.filter(({ row }) => MARKET_INDEX_ALIASES.some((alias) => alias.key === row.instrumentKey));
    expect(pinned.map(({ row }) => row.instrumentKey)).toEqual(Object.values(MARKET_INDEX_KEYS));
    expect(pinned.map(({ row }) => [row.brokerToken, row.tradingSymbol, row.name])).toEqual([
      ["IDX_I:13", "NIFTY 50", "Nifty 50"],
      ["IDX_I:25", "NIFTY BANK", "Nifty Bank"],
      ["IDX_I:27", "NIFTY FIN SERVICE", "Nifty Financial Services"],
      ["IDX_I:442", "NIFTY MID SELECT", "Nifty Midcap Select"],
      ["IDX_I:38", "NIFTY NEXT 50", "Nifty Next 50"],
      ["IDX_I:29", "NIFTY IT", "Nifty IT"],
      ["IDX_I:21", "INDIA VIX", "India VIX"],
      ["IDX_I:51", "SENSEX", "BSE Sensex"],
      ["IDX_I:69", "BANKEX", "BSE Bankex"],
    ]);
    expect(pinned.map(({ ref }) => ref.instrument)).toEqual(Array.from({ length: 9 }, () => "INDEX"));
  });

  it("keeps other indices under their own symbol, including one spelled like a pinned index under another id", async () => {
    const keys = (await mapped()).map(({ row }) => row.instrumentKey);
    expect(keys).toEqual(expect.arrayContaining(["NSE_INDEX|NIFTY50", "NSE_INDEX|NIFTYAUTO", "BSE_INDEX|SENSEX50"]));
    expect(keys.filter((key) => key === "NSE_INDEX|NIFTY 50")).toHaveLength(1);
  });

  it("keys equities by the exchange symbol, never the company name, like the dev seed", async () => {
    const equities = (await mapped()).filter(({ row }) => row.segment === "EQ").map(({ row }) => row);
    expect(equities.map((row) => [row.instrumentKey, row.tradingSymbol, row.name])).toEqual([
      ["NSE_EQ|RELIANCE", "RELIANCE", "Reliance Industries"],
      ["NSE_EQ|M&M", "M&M", "Mahindra & Mahindra"],
      ["NSE_EQ|BAJAJ-AUTO", "BAJAJ-AUTO", "Bajaj Auto"],
    ]);
    // The compact file: SEM_TRADING_SYMBOL, and SM_SYMBOL_NAME only when it is one word.
    const compact = (symbol: string, name: string) =>
      dhanMasterRow({
        SEM_EXM_EXCH_ID: "NSE",
        SEM_SEGMENT: "E",
        SEM_SMST_SECURITY_ID: "2885",
        SEM_INSTRUMENT_NAME: "EQUITY",
        SEM_TRADING_SYMBOL: symbol,
        SEM_CUSTOM_SYMBOL: "Reliance Industries",
        SM_SYMBOL_NAME: name,
      })?.row.instrumentKey;
    expect(compact("RELIANCE", "RELIANCE INDUSTRIES LTD")).toBe("NSE_EQ|RELIANCE");
    expect(compact("", "RELIANCE")).toBe("NSE_EQ|RELIANCE");
    expect(compact("", "RELIANCE INDUSTRIES LTD")).toBeUndefined();
  });

  it("trusts Dhan's fixed security ids only on their own exchange", () => {
    expect(dhanMarketIndex("NSE_INDEX", "13", [])?.key).toBe("NSE_INDEX|NIFTY 50");
    expect(dhanMarketIndex("NSE_INDEX", "51", ["SENSEX"])).toBeUndefined();
    expect(dhanMarketIndex("NSE_INDEX", "7", ["Nifty  next 50 "])?.key).toBe("NSE_INDEX|NIFTY NEXT 50");
    expect(dhanMarketIndex("NSE_INDEX", "7", ["BANKNIFTY"])).toBeUndefined();
    expect(dhanMarketIndex("NSE_INDEX", "7", ["NIFTY AUTO"])).toBeUndefined();
  });
});

describe("DhanInstrumentMap", () => {
  it("maps both ways and replaces an entry's old token", () => {
    const map = new DhanInstrumentMap();
    const key = "NSE_EQ|ABC" as InstrumentKey;
    map.set(key, { exchangeSegment: "NSE_EQ", securityId: "1", instrument: "EQUITY" });
    map.set(key, { exchangeSegment: "NSE_EQ", securityId: "2", instrument: "EQUITY" });
    expect(map.size).toBe(1);
    expect(map.keyOf("NSE_EQ", "1")).toBeUndefined();
    expect(map.keyOf("NSE_EQ", "2")).toBe(key);
    expect(map.get(key)?.securityId).toBe("2");
  });

  it("loads (key, token) pairs and skips malformed ones", () => {
    const map = new DhanInstrumentMap();
    const added = map.load([
      { instrumentKey: "NSE_FO|NIFTY|2025-10-30|24000|CE", brokerToken: "NSE_FNO:52175" },
      { instrumentKey: "MCX_FO|GOLD|2025-12-05", brokerToken: "MCX_COMM:440000" },
      { instrumentKey: "not a key", brokerToken: "NSE_EQ:1" },
      { instrumentKey: "NSE_EQ|ABC", brokerToken: "1333" },
      { instrumentKey: "NSE_EQ|ABC", brokerToken: "NOPE:1" },
      { instrumentKey: "NSE_EQ|ABC", brokerToken: "NSE_EQ:abc" },
    ]);
    expect(added).toBe(2);
    expect(map.get("NSE_FO|NIFTY|2025-10-30|24000|CE" as InstrumentKey)?.instrument).toBe("OPTIDX");
    expect(map.get("MCX_FO|GOLD|2025-12-05" as InstrumentKey)?.instrument).toBe("FUTCOM");
  });
});

describe("instrument helpers", () => {
  it.each([
    ["NSE_INDEX|NIFTY 50", "INDEX"],
    ["NSE_EQ|TCS", "EQUITY"],
    ["NSE_FO|NIFTY|2025-10-28", "FUTIDX"],
    ["NSE_FO|TCS|2025-10-28", "FUTSTK"],
    ["BSE_FO|SENSEX|2025-10-30|82000|CE", "OPTIDX"],
    ["NSE_FO|TCS|2025-10-28|3000|PE", "OPTSTK"],
    ["MCX_FO|GOLD|2025-12-05", "FUTCOM"],
    ["MCX_FO|GOLD|2025-12-05|120000|CE", "OPTFUT"],
    ["NSE_CD|USDINR|2025-10-29", "FUTCUR"],
    ["NSE_CD|USDINR|2025-10-29|83.25|CE", "OPTCUR"],
  ])("%s is a Dhan %s", (key, instrument) => {
    expect(dhanInstrumentFor(parsed(key))).toBe(instrument);
  });

  it("converts segments, codes, tokens and dates", () => {
    expect(segmentFromCode(2)).toBe("NSE_FNO");
    expect(segmentFromCode(6)).toBeUndefined();
    expect(dhanSegmentForToken("BSE_INDEX")).toBe("IDX_I");
    expect(tokenForDhanSegment("MCX_COMM")).toBe("MCX_FO");
    expect(tokenForDhanSegment("IDX_I")).toBeUndefined();
    expect(dhanBrokerToken("NSE_EQ", "1333")).toBe("NSE_EQ:1333");
    expect(dhanDate("2025-10-30 14:30:00")).toBe("2025-10-30");
    expect(dhanDate("30/10/2025")).toBe("2025-10-30");
    expect(dhanDate("0001-01-01")).toBeUndefined();
    expect(dhanDate("NA")).toBeUndefined();
    expect(dhanDate(null)).toBeUndefined();
    expect(dhanDate(undefined)).toBeUndefined();
  });
});
