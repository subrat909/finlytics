/**
 * BrokerAdapter: the ONLY contract through which Finlytics talks to a broker (.claude/rules/broker.md). Exactly 12
 * operations; adding a method here is an architecture decision, and the type test plus the contract suite fail until
 * {@link BROKER_METHODS} lists it.
 *
 * Nothing calls an adapter directly: `BrokerGateway` wraps every call with validation, the circuit breaker, the rate
 * limiter, a timeout and error redaction. Adapters keep helpers in module functions or `#private` members, so their
 * public surface is the contract and nothing else.
 *
 * Network methods receive a {@link CallContext} with an `AbortSignal` that fires on timeout or caller cancellation;
 * adapters pass it to `fetch`/the WebSocket and throw typed `BrokerError`s (./errors.ts).
 */
import type { BrokerCode } from "@finlytics/shared";

import type { BrokerCredentials } from "./credentials";
import type { MarketFeed, OrderFeed } from "./feed/feed";
import type {
  AuthStart,
  BrokerHolding,
  BrokerOrder,
  BrokerPosition,
  Candle,
  CandleQuery,
  ExchangeTokenInput,
  Funds,
  InstrumentRow,
  ModifyOrderInput,
  PlaceOrderInput,
  PlaceOrderResult,
  Profile,
} from "./models";

/** What every network call receives. */
export interface CallContext {
  /** Fires on timeout or caller cancellation; pass it to every request. */
  readonly signal: AbortSignal;
}

/** A call made for one connected account. */
export interface AccountCallContext extends CallContext {
  readonly creds: BrokerCredentials;
}

/** Fixed facts about a broker integration. */
export interface BrokerCapabilities {
  /** How users connect (Upstox: oauth; Dhan: token; Paper: none). */
  readonly authMode: AuthStart["mode"];
  /** Whether `refreshToken` can renew a session (false: it throws NeedsReloginError). */
  readonly refreshable: boolean;
  /** The most instruments one market-feed connection carries (Dhan: 5000). */
  readonly maxFeedInstruments: number;
  /** `app`: one order-feed connection for every account; `account`: one per account (docs/01). */
  readonly orderFeedScope: "app" | "account";
}

export interface BrokerAdapter {
  readonly code: BrokerCode;
  readonly capabilities: BrokerCapabilities;

  // 1. One-time login. `getAuthUrl` makes no network call.
  getAuthUrl(input: { readonly state: string; readonly redirectUri: string }): AuthStart;
  exchangeToken(ctx: CallContext, input: ExchangeTokenInput): Promise<BrokerCredentials>;
  // 2. Scheduled before expiry.
  refreshToken(ctx: AccountCallContext): Promise<BrokerCredentials>;
  // 3. Once on connect.
  getProfile(ctx: AccountCallContext): Promise<Profile>;
  // 4. Dashboard open and after fills (cached 5 s by the api).
  getFunds(ctx: AccountCallContext): Promise<Funds>;
  // 5. Once a day (08:00 IST job). `creds` is optional: some brokers publish the master without auth.
  downloadInstrumentMaster(
    ctx: CallContext & { readonly creds?: BrokerCredentials | undefined },
  ): AsyncIterable<InstrumentRow>;
  // 6–8. User or strategy action.
  placeOrder(ctx: AccountCallContext, input: PlaceOrderInput): Promise<PlaceOrderResult>;
  modifyOrder(ctx: AccountCallContext, input: ModifyOrderInput): Promise<void>;
  cancelOrder(ctx: AccountCallContext, brokerOrderId: string): Promise<void>;
  // 9. Reconcile on reconnect, or every 60 s while the order feed is down.
  getOrderBook(ctx: AccountCallContext): Promise<BrokerOrder[]>;
  // 10. Page open and after fills (cached 5 s by the api).
  getPositions(ctx: AccountCallContext): Promise<BrokerPosition[]>;
  getHoldings(ctx: AccountCallContext): Promise<BrokerHolding[]>;
  // 11. Chart backfill (cached in Timescale; never re-fetch what we have).
  getHistoricalCandles(ctx: AccountCallContext, query: CandleQuery): Promise<Candle[]>;
  // 12. ONE connection each per broker, shared by all users; the gateway enforces it.
  connectMarketFeed(ctx: AccountCallContext): Promise<MarketFeed>;
  connectOrderFeed(ctx: AccountCallContext): Promise<OrderFeed>;
}

/** Each adapter method and the broker.md operation number (1–12) it belongs to. */
export const BROKER_METHODS = Object.freeze({
  getAuthUrl: 1,
  exchangeToken: 1,
  refreshToken: 2,
  getProfile: 3,
  getFunds: 4,
  downloadInstrumentMaster: 5,
  placeOrder: 6,
  modifyOrder: 7,
  cancelOrder: 8,
  getOrderBook: 9,
  getPositions: 10,
  getHoldings: 10,
  getHistoricalCandles: 11,
  connectMarketFeed: 12,
  connectOrderFeed: 12,
} as const);

/** A method of {@link BrokerAdapter}. */
export type BrokerMethod = keyof typeof BROKER_METHODS;

/** Methods that change state at the broker: never retried, and a failure without an answer leaves the outcome unknown. */
export const MUTATING_METHODS: ReadonlySet<BrokerMethod> = new Set([
  "exchangeToken",
  "refreshToken",
  "placeOrder",
  "modifyOrder",
  "cancelOrder",
]);

/** Read-only methods the gateway may retry on a retryable error (plan B10). */
export const RETRYABLE_METHODS: ReadonlySet<BrokerMethod> = new Set([
  "getProfile",
  "getFunds",
  "getOrderBook",
  "getPositions",
  "getHoldings",
  "getHistoricalCandles",
]);

/** The method names of an adapter interface, for the compile-time check that BROKER_METHODS lists exactly them. */
type FunctionKeys<T> = { [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T];
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compile-time: true only when {@link BROKER_METHODS} lists exactly the methods of {@link BrokerAdapter}. */
export type BrokerMethodsMatchInterface = Exactly<FunctionKeys<BrokerAdapter>, BrokerMethod>;
