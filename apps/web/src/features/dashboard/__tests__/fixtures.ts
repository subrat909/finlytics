/**
 * Api responses for the dashboard and brokers tests, valid against the shared schemas (the client parses them).
 */
import { InstrumentKeySchema, MARKET_INDEX_KEYS } from "@finlytics/shared";
import type {
  BrokerAccountView,
  BrokerLimits,
  FundsView,
  HoldingsView,
  MarketOverview,
  MarketQuote,
  PositionsView,
} from "@finlytics/shared";

import type { Tick } from "@/features/realtime/schemas";

/** A canonical instrument key (validated, so a typo fails here rather than in the api client). */
export function instrumentKey(value: string) {
  return InstrumentKeySchema.parse(value);
}

export const NOW = Date.UTC(2026, 9, 6, 6, 0);
export const AS_OF = "2026-10-06T05:02:09.000Z";

export const UPSTOX: BrokerAccountView = {
  id: "acc_up",
  broker: "UPSTOX",
  label: "Main",
  status: "ACTIVE",
  isDefault: true,
  tokenExpiresAt: "2026-10-06T22:00:00.000Z",
  lastLoginAt: "2026-10-06T03:00:00.000Z",
  lastError: null,
};

export const DHAN: BrokerAccountView = {
  id: "acc_dh",
  broker: "DHAN",
  label: "Dhan swing",
  status: "ACTIVE",
  isDefault: false,
  tokenExpiresAt: "2026-10-06T07:00:00.000Z",
  lastLoginAt: "2026-10-05T07:00:00.000Z",
  lastError: null,
};

export const PAPER: BrokerAccountView = {
  id: "acc_pa",
  broker: "PAPER",
  label: "Paper",
  status: "ACTIVE",
  isDefault: false,
  tokenExpiresAt: null,
  lastLoginAt: null,
  lastError: null,
};

export const LIMITS: BrokerLimits = { maxBrokerAccounts: 2, brokerAccounts: 1, maxPaperAccounts: 3, paperAccounts: 0 };

export const AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog?client_id=x&state=y";

export const FUNDS: FundsView = {
  accountId: "acc_up",
  broker: "UPSTOX",
  asOf: AS_OF,
  availableMargin: "75000",
  usedMargin: "25000",
  collateral: "10000",
  withdrawable: "70000",
};

export const POSITIONS: PositionsView = {
  accountId: "acc_up",
  broker: "UPSTOX",
  asOf: AS_OF,
  positions: [
    {
      instrumentKey: instrumentKey("NSE_EQ|RELIANCE"),
      symbol: "RELIANCE",
      name: "Reliance Industries",
      exchange: "NSE",
      segment: "EQ",
      lotSize: 1,
      product: "INTRADAY",
      netQty: 50,
      buyQty: 50,
      sellQty: 0,
      buyAvg: "2900",
      sellAvg: "0",
      realisedPnl: "0",
      ltp: "2910",
      unrealisedPnl: "500",
    },
    {
      instrumentKey: instrumentKey("NSE_FO|NIFTY|2026-10-27|24000|CE"),
      symbol: "NIFTY 27 OCT 24000 CE",
      name: null,
      exchange: "NFO",
      segment: "OPT",
      lotSize: 75,
      product: "MARGIN",
      netQty: -75,
      buyQty: 0,
      sellQty: 75,
      buyAvg: "0",
      sellAvg: "120",
      realisedPnl: "0",
      ltp: "110",
      unrealisedPnl: "750",
    },
    {
      instrumentKey: instrumentKey("NSE_EQ|INFY"),
      symbol: "INFY",
      name: "Infosys",
      exchange: "NSE",
      segment: "EQ",
      lotSize: 1,
      product: "INTRADAY",
      netQty: 0,
      buyQty: 10,
      sellQty: 10,
      buyAvg: "1500",
      sellAvg: "1490",
      realisedPnl: "-100",
      ltp: "1495",
      unrealisedPnl: "0",
    },
  ],
};

export const HOLDINGS: HoldingsView = {
  accountId: "acc_up",
  broker: "UPSTOX",
  asOf: AS_OF,
  holdings: [
    {
      instrumentKey: instrumentKey("NSE_EQ|TCS"),
      symbol: "TCS",
      name: "Tata Consultancy Services",
      exchange: "NSE",
      segment: "EQ",
      lotSize: 1,
      qty: 10,
      t1Qty: 0,
      avgPrice: "3500",
      ltp: "3600",
      close: "3550",
    },
    {
      instrumentKey: instrumentKey("NSE_EQ|HDFCBANK"),
      symbol: "HDFCBANK",
      name: "HDFC Bank",
      exchange: "NSE",
      segment: "EQ",
      lotSize: 1,
      qty: 20,
      t1Qty: 0,
      avgPrice: "1600",
      ltp: "1580",
      close: "1590",
    },
  ],
};

function quote(rawKey: string, symbol: string, name: string, ltp: string, chg: string, chgPct: string): MarketQuote {
  return {
    key: instrumentKey(rawKey),
    symbol,
    name,
    ltp,
    chg,
    chgPct,
    open: null,
    high: null,
    low: null,
    close: null,
    vol: 1_250_000,
    ts: NOW,
  };
}

export function overview(live: boolean): MarketOverview {
  return {
    asOf: AS_OF,
    exchanges: [
      { exchange: "NSE", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T10:00:00.000Z" },
      { exchange: "BSE", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T10:00:00.000Z" },
      { exchange: "MCX", phase: "open", holiday: null, opensAt: null, closesAt: "2026-10-06T18:00:00.000Z" },
    ],
    feed: {
      state: "up",
      source: live ? "UPSTOX" : "PAPER",
      live,
      lastTickAt: AS_OF,
      reason: live ? null : "No live broker session",
    },
    indices: [
      quote(MARKET_INDEX_KEYS.NIFTY, "NIFTY", "NIFTY 50", "24012.35", "120.5", "0.5"),
      quote(MARKET_INDEX_KEYS.BANKNIFTY, "BANKNIFTY", "NIFTY BANK", "51000", "-210", "-0.41"),
      quote(MARKET_INDEX_KEYS.SENSEX, "SENSEX", "SENSEX", "79000", "300", "0.38"),
      quote(MARKET_INDEX_KEYS.INDIAVIX, "INDIAVIX", "INDIA VIX", "13.2", "-0.4", "-2.94"),
    ],
    gainers: [quote("NSE_EQ|TCS", "TCS", "Tata Consultancy Services", "3600", "50", "1.41")],
    losers: [quote("NSE_EQ|HDFCBANK", "HDFCBANK", "HDFC Bank", "1580", "-10", "-0.63")],
    active: [quote("NSE_EQ|RELIANCE", "RELIANCE", "Reliance Industries", "2910", "10", "0.34")],
    breadth: { advances: 32, declines: 16, unchanged: 2 },
  };
}

/** A tick as the realtime client stores it (cast: newer Tick fields are optional for these tests). */
export function tick(ltp: number, chg = 0): Tick {
  return { ltp, chg, chgPct: 0, vol: null, ts: NOW, receivedAt: NOW };
}
