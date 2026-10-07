import type { Instrument } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import {
  accessibleName,
  contractOf,
  describeInstrument,
  displaySymbol,
  formatStrike,
  isDerivative,
  longExpiry,
  searchDetail,
  secondaryLabel,
  shortExpiry,
} from "../lib/describe";

const RELIANCE: Instrument = {
  key: "NSE_EQ|RELIANCE",
  exchange: "NSE",
  segment: "EQ",
  symbol: "RELIANCE",
  tradingSymbol: "RELIANCE",
  name: "Reliance Industries Ltd",
  expiry: null,
  strike: null,
  optionType: null,
  lotSize: 1,
  tickSize: "0.05",
  isActive: true,
};
const NIFTY_CE: Instrument = {
  ...RELIANCE,
  key: "NSE_FO|NIFTY|2025-10-30|24000|CE",
  exchange: "NFO",
  segment: "OPT",
  symbol: "NIFTY",
  name: "NIFTY",
  expiry: "2025-10-30",
  strike: "24000.00",
  optionType: "PE",
  lotSize: 75,
};
const NIFTY_FUT: Instrument = { ...NIFTY_CE, segment: "FUT", strike: null, optionType: null };

describe("instrument display", () => {
  it("writes expiries and strikes the way traders read them", () => {
    expect(shortExpiry("2025-10-30")).toBe("30 Oct 25");
    expect(longExpiry("2026-01-02")).toBe("2 Jan 2026");
    expect(formatStrike("24000.00")).toBe("24000");
    expect(formatStrike("82.50")).toBe("82.5");
    expect(formatStrike("24000")).toBe("24000");
  });

  it("names the F&O contract after the symbol", () => {
    expect(isDerivative(RELIANCE)).toBe(false);
    expect(contractOf(RELIANCE)).toBe("");
    expect(contractOf(NIFTY_CE)).toBe("24000 PE");
    expect(contractOf(NIFTY_FUT)).toBe("FUT");
    expect(displaySymbol(NIFTY_CE)).toBe("NIFTY 24000 PE");
    expect(displaySymbol(RELIANCE)).toBe("RELIANCE");
  });

  it("describes rows, search results and screen-reader names", () => {
    expect(secondaryLabel(RELIANCE)).toBe("Reliance Industries Ltd");
    expect(secondaryLabel(NIFTY_CE)).toBe("30 Oct 25");
    expect(searchDetail(NIFTY_FUT)).toBe("Expiry 30 Oct 2025 · Lot 75");
    expect(searchDetail({ ...NIFTY_FUT, expiry: null })).toBe("Lot 75");
    expect(describeInstrument(RELIANCE)).toBe("NSE · Reliance Industries Ltd");
    expect(describeInstrument(NIFTY_CE)).toBe("NFO · 30 Oct 25 24000 PE");
    expect(describeInstrument(NIFTY_FUT)).toBe("NFO · 30 Oct 25 FUT");
    expect(accessibleName(RELIANCE)).toBe("RELIANCE, NSE");
    expect(accessibleName(NIFTY_CE)).toBe("NIFTY 24000 PE, put, expiry 30 Oct 2025, NFO");
    expect(accessibleName(NIFTY_FUT)).toBe("NIFTY FUT, futures, expiry 30 Oct 2025, NFO");
  });
});
