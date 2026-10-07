import type { ExchangeStatus } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { formatCountdown, nextMarketEvent, phaseLabel } from "../lib/countdown";

const MON_0830_IST = Date.parse("2026-10-05T03:00:00.000Z");
const OPENS = "2026-10-05T03:45:00.000Z"; // 09:15 IST

function nse(phase: ExchangeStatus["phase"], extra: Partial<ExchangeStatus> = {}): ExchangeStatus {
  return { exchange: "NSE", phase, holiday: null, opensAt: null, closesAt: null, ...extra };
}

describe("nextMarketEvent", () => {
  it("counts down to pre-open, then to the open, for NSE", () => {
    expect(nextMarketEvent(nse("closed", { opensAt: OPENS }), MON_0830_IST)).toEqual({
      label: "Pre-open in",
      at: Date.parse("2026-10-05T03:30:00.000Z"),
    });
    expect(nextMarketEvent(nse("pre_open", { opensAt: OPENS }), MON_0830_IST)?.label).toBe("Opens in");
  });

  it("counts down to the close while open, and to 16:00 IST in post-close", () => {
    expect(nextMarketEvent(nse("open", { closesAt: "2026-10-05T10:00:00.000Z" }), MON_0830_IST)?.label).toBe(
      "Closes in",
    );
    const post = nextMarketEvent(nse("post_close"), Date.parse("2026-10-05T10:15:00.000Z"));
    expect(post).toEqual({ label: "Post-close ends in", at: Date.parse("2026-10-05T10:30:00.000Z") });
  });

  it("has no pre-open for MCX", () => {
    expect(nextMarketEvent({ ...nse("closed", { opensAt: OPENS }), exchange: "MCX" }, MON_0830_IST)?.label).toBe(
      "Opens in",
    );
  });
});

describe("formatCountdown and phaseLabel", () => {
  it("reads like a trading terminal", () => {
    expect(formatCountdown(158_400_000)).toBe("1d 20h");
    expect(formatCountdown(8_040_000)).toBe("2h 14m");
    expect(formatCountdown(372_000)).toBe("6m 12s");
    expect(formatCountdown(-5)).toBe("0s");
    expect(phaseLabel({ phase: "closed", holiday: "Diwali" })).toBe("Holiday");
    expect(phaseLabel({ phase: "open", holiday: null })).toBe("Market open");
  });
});
