import type { InstrumentKey } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import type { QuotesRepository } from "../quotes.repository";
import { QuotesService } from "../quotes.service";

const keys = ["NSE_EQ|INFY", "NSE_INDEX|NIFTY 50", "NSE_EQ|TCS"] as InstrumentKey[];

describe("QuotesService", () => {
  it("returns the quotes it has, leaving out keys without one or with a broken hash", async () => {
    const hashes = vi
      .fn<QuotesRepository["hashes"]>()
      .mockResolvedValue([
        { ltp: "1500.5", chg: "-2.5", chgPct: "-0.1663", ts: "1791273600000" },
        {},
        { ltp: "garbage", ts: "1" },
      ]);
    const service = new QuotesService({ hashes } as unknown as QuotesRepository);

    expect(await service.get({ keys })).toEqual({
      "NSE_EQ|INFY": { ltp: "1500.5", chg: "-2.5", chgPct: "-0.1663", ts: 1_791_273_600_000 },
    });
    expect(hashes).toHaveBeenCalledWith(keys);
  });

  it("fails when Redis fails (the filter answers 503)", async () => {
    const error = new Error("Connection is closed.");
    const service = new QuotesService({ hashes: () => Promise.reject(error) } as unknown as QuotesRepository);

    await expect(service.get({ keys })).rejects.toBe(error);
  });
});

describe("QuotesService.depth", () => {
  const key = "NSE_EQ|INFY" as InstrumentKey;
  const book = {
    k: key,
    t: 1_791_273_600_000,
    bids: [["1500.45", 120, 3]],
    asks: [["1500.5", 80, 0]],
    tbq: null,
    tsq: null,
  };
  const serviceWith = (stored: string | null, known = true) =>
    new QuotesService({
      depth: vi.fn(() => Promise.resolve(stored)),
      isActiveInstrument: vi.fn(() => Promise.resolve(known)),
    } as unknown as QuotesRepository);
  const empty = { k: key, t: 0, bids: [], asks: [], tbq: null, tsq: null };

  it("returns the stored book of the key", async () => {
    expect(await serviceWith(JSON.stringify(book)).depth({ key })).toEqual(book);
  });

  it("answers an empty book for a known instrument without a usable one", async () => {
    expect(await serviceWith(null).depth({ key })).toEqual(empty);
    expect(await serviceWith("{oops").depth({ key })).toEqual(empty);
    expect(await serviceWith(JSON.stringify({ ...book, k: "NSE_EQ|TCS" })).depth({ key })).toEqual(empty);
  });

  it("answers 404 for a key that names no active instrument", async () => {
    await expect(serviceWith(null, false).depth({ key })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
