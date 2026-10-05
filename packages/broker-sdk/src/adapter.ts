/**
 * BrokerAdapter — the ONLY contract through which Finlytics talks to any broker.
 * Exactly 12 operations (see .claude/rules/broker.md). Adding a method here is an architecture decision.
 */
import type { EventEmitter } from "node:events";

export type BrokerCode = "UPSTOX" | "DHAN" | "ZERODHA" | "ANGELONE" | "FYERS" | "SHOONYA" | "PAPER";
export type InstrumentKey = string; // canonical: NSE_FO|NIFTY|2025-10-30|24000|CE

export interface BrokerCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
  clientId?: string;
  extra?: Record<string, string>;
}

export interface AuthStart {
  mode: "oauth" | "token";
  url?: string; // oauth authorize URL
  fields?: { name: string; label: string; secret: boolean }[]; // for token mode
}

export interface Profile {
  clientId: string;
  name: string;
  email?: string;
  exchangesEnabled: string[];
}

export interface Funds {
  availableCash: string;
  usedMargin: string;
  collateral: string;
  totalBalance: string;
}

export interface InstrumentRow {
  key: InstrumentKey;
  brokerToken: string;
  exchange: string;
  segment: string;
  symbol: string;
  name: string;
  expiry?: string;
  strike?: string;
  optionType?: "CE" | "PE";
  lotSize: number;
  tickSize: string;
  freezeQty?: number;
}

export interface PlaceOrderInput {
  key: InstrumentKey;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "SL" | "SL_M";
  product: "INTRADAY" | "DELIVERY" | "MARGIN" | "CO" | "BO";
  validity: "DAY" | "IOC";
  qty: number;
  price?: string;
  triggerPrice?: string;
  tag?: string; // algoId / correlation
}

export interface ModifyOrderInput {
  brokerOrderId: string;
  qty?: number;
  price?: string;
  triggerPrice?: string;
  type?: PlaceOrderInput["type"];
}

export interface BrokerOrder {
  brokerOrderId: string;
  key: InstrumentKey;
  side: PlaceOrderInput["side"];
  type: PlaceOrderInput["type"];
  product: PlaceOrderInput["product"];
  qty: number;
  filledQty: number;
  price?: string;
  triggerPrice?: string;
  avgPrice?: string;
  status: "PENDING" | "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED";
  message?: string;
  placedAt: string;
  updatedAt: string;
  tag?: string;
}

export interface BrokerPosition {
  key: InstrumentKey;
  product: PlaceOrderInput["product"];
  netQty: number;
  buyQty: number;
  sellQty: number;
  buyAvg: string;
  sellAvg: string;
  realisedPnl: string;
  ltp?: string;
}

export interface BrokerHolding {
  key: InstrumentKey;
  qty: number;
  avgPrice: string;
  ltp?: string;
}

export interface CandleRow {
  ts: number; // epoch seconds
  o: string;
  h: string;
  l: string;
  c: string;
  v: number;
  oi?: number;
}

export type FeedMode = "ltp" | "quote" | "full";

export interface Tick {
  k: InstrumentKey;
  ltp: number;
  ts: number;
  v?: number;
  oi?: number;
  bid?: number;
  ask?: number;
  bq?: number;
  aq?: number;
  depth?: { b: [number, number][]; a: [number, number][] };
  greeks?: { iv: number; delta: number; gamma: number; theta: number; vega: number };
}

export interface MarketFeed extends EventEmitter {
  connect(): Promise<void>;
  subscribe(keys: InstrumentKey[], mode: FeedMode): Promise<void>;
  unsubscribe(keys: InstrumentKey[]): Promise<void>;
  close(): Promise<void>;
  // events: "tick" (Tick), "status" ("up"|"degraded"|"down"), "error"
}

export interface OrderFeed extends EventEmitter {
  connect(): Promise<void>;
  close(): Promise<void>;
  // events: "order" (BrokerOrder), "trade", "status", "error"
}

export class BrokerError extends Error {
  constructor(
    public readonly code:
      | "AUTH"
      | "RATE_LIMIT"
      | "REJECTED"
      | "NETWORK"
      | "TIMEOUT"
      | "NOT_FOUND"
      | "UNKNOWN",
    message: string,
    public readonly retryable = false,
    public readonly brokerCode?: string,
  ) {
    super(message);
  }
}

export interface BrokerAdapter {
  readonly code: BrokerCode;
  readonly limits: { reqPerSec: number; reqPerMin: number; maxFeedInstruments: number };

  // 1. auth
  startAuth(state: string, redirectUri: string): AuthStart;
  exchangeToken(input: { code?: string; fields?: Record<string, string>; redirectUri?: string }): Promise<BrokerCredentials>;
  // 2.
  refreshToken(creds: BrokerCredentials): Promise<BrokerCredentials>;
  // 3.
  getProfile(creds: BrokerCredentials): Promise<Profile>;
  // 4.
  getFunds(creds: BrokerCredentials): Promise<Funds>;
  // 5.
  downloadInstrumentMaster(): Promise<AsyncIterable<InstrumentRow>>;
  // 6–8.
  placeOrder(creds: BrokerCredentials, input: PlaceOrderInput): Promise<{ brokerOrderId: string }>;
  modifyOrder(creds: BrokerCredentials, input: ModifyOrderInput): Promise<void>;
  cancelOrder(creds: BrokerCredentials, brokerOrderId: string): Promise<void>;
  // 9.
  getOrderBook(creds: BrokerCredentials): Promise<BrokerOrder[]>;
  // 10.
  getPositions(creds: BrokerCredentials): Promise<BrokerPosition[]>;
  getHoldings(creds: BrokerCredentials): Promise<BrokerHolding[]>;
  // 11.
  getHistoricalCandles(
    creds: BrokerCredentials,
    key: InstrumentKey,
    timeframe: "M1" | "M5" | "M15" | "M30" | "H1" | "D1",
    from: Date,
    to: Date,
  ): Promise<CandleRow[]>;
  // 12. shared feeds (one per broker process; creds = any active account's token designated as "feed account")
  createMarketFeed(creds: BrokerCredentials): MarketFeed;
  createOrderFeed(creds: BrokerCredentials): OrderFeed;
}
