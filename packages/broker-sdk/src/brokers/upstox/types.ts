/**
 * Upstox wire types, copied from the official docs (https://upstox.com/developer/api-documentation/, read 2026-10-06).
 * URLs, field names and enum values are Upstox's, verbatim; ./mappers.ts turns them into the sdk's models.
 *
 * Response schemas are loose objects (Upstox adds fields over time). Fields the adapter reads are typed strictly enough
 * to map; the other documented fields are listed as optional so this file stays the reference for the wire format.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Endpoints (the only Upstox URLs the adapter calls; broker.md's 12 operations)

export const UPSTOX_API_ORIGIN = "https://api.upstox.com";
/** Order placement, modification and cancellation run on the HFT host. */
export const UPSTOX_HFT_ORIGIN = "https://api-hft.upstox.com";

export const UPSTOX_URLS = Object.freeze({
  /** 1. GET, browser redirect: `client_id`, `redirect_uri`, `response_type=code`, `state`. */
  authorize: `${UPSTOX_API_ORIGIN}/v2/login/authorization/dialog`,
  /** 1. POST form: `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`. */
  token: `${UPSTOX_API_ORIGIN}/v2/login/authorization/token`,
  /** 3. GET. */
  profile: `${UPSTOX_API_ORIGIN}/v2/user/profile`,
  /** 4. GET (`segment=SEC|COM` optional; since 19 July 2025 `equity` carries the combined funds). */
  funds: `${UPSTOX_API_ORIGIN}/v2/user/get-funds-and-margin`,
  /** 5. GET, no auth: the BOD instrument master, gzipped JSON array, refreshed around 06:00 IST. */
  instrumentMaster: "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",
  /** 6. POST JSON. */
  placeOrder: `${UPSTOX_HFT_ORIGIN}/v2/order/place`,
  /** 7. PUT JSON. */
  modifyOrder: `${UPSTOX_HFT_ORIGIN}/v2/order/modify`,
  /** 8. DELETE `?order_id=`. */
  cancelOrder: `${UPSTOX_HFT_ORIGIN}/v2/order/cancel`,
  /** 9. GET: every order of the day. */
  orderBook: `${UPSTOX_API_ORIGIN}/v2/order/retrieve-all`,
  /** 10. GET. */
  positions: `${UPSTOX_API_ORIGIN}/v2/portfolio/short-term-positions`,
  /** 10. GET. */
  holdings: `${UPSTOX_API_ORIGIN}/v2/portfolio/long-term-holdings`,
  /** 11. GET `/:instrument_key/:unit/:interval/:to_date/:from_date` (V3). Excludes the current day. */
  historicalCandles: `${UPSTOX_API_ORIGIN}/v3/historical-candle`,
  /** 11. GET `/:instrument_key/:unit/:interval` (V3): the current trading day. */
  intradayCandles: `${UPSTOX_API_ORIGIN}/v3/historical-candle/intraday`,
  /** 12. GET: a single-use `wss://` URL for the V3 market feed. */
  marketFeedAuthorize: `${UPSTOX_API_ORIGIN}/v3/feed/market-data-feed/authorize`,
  /** 12. GET `?update_types=order`: a single-use `wss://` URL for the portfolio stream. */
  portfolioFeedAuthorize: `${UPSTOX_API_ORIGIN}/v2/feed/portfolio-stream-feed/authorize`,
});

// ---------------------------------------------------------------------------------------------------------------------
// Enums

/** Place accepts I, D and MTF; order and position rows also show CO. */
export const UPSTOX_PRODUCTS = Object.freeze(["I", "D", "MTF", "CO"] as const);
export type UpstoxProduct = (typeof UPSTOX_PRODUCTS)[number];

export const UPSTOX_ORDER_TYPES = Object.freeze(["MARKET", "LIMIT", "SL", "SL-M"] as const);
export type UpstoxOrderType = (typeof UPSTOX_ORDER_TYPES)[number];

export const UPSTOX_VALIDITIES = Object.freeze(["DAY", "IOC"] as const);
export type UpstoxValidity = (typeof UPSTOX_VALIDITIES)[number];

export const UPSTOX_TRANSACTION_TYPES = Object.freeze(["BUY", "SELL"] as const);
export type UpstoxTransactionType = (typeof UPSTOX_TRANSACTION_TYPES)[number];

/** Appendix "Order Status", verbatim (lower case, with spaces). */
export const UPSTOX_ORDER_STATUSES = Object.freeze([
  "validation pending",
  "modify pending",
  "trigger pending",
  "put order req received",
  "modify after market order req received",
  "cancelled after market order",
  "open",
  "complete",
  "modify validation pending",
  "after market order req received",
  "modified",
  "not cancelled",
  "cancel pending",
  "rejected",
  "cancelled",
  "open pending",
  "not modified",
] as const);
export type UpstoxOrderStatus = (typeof UPSTOX_ORDER_STATUSES)[number];

/** Instrument master `segment` values. */
export const UPSTOX_SEGMENTS = Object.freeze([
  "NSE_EQ",
  "NSE_INDEX",
  "NSE_FO",
  "NCD_FO",
  "BSE_EQ",
  "BSE_INDEX",
  "BSE_FO",
  "BCD_FO",
  "MCX_FO",
  "NSE_COM",
  "GLOBAL_INDEX",
  "GLOBAL_INDICATOR",
] as const);
export type UpstoxSegment = (typeof UPSTOX_SEGMENTS)[number];

/** Historical candle V3 `unit` values. */
export const UPSTOX_CANDLE_UNITS = Object.freeze(["minutes", "hours", "days", "weeks", "months"] as const);
export type UpstoxCandleUnit = (typeof UPSTOX_CANDLE_UNITS)[number];

/** Market feed V3 modes. `full_d30` needs Upstox Plus. */
export const UPSTOX_FEED_MODES = Object.freeze(["ltpc", "option_greeks", "full", "full_d30"] as const);
export type UpstoxFeedMode = (typeof UPSTOX_FEED_MODES)[number];

export const UPSTOX_FEED_METHODS = Object.freeze(["sub", "unsub", "change_mode"] as const);
export type UpstoxFeedMethod = (typeof UPSTOX_FEED_METHODS)[number];

/**
 * Market feed V3 subscription limits per user: `individual` when every key uses one mode, `combined` per mode when
 * several modes are in use.
 */
export const UPSTOX_FEED_LIMITS = Object.freeze({
  individual: Object.freeze({ ltpc: 5000, option_greeks: 3000, full: 2000, full_d30: 50 }),
  combined: Object.freeze({ ltpc: 2000, option_greeks: 2000, full: 1500, full_d30: 1500 }),
} as const satisfies Record<"individual" | "combined", Record<UpstoxFeedMode, number>>);

/** `MarketStatus` of the feed's `market_info` message. */
export const UPSTOX_MARKET_STATUSES = Object.freeze([
  "PRE_OPEN_START",
  "PRE_OPEN_END",
  "NORMAL_OPEN",
  "NORMAL_CLOSE",
  "CLOSING_START",
  "CLOSING_END",
] as const);
export type UpstoxMarketStatus = (typeof UPSTOX_MARKET_STATUSES)[number];

/** The `errorCode`s the adapter branches on. */
export const UPSTOX_ERROR_CODES = Object.freeze({
  /** "Invalid token used to access API" (expired at 03:30 IST, or revoked). */
  INVALID_TOKEN: "UDAPI100050",
  /** "The API you are trying to access is not permitted with an extended_token". */
  EXTENDED_TOKEN_NOT_PERMITTED: "UDAPI100067",
  /** "Rate limits exceeded". */
  RATE_LIMITED: "UDAPI10005",
  /** Token API: "Rate limit exceeded". */
  TOKEN_RATE_LIMITED: "UDAPI100099",
  /** "Order not found". */
  ORDER_NOT_FOUND: "UDAPI100010",
  /** Funds service closed (00:00–05:30 IST). */
  FUNDS_SERVICE_HOURS: "UDAPI100072",
  /** Order APIs closed (00:00–05:30 IST). */
  ORDER_SERVICE_HOURS: "UDAPI100074",
} as const);

// ---------------------------------------------------------------------------------------------------------------------
// Envelopes and errors

/** `{ "status": "error", "errors": [{ "errorCode", "message", "propertyPath", "invalidValue", ... }] }`. */
export const UpstoxErrorBodySchema = z.looseObject({
  status: z.string().optional(),
  errors: z
    .array(
      z.looseObject({
        errorCode: z.string().nullish(),
        error_code: z.string().nullish(),
        message: z.string().nullish(),
        propertyPath: z.string().nullish(),
        invalidValue: z.unknown().optional(),
      }),
    )
    .optional(),
});
export type UpstoxErrorBody = z.infer<typeof UpstoxErrorBodySchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Auth, profile, funds

/** Get Token response: the profile fields plus `access_token` (and `extended_token`, which the adapter ignores). */
export const UpstoxTokenResponseSchema = z.looseObject({
  email: z.string().nullish(),
  exchanges: z.array(z.string()).nullish(),
  products: z.array(z.string()).nullish(),
  broker: z.string().nullish(),
  user_id: z.string().min(1),
  user_name: z.string().nullish(),
  order_types: z.array(z.string()).nullish(),
  user_type: z.string().nullish(),
  poa: z.boolean().nullish(),
  is_active: z.boolean().nullish(),
  access_token: z.string().min(1),
  extended_token: z.string().nullish(),
});
export type UpstoxTokenResponse = z.infer<typeof UpstoxTokenResponseSchema>;

export const UpstoxProfileSchema = z.looseObject({
  email: z.string().nullish(),
  exchanges: z.array(z.string()),
  products: z.array(z.string()).nullish(),
  broker: z.string().nullish(),
  user_id: z.string().min(1),
  user_name: z.string().min(1),
  order_types: z.array(z.string()).nullish(),
  user_type: z.string().nullish(),
  poa: z.boolean().nullish(),
  ddpi: z.boolean().nullish(),
  is_active: z.boolean().nullish(),
});
export type UpstoxProfile = z.infer<typeof UpstoxProfileSchema>;

export const UpstoxFundsSegmentSchema = z.looseObject({
  used_margin: z.number(),
  payin_amount: z.number().nullish(),
  span_margin: z.number().nullish(),
  adhoc_margin: z.number().nullish(),
  notional_cash: z.number().nullish(),
  available_margin: z.number(),
  exposure_margin: z.number().nullish(),
});
export type UpstoxFundsSegment = z.infer<typeof UpstoxFundsSegmentSchema>;

export const UpstoxFundsSchema = z.looseObject({
  equity: UpstoxFundsSegmentSchema,
  commodity: UpstoxFundsSegmentSchema.nullish(),
});
export type UpstoxFunds = z.infer<typeof UpstoxFundsSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Orders

/** Place Order (v2) request body. */
export interface UpstoxPlaceOrderRequest {
  readonly quantity: number;
  readonly product: UpstoxProduct;
  readonly validity: UpstoxValidity;
  readonly price: number;
  readonly tag?: string;
  readonly instrument_token: string;
  readonly order_type: UpstoxOrderType;
  readonly transaction_type: UpstoxTransactionType;
  readonly disclosed_quantity: number;
  readonly trigger_price: number;
  readonly is_amo: boolean;
  /** -1 (default): the exchange's automatic protection for MARKET and SL-M orders. */
  readonly market_protection?: number;
}

/** Modify Order (v2) request body: `validity`, `price`, `order_type` and `trigger_price` are required. */
export interface UpstoxModifyOrderRequest {
  readonly order_id: string;
  readonly quantity?: number;
  readonly validity: UpstoxValidity;
  readonly price: number;
  readonly order_type: UpstoxOrderType;
  readonly trigger_price: number;
  readonly disclosed_quantity?: number;
  readonly market_protection?: number;
}

/** `data` of place, modify and cancel. */
export const UpstoxOrderIdSchema = z.looseObject({ order_id: z.string().min(1) });

/** One row of Get Order Book (`/v2/order/retrieve-all`). */
export const UpstoxOrderSchema = z.looseObject({
  exchange: z.string().nullish(),
  product: z.string(),
  price: z.number().nullish(),
  quantity: z.number(),
  status: z.string(),
  guid: z.string().nullish(),
  tag: z.string().nullish(),
  instrument_token: z.string().min(1),
  placed_by: z.string().nullish(),
  trading_symbol: z.string().nullish(),
  tradingsymbol: z.string().nullish(),
  order_type: z.string(),
  validity: z.string(),
  trigger_price: z.number().nullish(),
  disclosed_quantity: z.number().nullish(),
  transaction_type: z.string(),
  average_price: z.number().nullish(),
  filled_quantity: z.number().nullish(),
  pending_quantity: z.number().nullish(),
  status_message: z.string().nullish(),
  status_message_raw: z.string().nullish(),
  exchange_order_id: z.string().nullish(),
  parent_order_id: z.string().nullish(),
  order_id: z.string().min(1),
  variety: z.string().nullish(),
  /** "2023-10-19 09:23:23" in IST. */
  order_timestamp: z.string().nullish(),
  exchange_timestamp: z.string().nullish(),
  is_amo: z.boolean().nullish(),
  order_request_id: z.string().nullish(),
  order_ref_id: z.string().nullish(),
});
export type UpstoxOrder = z.infer<typeof UpstoxOrderSchema>;

/** A portfolio stream order update: an order row plus `update_type`, `user_id` and `instrument_key`. */
export const UpstoxOrderUpdateSchema = UpstoxOrderSchema.extend({
  update_type: z.literal("order"),
  user_id: z.string().nullish(),
  userId: z.string().nullish(),
  instrument_key: z.string().nullish(),
});
export type UpstoxOrderUpdate = z.infer<typeof UpstoxOrderUpdateSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Portfolio

export const UpstoxPositionSchema = z.looseObject({
  exchange: z.string().nullish(),
  multiplier: z.number().nullish(),
  value: z.number().nullish(),
  pnl: z.number().nullish(),
  product: z.string(),
  instrument_token: z.string().min(1),
  average_price: z.number().nullish(),
  buy_value: z.number().nullish(),
  overnight_quantity: z.number().nullish(),
  day_buy_value: z.number().nullish(),
  day_buy_price: z.number().nullish(),
  overnight_buy_amount: z.number().nullish(),
  overnight_buy_quantity: z.number().nullish(),
  day_buy_quantity: z.number().nullish(),
  day_sell_value: z.number().nullish(),
  day_sell_price: z.number().nullish(),
  overnight_sell_amount: z.number().nullish(),
  overnight_sell_quantity: z.number().nullish(),
  day_sell_quantity: z.number().nullish(),
  quantity: z.number(),
  last_price: z.number().nullish(),
  unrealised: z.number().nullish(),
  realised: z.number().nullish(),
  sell_value: z.number().nullish(),
  trading_symbol: z.string().nullish(),
  close_price: z.number().nullish(),
  buy_price: z.number().nullish(),
  sell_price: z.number().nullish(),
});
export type UpstoxPosition = z.infer<typeof UpstoxPositionSchema>;

export const UpstoxHoldingSchema = z.looseObject({
  isin: z.string().nullish(),
  cnc_used_quantity: z.number().nullish(),
  collateral_type: z.string().nullish(),
  company_name: z.string().nullish(),
  haircut: z.number().nullish(),
  product: z.string().nullish(),
  quantity: z.number(),
  trading_symbol: z.string().nullish(),
  tradingsymbol: z.string().nullish(),
  last_price: z.number().nullish(),
  close_price: z.number().nullish(),
  pnl: z.number().nullish(),
  day_change: z.number().nullish(),
  day_change_percentage: z.number().nullish(),
  instrument_token: z.string().min(1),
  average_price: z.number(),
  collateral_quantity: z.number().nullish(),
  collateral_update_quantity: z.number().nullish(),
  t1_quantity: z.number().nullish(),
  exchange: z.string().nullish(),
});
export type UpstoxHolding = z.infer<typeof UpstoxHoldingSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Historical candles (V3)

/** `[timestamp, open, high, low, close, volume, open_interest]`; the timestamp is ISO 8601 with +05:30. */
export const UpstoxCandleSchema = z
  .tuple([z.string(), z.number(), z.number(), z.number(), z.number(), z.number()])
  .rest(z.number());
export type UpstoxCandle = z.infer<typeof UpstoxCandleSchema>;

/** `data` of historical and intraday candles. Newest first. */
export const UpstoxCandlesSchema = z.looseObject({ candles: z.array(UpstoxCandleSchema) });

// ---------------------------------------------------------------------------------------------------------------------
// Instrument master (complete.json.gz)

/**
 * One instrument. Quirks: `tick_size` is in paise (5.0 = ₹0.05); `expiry` is epoch milliseconds at 23:59:59 IST of
 * the expiry day; `freeze_quantity` is a float; `strike_price` is 0.0 on futures.
 */
export const UpstoxInstrumentSchema = z.looseObject({
  segment: z.string(),
  name: z.string().nullish(),
  exchange: z.string().nullish(),
  isin: z.string().nullish(),
  instrument_type: z.string().nullish(),
  instrument_key: z.string().min(1),
  lot_size: z.number().nullish(),
  freeze_quantity: z.number().nullish(),
  exchange_token: z.union([z.string(), z.number()]).nullish(),
  tick_size: z.number().nullish(),
  trading_symbol: z.string().nullish(),
  short_name: z.string().nullish(),
  security_type: z.string().nullish(),
  expiry: z.number().nullish(),
  weekly: z.boolean().nullish(),
  underlying_symbol: z.string().nullish(),
  underlying_key: z.string().nullish(),
  underlying_type: z.string().nullish(),
  strike_price: z.number().nullish(),
  minimum_lot: z.number().nullish(),
  qty_multiplier: z.number().nullish(),
});
export type UpstoxInstrument = z.infer<typeof UpstoxInstrumentSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Feeds

/** `data` of both feed authorize endpoints. `authorizedRedirectUri` is the deprecated duplicate. */
export const UpstoxFeedAuthorizeSchema = z.looseObject({
  authorized_redirect_uri: z.string().regex(/^wss:\/\//, "Expected a wss:// URL"),
  authorizedRedirectUri: z.string().nullish(),
});

/** Market feed V3 request; sent as a BINARY frame (UTF-8 JSON), never as text. */
export interface UpstoxFeedRequest {
  readonly guid: string;
  readonly method: UpstoxFeedMethod;
  readonly data: { readonly mode?: UpstoxFeedMode; readonly instrumentKeys: readonly string[] };
}

/** Decoded `LTPC` (protobuf int64 fields decoded as numbers). Proto3 omits zero values. */
export interface UpstoxLtpc {
  readonly ltp?: number;
  /** Last trade time, epoch milliseconds. */
  readonly ltt?: number;
  readonly ltq?: number;
  /** Previous close. */
  readonly cp?: number;
}

export interface UpstoxQuote {
  readonly bidQ?: number;
  readonly bidP?: number;
  readonly askQ?: number;
  readonly askP?: number;
}

export interface UpstoxOptionGreeks {
  readonly delta?: number;
  readonly theta?: number;
  readonly gamma?: number;
  readonly vega?: number;
  readonly rho?: number;
}

export interface UpstoxOhlc {
  /** "1d", "I1", "I30", ... */
  readonly interval?: string;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly vol?: number;
  readonly ts?: number;
}

export interface UpstoxMarketFullFeed {
  readonly ltpc?: UpstoxLtpc;
  readonly marketLevel?: { readonly bidAskQuote?: readonly UpstoxQuote[] };
  readonly optionGreeks?: UpstoxOptionGreeks;
  readonly marketOHLC?: { readonly ohlc?: readonly UpstoxOhlc[] };
  readonly atp?: number;
  /** Volume traded today. */
  readonly vtt?: number;
  readonly oi?: number;
  readonly iv?: number;
  readonly tbq?: number;
  readonly tsq?: number;
}

export interface UpstoxIndexFullFeed {
  readonly ltpc?: UpstoxLtpc;
  readonly marketOHLC?: { readonly ohlc?: readonly UpstoxOhlc[] };
}

export interface UpstoxFirstLevelWithGreeks {
  readonly ltpc?: UpstoxLtpc;
  readonly firstDepth?: UpstoxQuote;
  readonly optionGreeks?: UpstoxOptionGreeks;
  readonly vtt?: number;
  readonly oi?: number;
  readonly iv?: number;
}

export interface UpstoxFeed {
  readonly ltpc?: UpstoxLtpc;
  readonly fullFeed?: { readonly marketFF?: UpstoxMarketFullFeed; readonly indexFF?: UpstoxIndexFullFeed };
  readonly firstLevelWithGreeks?: UpstoxFirstLevelWithGreeks;
  readonly requestMode?: string;
}

/** Decoded `FeedResponse`. A missing `type` is `initial_feed` (proto3 default). */
export interface UpstoxFeedResponse {
  readonly type?: "initial_feed" | "live_feed" | "market_info";
  readonly feeds?: Readonly<Record<string, UpstoxFeed>>;
  readonly currentTs?: number;
  readonly marketInfo?: { readonly segmentStatus?: Readonly<Record<string, string>> };
}
