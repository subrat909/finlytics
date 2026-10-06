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
