/**
 * @finlytics/broker-sdk: the broker contract and its guard rails (docs/plans/phase-1-broker-sdk.md). Node only.
 *
 * Exports are listed by name, so the public surface stays deliberate; src/__tests__/index.test.ts pins it.
 */
export { BROKER_METHODS, MUTATING_METHODS, RETRYABLE_METHODS } from "./adapter";
export type {
  AccountCallContext,
  BrokerAdapter,
  BrokerCapabilities,
  BrokerMethod,
  BrokerMethodsMatchInterface,
  CallContext,
  FeedLimits,
} from "./adapter";

export { MARKET_INDEX_ALIASES, marketIndexAlias, marketIndexByDhanSecurityId } from "./index-aliases";
export type { MarketIndexAlias } from "./index-aliases";

export {
  AuthStartSchema,
  BROKER_ORDER_STATUSES,
  BrokerHoldingSchema,
  BrokerIdSchema,
  BrokerOrderSchema,
  BrokerOrderStatusSchema,
  BrokerPositionSchema,
  BrokerTradeSchema,
  CandleSchema,
  FEED_MODES,
  FeedModeSchema,
  FundsSchema,
  InstrumentRowSchema,
  ModifyOrderInputSchema,
  ORDER_SIDES,
  OrderSideSchema,
  OrderTagSchema,
  PlaceOrderInputSchema,
  PlaceOrderResultSchema,
  ProfileSchema,
  TERMINAL_ORDER_STATUSES,
  TickSchema,
  TIMEFRAMES,
  TimeframeSchema,
} from "./models";
export type {
  AuthStart,
  BrokerHolding,
  BrokerOrder,
  BrokerOrderStatus,
  BrokerPosition,
  BrokerTrade,
  Candle,
  CandleQuery,
  DepthLevel,
  ExchangeTokenInput,
  FeedMode,
  Funds,
  InstrumentRow,
  ModifyOrderInput,
  OrderSide,
  OrderUpdate,
  PlaceOrderInput,
  PlaceOrderResult,
  Profile,
  Tick,
  Timeframe,
  TradeUpdate,
} from "./models";

export {
  BrokerCredentialsJsonSchema,
  credentialsFromJson,
  credentialsToJson,
  isSecret,
  Secret,
  secretValues,
} from "./credentials";
export type { BrokerCredentials, BrokerCredentialsJson } from "./credentials";

export {
  BrokerError,
  BrokerInputError,
  BrokerInternalError,
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerTimeoutError,
  BrokerUnavailableError,
  CircuitOpenError,
  DependencyUnavailableError,
  isBrokerError,
  isBrokerFailure,
  NeedsReloginError,
  RateLimitedError,
} from "./errors";
export type { BrokerErrorCode, BrokerErrorDetail, BrokerErrorOptions } from "./errors";

export { REDACTED, redactSecrets } from "./redact";
export { abortReason, DEFAULT_BROKER_TIMEOUT_MS, sleep, withTimeout } from "./timeout";
export type { TimeoutOptions } from "./timeout";

export { TypedEmitter } from "./feed/emitter";
export type { Unsubscribe } from "./feed/emitter";
export type { FeedStatus, MarketFeed, MarketFeedEvents, OrderFeed, OrderFeedEvents } from "./feed/feed";
export { FeedSubscriptions } from "./feed/subscriptions";
export { backoffDelayMs } from "./feed/backoff";
export type { BackoffOptions } from "./feed/backoff";

export {
  assertRateLimit,
  DEFAULT_BROKER_RATE_LIMITS,
  RATE_CLASSES,
  rateClassOf,
  resolveRateLimit,
} from "./rate-limit/limits";
export type { BrokerRateLimits, RateClass, RateLimit, RateLimitOverrides } from "./rate-limit/limits";
export { assertCost, gcra, gcraParams } from "./rate-limit/gcra";
export type { GcraParams, GcraStep, RateDecision } from "./rate-limit/gcra";
export { GCRA_LUA, GCRA_SHA1 } from "./rate-limit/gcra.lua";
export { APP_ACCOUNT_ID, BaseRateLimiter, BrokerRateLimiter, rateLimitKey } from "./rate-limit/rate-limiter";
export type {
  AcquireOptions,
  RateLimiter,
  RateLimiterOptions,
  RateLimitScope,
  RedisScriptClient,
} from "./rate-limit/rate-limiter";
export { MemoryRateLimiter } from "./rate-limit/memory-rate-limiter";
export type { MemoryRateLimiterOptions } from "./rate-limit/memory-rate-limiter";

export { CircuitBreaker, CircuitBreakerRegistry } from "./circuit-breaker";
export type {
  CircuitBreakerOptions,
  CircuitPermit,
  CircuitScope,
  CircuitState,
  CircuitStateChange,
} from "./circuit-breaker";

export { BrokerGateway } from "./gateway";
export type { BrokerAccountRef, BrokerGatewayOptions, BrokerLogger, GatewayCallOptions, RetryOptions } from "./gateway";

export { BrokerRegistry, createBrokerRegistry } from "./registry";
export type {
  BrokerAdapterFactory,
  BrokerFactoryOptions,
  BrokerFactoryOptionsMap,
  DefaultBrokerFactoryOptions,
} from "./registry";

export { DHAN_CAPABILITIES, DhanAdapter } from "./brokers/dhan/adapter";
export type { DhanAdapterOptions } from "./brokers/dhan/adapter";
export type { DhanFeedOptions, DhanSocket, DhanWebSocketFactory } from "./brokers/dhan/feed";
export type { DhanFetch } from "./brokers/dhan/http";
export { DhanInstrumentMap } from "./brokers/dhan/instruments";
export type { DhanInstrumentRef } from "./brokers/dhan/instruments";

export { PAPER_CAPABILITIES, PaperAdapter } from "./brokers/paper/adapter";
export type { PaperAdapterOptions } from "./brokers/paper/adapter";
export { zeroCharges } from "./brokers/paper/charges";
export type { PaperChargesFn, PaperFill } from "./brokers/paper/charges";
export { MemoryQuoteSource } from "./brokers/paper/quotes";
export type { PaperQuote, PaperQuoteSource } from "./brokers/paper/quotes";

export { UPSTOX_CAPABILITIES, UpstoxAdapter } from "./brokers/upstox/adapter";
export type { UpstoxAdapterOptions, UpstoxAppCredentials, UpstoxAuthUrlInput } from "./brokers/upstox/adapter";
export type { UpstoxSocket, UpstoxSocketFactory, UpstoxSocketHandlers } from "./brokers/upstox/feed";
export type { UpstoxFetch } from "./brokers/upstox/http";
export { UpstoxInstrumentMap } from "./brokers/upstox/instruments";
export type { UpstoxInstrumentRef, UpstoxInstrumentResolver } from "./brokers/upstox/instruments";
export { upstoxTokenExpiry } from "./brokers/upstox/mappers";
