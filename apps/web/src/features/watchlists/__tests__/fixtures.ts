import type { Instrument, Watchlist } from "@finlytics/shared";

export function instrument(symbol: string, overrides: Partial<Instrument> = {}): Instrument {
  return {
    key: `NSE_EQ|${symbol}`,
    exchange: "NSE",
    segment: "EQ",
    symbol,
    tradingSymbol: symbol,
    name: `${symbol} Ltd`,
    expiry: null,
    strike: null,
    optionType: null,
    lotSize: 1,
    tickSize: "0.05",
    isActive: true,
    ...overrides,
  };
}

export const NIFTY_CE = instrument("NIFTY", {
  key: "NSE_FO|NIFTY|2025-10-30|24000|CE",
  exchange: "NFO",
  segment: "OPT",
  name: "NIFTY",
  expiry: "2025-10-30",
  strike: "24000",
  optionType: "CE",
  lotSize: 75,
});

export function watchlist(id: string, name: string, symbols: Instrument[], position = 0): Watchlist {
  return {
    id,
    name,
    position,
    items: symbols.map((item, index) => ({
      id: `${id}-item-${String(index)}`,
      instrumentKey: item.key,
      position: index,
      instrument: item,
    })),
  };
}
