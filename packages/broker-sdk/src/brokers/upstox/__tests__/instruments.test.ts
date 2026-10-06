import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import { isBrokerError } from "../../../errors";
import { jsonArrayObjects, UpstoxInstrumentMap, upstoxInstrumentRows } from "../instruments";
import { MARKET_DATA_FEED_V3_PROTO, decodeUpstoxFeedResponse } from "../proto";
import { upstoxFeedResponseType } from "../proto";

import { fixture, fixtureBytes, fixtureText } from "./fake-upstox";
import { fixtureRows, NIFTY_CE, NIFTY_CE_TOKEN } from "./setup";

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield await Promise.resolve(part);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

/** A body that delivers `bytes` in pieces of `size` (the first piece `first` bytes long). */
function body(bytes: Uint8Array, size: number, first = size, onCancel?: () => void): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        // With onCancel: a download still in flight (never ends), so stopping early must cancel it.
        if (onCancel === undefined) controller.close();
        return onCancel === undefined ? undefined : new Promise<void>(() => undefined);
      }
      const end = offset + (offset === 0 ? first : size);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
      return undefined;
    },
    cancel() {
      onCancel?.();
    },
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("jsonArrayObjects", () => {
  it("yields each top-level object across chunk boundaries, skipping strings and nested values", async () => {
    const objects = await collect(
      jsonArrayObjects(chunks('﻿ \n[{"a":"x}\\"', ']","n":{"m":[1,{"k":2}]}},', ' 3, {"b":"\\\\"} ,{"c":[]}', "]\n")),
    );
    expect(objects.map((text) => JSON.parse(text) as unknown)).toEqual([
      { a: 'x}"]', n: { m: [1, { k: 2 }] } },
      { b: "\\" },
      { c: [] },
    ]);
  });

  it("yields nothing for an empty array", async () => {
    expect(await collect(jsonArrayObjects(chunks("[", "]")))).toEqual([]);
  });

  it.each([
    ["is not an array", ['{"a":1}']],
    ["ends early", ['[{"a":1},{"b":']],
    ["is empty", []],
  ])("fails when the text %s", async (_name, parts) => {
    const error = await rejection(collect(jsonArrayObjects(chunks(...parts))));
    expect(isBrokerError(error) && error.code).toBe("BROKER_UNAVAILABLE");
  });
});

describe("upstoxInstrumentRows", () => {
  const signal = new AbortController().signal;

  it("streams canonical rows from the gzipped master, deduplicated, whatever the chunking", async () => {
    const gz = gzipSync(fixtureText("instruments.json"));
    const expected = fixtureRows();
    expect(await collect(upstoxInstrumentRows(body(gz, 7, 1), signal))).toEqual(expected);
    expect(await collect(upstoxInstrumentRows(body(gz, 4096), signal))).toEqual(expected);
  });

  it("reads a master that arrives already decoded (Content-Encoding: gzip)", async () => {
    const plain = new TextEncoder().encode(fixtureText("instruments.json"));
    expect(await collect(upstoxInstrumentRows(body(plain, 1000), signal))).toHaveLength(fixtureRows().length);
  });

  it("skips objects that are not valid JSON", async () => {
    const text = '[{"segment": bad}, {"segment":"BSE_INDEX","instrument_key":"BSE_INDEX|SENSEX"}]';
    const rows = await collect(upstoxInstrumentRows(body(new TextEncoder().encode(text), 5), signal));
    expect(rows.map((row) => row.instrumentKey)).toEqual(["BSE_INDEX|SENSEX"]);
  });

  it("stops when the signal aborts, and when the consumer stops early", async () => {
    const controller = new AbortController();
    const gz = gzipSync(fixtureText("instruments.json"));
    const rows: string[] = [];
    const error = await rejection(
      (async () => {
        for await (const row of upstoxInstrumentRows(body(gz, 64), controller.signal)) {
          rows.push(row.instrumentKey);
          controller.abort(new Error("stop"));
        }
      })(),
    );
    expect(rows).toHaveLength(1);
    expect(error).toEqual(new Error("stop"));
    let cancelled = false;
    const source = body(gz, 64, 64, () => {
      cancelled = true;
    });
    for await (const row of upstoxInstrumentRows(source, signal)) {
      expect(row.instrumentKey).toBe("NSE_EQ|JOCIL");
      break;
    }
    await vi.waitFor(() => {
      expect(cancelled).toBe(true);
    });
  });
});

describe("UpstoxInstrumentMap", () => {
  it("looks instruments up both ways, and replaces a key's token", async () => {
    const map = new UpstoxInstrumentMap(fixtureRows());
    expect(map.size).toBe(fixtureRows().length);
    const other = "NSE_EQ|OTHER" as InstrumentKey;
    expect([...(await map.byKeys([NIFTY_CE, other])).keys()]).toEqual([NIFTY_CE]);
    expect(await map.byTokens([NIFTY_CE_TOKEN, "NSE_FO|0"])).toEqual(new Map([[NIFTY_CE_TOKEN, NIFTY_CE]]));

    map.add([{ instrumentKey: NIFTY_CE, brokerToken: "NSE_FO|99999" }]);
    expect((await map.byKeys([NIFTY_CE])).get(NIFTY_CE)?.brokerToken).toBe("NSE_FO|99999");
    expect((await map.byTokens([NIFTY_CE_TOKEN])).size).toBe(0);
    expect(new UpstoxInstrumentMap().size).toBe(0);
  });
});

describe("MarketDataFeedV3 proto", () => {
  it("ships the .proto file's exact text", () => {
    const file = readFileSync(new URL("../MarketDataFeedV3.proto", import.meta.url), "utf8");
    expect(MARKET_DATA_FEED_V3_PROTO).toBe(file);
    expect(upstoxFeedResponseType()).toBe(upstoxFeedResponseType());
  });

  it.each(["feed-ltpc", "feed-full", "feed-option-greeks", "feed-market-info"])(
    "decodes the binary %s fixture to its documented JSON",
    (name) => {
      const decoded = decodeUpstoxFeedResponse(fixtureBytes(`${name}.bin`));
      const type = upstoxFeedResponseType();
      const expected = type.toObject(type.fromObject(fixture(`${name}.json`) as Record<string, unknown>), {
        longs: Number,
        enums: String,
      });
      expect(decoded).toEqual(expected);
    },
  );

  it("throws on bytes that are not a FeedResponse", () => {
    expect(() => decodeUpstoxFeedResponse(new Uint8Array([0x0a, 0xff, 0xff, 0xff]))).toThrow();
  });
});
