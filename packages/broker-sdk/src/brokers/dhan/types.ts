/**
 * DhanHQ v2 wire types, copied from the official docs (https://dhanhq.co/docs/v2/, re-read 2026-10-06). Field names,
 * enum values and URLs are exactly Dhan's, typos included (`availabelBalance`, `receiveableAmount`). Responses are
 * untrusted: the zod schemas below check only the fields the adapter reads and let everything else through.
 *
 * Pages: authentication, orders, portfolio, funds, historical-data, instruments, live-market-feed, order-update,
 * annexure, releases.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Endpoints

/** REST base (docs: "Base URL https://api.dhan.co/v2/"). Headers: `access-token`, `Content-Type: application/json`. */
export const DHAN_API_BASE_URL = "https://api.dhan.co/v2";
/** Live market feed: `?version=2&token=<JWT>&clientId=<id>&authType=2` (the token rides in the query; Dhan's design). */
export const DHAN_FEED_URL = "wss://api-feed.dhan.co";
/** Live order update. Authorised by the first message ({@link DhanOrderUpdateLogin}). */
export const DHAN_ORDER_UPDATE_URL = "wss://api-order-update.dhan.co";
/** Instrument list, detailed CSV (no auth). The compact one is `api-scrip-master.csv`; the parser reads both. */
export const DHAN_SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";
export const DHAN_SCRIP_MASTER_COMPACT_URL = "https://images.dhan.co/api-data/api-scrip-master.csv";

export const DHAN_PATHS = Object.freeze({
  profile: "/profile",
  renewToken: "/RenewToken",
  fundLimit: "/fundlimit",
  orders: "/orders",
  positions: "/positions",
  holdings: "/holdings",
  chartsHistorical: "/charts/historical",
  chartsIntraday: "/charts/intraday",
} as const);

// ---------------------------------------------------------------------------------------------------------------------
// Annexure enums

/** Exchange segment attribute → the numeric enum used in feed packets (annexure "Exchange Segment"). */
export const DHAN_EXCHANGE_SEGMENT_CODES = Object.freeze({
  IDX_I: 0,
  NSE_EQ: 1,
  NSE_FNO: 2,
  NSE_CURRENCY: 3,
  BSE_EQ: 4,
  MCX_COMM: 5,
  BSE_CURRENCY: 7,
  BSE_FNO: 8,
} as const);
export type DhanExchangeSegment = keyof typeof DHAN_EXCHANGE_SEGMENT_CODES;
export const DHAN_EXCHANGE_SEGMENTS = Object.freeze(Object.keys(DHAN_EXCHANGE_SEGMENT_CODES) as DhanExchangeSegment[]);

export const DHAN_TRANSACTION_TYPES = Object.freeze(["BUY", "SELL"] as const);
export type DhanTransactionType = (typeof DHAN_TRANSACTION_TYPES)[number];

export const DHAN_PRODUCT_TYPES = Object.freeze(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"] as const);
export type DhanProductType = (typeof DHAN_PRODUCT_TYPES)[number];

export const DHAN_ORDER_TYPES = Object.freeze(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET"] as const);
export type DhanOrderType = (typeof DHAN_ORDER_TYPES)[number];

export const DHAN_VALIDITIES = Object.freeze(["DAY", "IOC"] as const);
export type DhanValidity = (typeof DHAN_VALIDITIES)[number];

/** Order book `orderStatus` plus the annexure's super-order states (CLOSED, TRIGGERED). */
export const DHAN_ORDER_STATUSES = Object.freeze([
  "TRANSIT",
  "PENDING",
  "CLOSED",
  "TRIGGERED",
  "REJECTED",
  "CANCELLED",
  "PART_TRADED",
  "TRADED",
  "EXPIRED",
] as const);
export type DhanOrderStatus = (typeof DHAN_ORDER_STATUSES)[number];

/** `drvOptionType` in the order book and positions. */
export const DHAN_DRV_OPTION_TYPES = Object.freeze(["CALL", "PUT"] as const);

/** Annexure "Instrument". */
export const DHAN_INSTRUMENTS = Object.freeze([
  "INDEX",
  "FUTIDX",
  "OPTIDX",
  "EQUITY",
  "FUTSTK",
  "OPTSTK",
  "FUTCOM",
  "OPTFUT",
  "FUTCUR",
  "OPTCUR",
] as const);
export type DhanInstrument = (typeof DHAN_INSTRUMENTS)[number];

/** Intraday chart intervals in minutes (sent as strings: `"interval": "1"`). */
export const DHAN_INTRADAY_INTERVALS = Object.freeze(["1", "5", "15", "25", "60"] as const);
export type DhanIntradayInterval = (typeof DHAN_INTRADAY_INTERVALS)[number];
/** "only 90 days of data can be polled at once" (intraday). */
export const DHAN_INTRADAY_MAX_DAYS = 90;

/** Feed request codes (annexure). Unsubscribe = subscribe + 1. */
export const DHAN_FEED_REQUEST = Object.freeze({
  CONNECT: 11,
  DISCONNECT: 12,
  SUBSCRIBE_TICKER: 15,
  UNSUBSCRIBE_TICKER: 16,
  SUBSCRIBE_QUOTE: 17,
  UNSUBSCRIBE_QUOTE: 18,
  SUBSCRIBE_FULL: 21,
  UNSUBSCRIBE_FULL: 22,
} as const);

/** Feed response codes (annexure): the first byte of every packet. */
export const DHAN_FEED_RESPONSE = Object.freeze({
  INDEX: 1,
  TICKER: 2,
  QUOTE: 4,
  OI: 5,
  PREV_CLOSE: 6,
  MARKET_STATUS: 7,
  FULL: 8,
  DISCONNECT: 50,
} as const);

/** "Maximum 100 instruments per single JSON subscribe message"; 5000 per connection; 5 connections per user. */
export const DHAN_FEED_MAX_PER_MESSAGE = 100;
export const DHAN_FEED_MAX_INSTRUMENTS = 5_000;

/**
 * Binary packet layouts (live-market-feed, little endian). Offsets are 0-based (the docs number bytes from 1).
 * Header: u8 response code, u16 message length, u8 exchange segment, u32 security id.
 */
export const DHAN_PACKET = Object.freeze({
  HEADER_BYTES: 8,
  /** Ticker (2), index (1, assumed: same layout) and prev close (6): f32 at 8, i32 at 12. */
  TICKER_BYTES: 16,
  OI_BYTES: 12,
  QUOTE_BYTES: 50,
  FULL_BYTES: 162,
  DISCONNECT_BYTES: 10,
  DEPTH_LEVELS: 5,
  DEPTH_LEVEL_BYTES: 20,
  FULL_DEPTH_OFFSET: 62,
} as const);

/** Trading API errors (annexure). */
export const DHAN_TRADING_ERRORS = Object.freeze({
  "DH-901": "Client ID or user generated access token is invalid or expired",
  "DH-902": "User has not subscribed to Data APIs or does not have access to Trading APIs",
  "DH-903": "Errors related to User's Account configuration",
  "DH-904": "Too many requests on server from single user breaching rate limits",
  "DH-905": "Missing required fields, bad parameter values",
  "DH-906": "Incorrect order request that cannot be processed",
  "DH-907": "System unable to fetch data due to incorrect parameters or no data",
  "DH-908": "Server was not able to process API request",
  "DH-909": "Network error preventing backend communication",
  "DH-910": "Error from other reasons",
} as const);

/** Data API errors (annexure): REST data APIs and the feed's disconnect packet. */
export const DHAN_DATA_ERRORS = Object.freeze({
  800: "Internal Server Error",
  804: "Requested number of instruments exceeds limit",
  805: "Too many requests or connections",
  806: "Data APIs not subscribed",
  807: "Access token is expired",
  808: "Authentication Failed - Client ID or Access Token invalid",
  809: "Access token is invalid",
  810: "Client ID is invalid",
  811: "Invalid Expiry Date",
  812: "Invalid Date Format",
  813: "Invalid SecurityId",
  814: "Invalid Request",
} as const);

// ---------------------------------------------------------------------------------------------------------------------
// Response schemas (only what the adapter reads)

/** A JSON number, or a numeric string (Dhan's examples mix both). */
export const DhanNumberSchema = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);
const OptionalNumber = DhanNumberSchema.nullish();
const OptionalString = z.string().nullish();

/** `{ errorType, errorCode, errorMessage }` on every failed REST call. */
export const DhanErrorBodySchema = z.looseObject({
  errorType: OptionalString,
  errorCode: z.union([z.string(), z.number()]).nullish(),
  errorMessage: OptionalString,
});
export type DhanErrorBody = z.infer<typeof DhanErrorBodySchema>;

/** GET /profile. `tokenValidity` is `DD/MM/YYYY HH:mm` (IST). */
export const DhanProfileSchema = z.looseObject({
  dhanClientId: z.string().min(1),
  tokenValidity: OptionalString,
  activeSegment: OptionalString,
  ddpi: OptionalString,
  mtf: OptionalString,
  dataPlan: OptionalString,
  dataValidity: OptionalString,
});
export type DhanProfile = z.infer<typeof DhanProfileSchema>;

/**
 * GET /RenewToken. The docs show no response body; this assumes the shape of `generateAccessToken` and the consent
 * APIs (`accessToken`, `expiryTime` as `YYYY-MM-DDTHH:mm:ss.SSS` IST).
 */
export const DhanTokenResponseSchema = z.looseObject({
  accessToken: z.string().min(1),
  expiryTime: OptionalString,
  dhanClientId: OptionalString,
});

/** GET /fundlimit. */
export const DhanFundLimitSchema = z.looseObject({
  dhanClientId: OptionalString,
  availabelBalance: DhanNumberSchema,
  sodLimit: OptionalNumber,
  collateralAmount: OptionalNumber,
  receiveableAmount: OptionalNumber,
  utilizedAmount: OptionalNumber,
  blockedPayoutAmount: OptionalNumber,
  withdrawableBalance: OptionalNumber,
});
export type DhanFundLimit = z.infer<typeof DhanFundLimitSchema>;

/** POST /orders body. */
export interface DhanPlaceOrderRequest {
  readonly dhanClientId: string;
  readonly correlationId?: string;
  readonly transactionType: DhanTransactionType;
  readonly exchangeSegment: DhanExchangeSegment;
  readonly productType: DhanProductType;
  readonly orderType: DhanOrderType;
  readonly validity: DhanValidity;
  readonly securityId: string;
  readonly quantity: number;
  readonly disclosedQuantity: number;
  readonly price: number;
  readonly triggerPrice: number;
  readonly afterMarketOrder: boolean;
}

/** PUT /orders/{order-id} body: Dhan wants the full order back, not a patch. */
export interface DhanModifyOrderRequest {
  readonly dhanClientId: string;
  readonly orderId: string;
  readonly orderType: DhanOrderType;
  readonly legName: string;
  readonly quantity: number;
  readonly price: number;
  readonly disclosedQuantity: number;
  readonly triggerPrice: number;
  readonly validity: DhanValidity;
}

/** POST, PUT and DELETE /orders answer `{ orderId, orderStatus }`. */
export const DhanOrderAckSchema = z.looseObject({
  orderId: z.union([z.string().min(1), z.number()]).transform(String),
  orderStatus: OptionalString,
});

/** One order book row (GET /orders, GET /orders/{order-id}). Times are `YYYY-MM-DD HH:mm:ss` IST. */
export const DhanOrderSchema = z.looseObject({
  dhanClientId: OptionalString,
  orderId: z.union([z.string().min(1), z.number()]).transform(String),
  correlationId: OptionalString,
  orderStatus: z.string(),
  transactionType: z.enum(DHAN_TRANSACTION_TYPES),
  exchangeSegment: z.string(),
  productType: z.string(),
  orderType: z.string(),
  validity: OptionalString,
  tradingSymbol: OptionalString,
  securityId: z.union([z.string(), z.number()]).transform(String),
  quantity: DhanNumberSchema,
  disclosedQuantity: OptionalNumber,
  price: OptionalNumber,
  triggerPrice: OptionalNumber,
  legName: OptionalString,
  createTime: OptionalString,
  updateTime: OptionalString,
  exchangeTime: OptionalString,
  drvExpiryDate: OptionalString,
  drvOptionType: OptionalString,
  drvStrikePrice: OptionalNumber,
  omsErrorCode: z.union([z.string(), z.number()]).nullish(),
  omsErrorDescription: OptionalString,
  remainingQuantity: OptionalNumber,
  averageTradedPrice: OptionalNumber,
  filledQty: OptionalNumber,
});
export type DhanOrder = z.infer<typeof DhanOrderSchema>;

/** GET /positions row. */
export const DhanPositionSchema = z.looseObject({
  tradingSymbol: OptionalString,
  securityId: z.union([z.string(), z.number()]).transform(String),
  positionType: OptionalString,
  exchangeSegment: z.string(),
  productType: z.string(),
  buyAvg: DhanNumberSchema,
  buyQty: DhanNumberSchema,
  sellAvg: DhanNumberSchema,
  sellQty: DhanNumberSchema,
  netQty: DhanNumberSchema,
  realizedProfit: DhanNumberSchema,
  unrealizedProfit: OptionalNumber,
  drvExpiryDate: OptionalString,
  drvOptionType: OptionalString,
  drvStrikePrice: OptionalNumber,
});
export type DhanPosition = z.infer<typeof DhanPositionSchema>;

/** GET /holdings row. `exchange` is `"ALL"` for a scrip held across NSE and BSE. */
export const DhanHoldingSchema = z.looseObject({
  exchange: OptionalString,
  tradingSymbol: z.string().min(1),
  securityId: z.union([z.string(), z.number()]).transform(String),
  isin: OptionalString,
  totalQty: DhanNumberSchema,
  dpQty: OptionalNumber,
  t1Qty: OptionalNumber,
  availableQty: OptionalNumber,
  collateralQty: OptionalNumber,
  avgCostPrice: DhanNumberSchema,
});
export type DhanHolding = z.infer<typeof DhanHoldingSchema>;

/** POST /charts/historical body (`toDate` exclusive, `YYYY-MM-DD`). */
export interface DhanHistoricalRequest {
  readonly securityId: string;
  readonly exchangeSegment: DhanExchangeSegment;
  readonly instrument: DhanInstrument;
  readonly expiryCode?: number;
  readonly oi: boolean;
  readonly fromDate: string;
  readonly toDate: string;
}

/** POST /charts/intraday body (`YYYY-MM-DD HH:mm:ss` IST, at most 90 days). */
export interface DhanIntradayRequest {
  readonly securityId: string;
  readonly exchangeSegment: DhanExchangeSegment;
  readonly instrument: DhanInstrument;
  readonly interval: DhanIntradayInterval;
  readonly oi: boolean;
  readonly fromDate: string;
  readonly toDate: string;
}

/** Both chart endpoints: parallel arrays; `timestamp` in epoch seconds. */
export const DhanCandlesSchema = z.looseObject({
  open: z.array(DhanNumberSchema),
  high: z.array(DhanNumberSchema),
  low: z.array(DhanNumberSchema),
  close: z.array(DhanNumberSchema),
  volume: z.array(DhanNumberSchema),
  timestamp: z.array(DhanNumberSchema),
  open_interest: z.array(DhanNumberSchema).nullish(),
});
export type DhanCandles = z.infer<typeof DhanCandlesSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// WebSockets

/** Feed subscribe/unsubscribe (≤ 100 instruments per message). */
export interface DhanFeedRequest {
  readonly RequestCode: number;
  readonly InstrumentCount: number;
  readonly InstrumentList: readonly { readonly ExchangeSegment: DhanExchangeSegment; readonly SecurityId: string }[];
}

/** First message on the order update socket (individual account). */
export interface DhanOrderUpdateLogin {
  readonly LoginReq: { readonly MsgCode: 42; readonly ClientId: string; readonly Token: string };
  readonly UserType: "SELF";
}

/**
 * Order update `Data` (Type `order_alert`). Codes: Product C (CNC), I (Intraday), M (Margin), F (MTF), V (CO), B (BO);
 * TxnType B/S; OrderType LMT/MKT/SL/SLM; Segment E/D/C/M; `Status` arrives in any case ("Cancelled").
 */
export const DhanOrderAlertDataSchema = z.looseObject({
  Exchange: z.string(),
  Segment: z.string(),
  SecurityId: z.union([z.string(), z.number()]).transform(String),
  ClientId: OptionalString,
  OrderNo: z.union([z.string().min(1), z.number()]).transform(String),
  Product: z.string(),
  TxnType: z.string(),
  OrderType: z.string(),
  Validity: OptionalString,
  Quantity: DhanNumberSchema,
  TradedQty: OptionalNumber,
  RemainingQuantity: OptionalNumber,
  Price: OptionalNumber,
  TriggerPrice: OptionalNumber,
  TradedPrice: OptionalNumber,
  AvgTradedPrice: OptionalNumber,
  OrderDateTime: OptionalString,
  LastUpdatedTime: OptionalString,
  Remarks: OptionalString,
  ReasonDescription: OptionalString,
  Instrument: OptionalString,
  Symbol: OptionalString,
  Status: z.string(),
  StrikePrice: OptionalNumber,
  ExpiryDate: OptionalString,
  OptType: OptionalString,
  CorrelationId: OptionalString,
});
export type DhanOrderAlertData = z.infer<typeof DhanOrderAlertDataSchema>;

export const DhanOrderUpdateMessageSchema = z.looseObject({
  Type: z.string(),
  Data: z.unknown(),
});
