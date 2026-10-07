import { MARKET_INDEX_KEYS, MarketOverviewSchema } from "@finlytics/shared";
import type { ExchangeStatus, FeedInfo, MarketOverview, MarketQuoteSchema } from "@finlytics/shared";
import type { z } from "zod";

/** Tue 6 Oct 2026, 13:30 IST. */
export const AS_OF = "2026-10-06T08:00:00.000Z";

export const OPEN_SESSIONS: ExchangeStatus[] = [
  { exchange: "NSE", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T10:00:00.000Z" },
  { exchange: "BSE", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T10:00:00.000Z" },
  { exchange: "MCX", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T18:00:00.000Z" },
];

export const SIMULATED_FEED: FeedInfo = {
  state: "up",
  source: "PAPER",
  live: false,
  lastTickAt: AS_OF,
  reason: "No active Upstox or Dhan account",
};

export const UPSTOX_FEED: FeedInfo = { state: "up", source: "UPSTOX", live: true, lastTickAt: AS_OF, reason: null };

const INDEX_NUMBERS: Readonly<Record<string, [string, string, string]>> = {
  NIFTY: ["24812.35", "128.40", "0.52"],
  BANKNIFTY: ["54310.10", "-212.75", "-0.39"],
  SENSEX: ["81204.60", "402.15", "0.50"],
  INDIAVIX: ["12.84", "0.00", "0.00"],
};

/** The wire shape (the schema brands the key when the overview is parsed). */
function indexQuote(id: string, key: string): z.input<typeof MarketQuoteSchema> {
  const [ltp, chg, chgPct] = INDEX_NUMBERS[id] ?? [null, null, null];
  return {
    key,
    symbol: key.slice(key.indexOf("|") + 1),
    name: key.slice(key.indexOf("|") + 1),
    ltp,
    chg,
    chgPct,
    open: null,
    high: null,
    low: null,
    close: null,
    vol: null,
    ts: ltp === null ? null : Date.parse(AS_OF),
  };
}

/** A valid overview (checked against the shared schema): sessions open, the simulator feeding, every index. */
export function marketOverview(overrides: Partial<z.input<typeof MarketOverviewSchema>> = {}): MarketOverview {
  return MarketOverviewSchema.parse({
    asOf: AS_OF,
    exchanges: OPEN_SESSIONS,
    feed: SIMULATED_FEED,
    indices: Object.entries(MARKET_INDEX_KEYS).map(([id, key]) => indexQuote(id, key)),
    gainers: [],
    losers: [],
    active: [],
    breadth: { advances: 31, declines: 18, unchanged: 1 },
    ...overrides,
  });
}
