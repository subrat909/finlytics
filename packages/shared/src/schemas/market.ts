/**
 * Market overview (plan phase-1b-terminal-ui-live-data "Market"): `GET /v1/market/overview`, the footer's market and
 * feed status, the navbar's index ticker and the dashboard's market panel. Quotes come from our Redis cache (the one
 * shared feed), never from a broker REST call.
 */
import { z } from "zod";

import { InstrumentKeySchema } from "../instrument-key";
import { DecimalStringSchema, PriceSchema } from "../money";

import { BrokerCodeSchema } from "./enums";
import { RtFeedStateSchema } from "./realtime";

/** The indices the platform always streams (pinned in the feed): canonical keys, exactly as the instrument master. */
export const MARKET_INDEX_KEYS = Object.freeze({
  NIFTY: "NSE_INDEX|NIFTY 50",
  BANKNIFTY: "NSE_INDEX|NIFTY BANK",
  FINNIFTY: "NSE_INDEX|NIFTY FIN SERVICE",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
  NIFTYNXT50: "NSE_INDEX|NIFTY NEXT 50",
  NIFTYIT: "NSE_INDEX|NIFTY IT",
  INDIAVIX: "NSE_INDEX|INDIA VIX",
  SENSEX: "BSE_INDEX|SENSEX",
  BANKEX: "BSE_INDEX|BANKEX",
} as const);
export type MarketIndexId = keyof typeof MARKET_INDEX_KEYS;

/**
 * The NIFTY 50 constituents the feed always streams (pinned with the indices): breadth, gainers, losers and most
 * active come from their quotes. Canonical `NSE_EQ|<SYMBOL>` keys, equal to the dev seed's 50 equities
 * (packages/database/prisma/seed/instruments.ts); approximate, since the index is rebalanced twice a year.
 */
export const NIFTY_50_KEYS = Object.freeze([
  "NSE_EQ|ADANIENT",
  "NSE_EQ|ADANIPORTS",
  "NSE_EQ|APOLLOHOSP",
  "NSE_EQ|ASIANPAINT",
  "NSE_EQ|AXISBANK",
  "NSE_EQ|BAJAJ-AUTO",
  "NSE_EQ|BAJAJFINSV",
  "NSE_EQ|BAJFINANCE",
  "NSE_EQ|BEL",
  "NSE_EQ|BHARTIARTL",
  "NSE_EQ|CIPLA",
  "NSE_EQ|COALINDIA",
  "NSE_EQ|DRREDDY",
  "NSE_EQ|EICHERMOT",
  "NSE_EQ|ETERNAL",
  "NSE_EQ|GRASIM",
  "NSE_EQ|HCLTECH",
  "NSE_EQ|HDFCBANK",
  "NSE_EQ|HDFCLIFE",
  "NSE_EQ|HINDALCO",
  "NSE_EQ|HINDUNILVR",
  "NSE_EQ|ICICIBANK",
  "NSE_EQ|INDIGO",
  "NSE_EQ|INFY",
  "NSE_EQ|ITC",
  "NSE_EQ|JIOFIN",
  "NSE_EQ|JSWSTEEL",
  "NSE_EQ|KOTAKBANK",
  "NSE_EQ|LT",
  "NSE_EQ|M&M",
  "NSE_EQ|MARUTI",
  "NSE_EQ|MAXHEALTH",
  "NSE_EQ|NESTLEIND",
  "NSE_EQ|NTPC",
  "NSE_EQ|ONGC",
  "NSE_EQ|POWERGRID",
  "NSE_EQ|RELIANCE",
  "NSE_EQ|SBILIFE",
  "NSE_EQ|SBIN",
  "NSE_EQ|SHRIRAMFIN",
  "NSE_EQ|SUNPHARMA",
  "NSE_EQ|TATACONSUM",
  "NSE_EQ|TATASTEEL",
  "NSE_EQ|TCS",
  "NSE_EQ|TECHM",
  "NSE_EQ|TITAN",
  "NSE_EQ|TMPV",
  "NSE_EQ|TRENT",
  "NSE_EQ|ULTRACEMCO",
  "NSE_EQ|WIPRO",
] as const);

/** The navbar ticker, in order. */
export const TICKER_INDEX_IDS = Object.freeze([
  "NIFTY",
  "BANKNIFTY",
  "SENSEX",
  "INDIAVIX",
] as const satisfies readonly MarketIndexId[]);

/** Exchanges with a session in the footer (cash/F&O share NSE's and BSE's hours). */
export const MARKET_EXCHANGES = Object.freeze(["NSE", "BSE", "MCX"] as const);
export const MarketExchangeSchema = z.enum(MARKET_EXCHANGES);
export type MarketExchange = z.infer<typeof MarketExchangeSchema>;

/**
 * Where the exchange's day is (IST): NSE/BSE pre-open 09:00–09:15, open 09:15–15:30, post-close 15:30–16:00;
 * MCX open 09:00–23:30 (23:55 in US DST is not modelled). Anything else is `closed`.
 */
export const MARKET_PHASES = Object.freeze(["pre_open", "open", "post_close", "closed"] as const);
export const MarketPhaseSchema = z.enum(MARKET_PHASES);
export type MarketPhase = z.infer<typeof MarketPhaseSchema>;

export const ExchangeStatusSchema = z.strictObject({
  exchange: MarketExchangeSchema,
  phase: MarketPhaseSchema,
  /** Why a weekday is closed: a trading holiday (from `MarketHoliday`), else null. */
  holiday: z.string().max(120).nullable(),
  /** The next session start (ISO, UTC) when not open; null while open. */
  opensAt: z.iso.datetime().nullable(),
  /** Today's close (ISO, UTC) while pre-open/open; else null. */
  closesAt: z.iso.datetime().nullable(),
});
export type ExchangeStatus = z.infer<typeof ExchangeStatusSchema>;

/**
 * The shared feed: which source drives every quote. `live` is false for the paper simulator, and the UI must then
 * label prices as simulated. `reason` explains a fallback in our own words (never a broker message).
 */
export const FeedInfoSchema = z.strictObject({
  state: RtFeedStateSchema,
  source: BrokerCodeSchema,
  live: z.boolean(),
  /** Last tick the feed wrote (ISO), or null. */
  lastTickAt: z.iso.datetime().nullable(),
  reason: z.string().max(200).nullable(),
});
export type FeedInfo = z.infer<typeof FeedInfoSchema>;

/** One index or stock line: last price and the day's numbers (null until the feed has them). */
export const MarketQuoteSchema = z.strictObject({
  key: InstrumentKeySchema,
  symbol: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  ltp: PriceSchema.nullable(),
  chg: DecimalStringSchema.nullable(),
  chgPct: DecimalStringSchema.nullable(),
  open: PriceSchema.nullable(),
  high: PriceSchema.nullable(),
  low: PriceSchema.nullable(),
  /** Previous close. */
  close: PriceSchema.nullable(),
  vol: z.int().min(0).nullable(),
  /** Exchange time of the last trade, epoch ms; null without a quote. */
  ts: z.int().min(0).nullable(),
});
export type MarketQuote = z.infer<typeof MarketQuoteSchema>;

/** NIFTY 50 breadth from the constituents' quotes. */
export const MarketBreadthSchema = z.strictObject({
  advances: z.int().min(0),
  declines: z.int().min(0),
  unchanged: z.int().min(0),
});
export type MarketBreadth = z.infer<typeof MarketBreadthSchema>;

/** `GET /v1/market/overview` (cached ≤ 1 s server-side). */
export const MarketOverviewSchema = z.strictObject({
  asOf: z.iso.datetime(),
  exchanges: z.array(ExchangeStatusSchema),
  feed: FeedInfoSchema,
  /** Every {@link MARKET_INDEX_KEYS} entry, in that order. */
  indices: z.array(MarketQuoteSchema),
  /** NIFTY 50 constituents by change %, at most 5 each. */
  gainers: z.array(MarketQuoteSchema).max(10),
  losers: z.array(MarketQuoteSchema).max(10),
  /** Most traded NIFTY 50 constituents by volume, at most 5. */
  active: z.array(MarketQuoteSchema).max(10),
  breadth: MarketBreadthSchema,
});
export type MarketOverview = z.infer<typeof MarketOverviewSchema>;
