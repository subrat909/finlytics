/**
 * Dhan ↔ normalised models. Pure functions: numbers become decimal strings once, IST wall-clock times become ISO
 * timestamps with `+05:30`, Dhan's codes become our enums, and `(exchangeSegment, securityId)` becomes an
 * `instrumentKey` through the {@link DhanInstrumentMap} (or, when the map hasn't seen it, from the row's own symbol
 * and derivative fields).
 */
import { EXCHANGES, formatInstrumentKey, parseInstrumentKey, toDecimalString } from "@finlytics/shared";
import type { Exchange, InstrumentKey, OrderType, ParsedInstrumentKey, ProductType, Validity } from "@finlytics/shared";

import { BrokerInputError, BrokerInternalError } from "../../errors";
import type {
  BrokerHolding,
  BrokerOrder,
  BrokerOrderStatus,
  BrokerPosition,
  BrokerTrade,
  Candle,
  Funds,
  OrderSide,
  Profile,
  Timeframe,
} from "../../models";
import { OrderTagSchema } from "../../models";

import { dhanDate, tokenForDhanSegment } from "./instruments";
import type { DhanInstrumentMap } from "./instruments";
import type {
  DhanCandles,
  DhanExchangeSegment,
  DhanFundLimit,
  DhanHolding,
  DhanIntradayInterval,
  DhanOrder,
  DhanOrderAlertData,
  DhanOrderType,
  DhanPosition,
  DhanProductType,
  DhanProfile,
} from "./types";

const BROKER = "DHAN" as const;
const IST_OFFSET_MS = 19_800_000; // +05:30
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------------------------------
// Numbers and times

/** A broker number as a decimal string (≤ 4 decimals), or undefined when it isn't a finite number. */
export function decimalOf(value: number | null | undefined): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  return toDecimalString(value.toFixed(4));
}

/** A money amount; 0 when missing. */
export function moneyOf(value: number | null | undefined): string {
  return decimalOf(value) ?? "0";
}

/** A price above 0, else undefined (Dhan sends 0 for "no price"). */
export function positivePriceOf(value: number | null | undefined): string | undefined {
  return value !== undefined && value !== null && value > 0 ? decimalOf(value) : undefined;
}

/** A non-negative integer (quantities); 0 when missing or negative. */
export function intOf(value: number | null | undefined): number {
  return value === undefined || value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.trunc(value));
}

/** `YYYY-MM-DD HH:mm:ss` (IST wall clock) → ISO 8601 with `+05:30`; undefined for anything else or year 1. */
export function istToIso(text: string | null | undefined): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(text?.trim() ?? "");
  if (match === null || match[1]?.startsWith("0001") === true) return undefined;
  return `${match[1] ?? ""}T${match[2] ?? ""}+05:30`;
}

const YMD_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const DMY_TIME = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const EPOCH = /^\d{9,13}$/;

/** `Z`, `+05:30` or `-0400` → milliseconds east of UTC; none → IST (Dhan's wall clock). */
function offsetMs(zone: string | undefined): number {
  if (zone === undefined) return IST_OFFSET_MS;
  if (zone.toUpperCase() === "Z") return 0;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
}

/**
 * A Dhan validity time → Date. Reads `tokenValidity` (`DD/MM/YYYY HH:mm`, also with seconds or `-`), `expiryTime`
 * (`YYYY-MM-DDTHH:mm:ss.SSS`), both as IST unless they carry an offset, and epoch seconds or milliseconds (number or
 * digits). Undefined for anything else, a date without a time, or a year before 2000.
 */
export function istToDate(value: unknown): Date | undefined {
  if (typeof value === "number" || (typeof value === "string" && EPOCH.test(value.trim()))) {
    const epoch = Number(typeof value === "string" ? value.trim() : value);
    if (!Number.isFinite(epoch) || epoch < 946_684_800) return undefined; // before 2000
    return new Date(epoch < 1e11 ? epoch * 1000 : epoch);
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const ymd = YMD_TIME.exec(text);
  const dmy = ymd === null ? DMY_TIME.exec(text) : null;
  const parts =
    ymd !== null ? ymd.slice(1, 7) : dmy !== null ? [dmy[3], dmy[2], dmy[1], ...dmy.slice(4, 7)] : undefined;
  if (parts === undefined) return undefined;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts.map((part) => Number(part ?? 0));
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs(ymd?.[7]));
}

/** The IST wall clock of a Date: `YYYY-MM-DD HH:mm:ss`. */
export function istWallClock(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/** The IST calendar date of a Date: `YYYY-MM-DD`. */
export function istDate(date: Date): string {
  return istWallClock(date).slice(0, 10);
}

/** A JWT's claims (Dhan's access tokens are JWTs: `exp`, `dhanClientId`, ...); undefined when they can't be read. */
function jwtClaims(token: string): Readonly<Record<string, unknown>> | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined || payload === "") return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A JWT's `exp` claim as a Date; undefined when it can't be read. */
export function jwtExpiry(token: string): Date | undefined {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000) : undefined;
}

/** The `dhanClientId` claim of a Dhan token (a string or a number), trimmed; undefined when absent. */
export function jwtClientId(token: string): string | undefined {
  const id = jwtClaims(token)?.dhanClientId;
  const text =
    typeof id === "number" && Number.isSafeInteger(id) ? String(id) : typeof id === "string" ? id.trim() : "";
  return text === "" ? undefined : text;
}

/**
 * The pasted token, cleaned of what a copy-paste brings along: surrounding whitespace and quotes, a `Bearer ` or
 * `access-token:` prefix, and line breaks inside it.
 */
export function cleanToken(text: string | undefined): string {
  const unquote = (value: string): string => value.replace(/^["'`]+|["'`]+$/g, "").trim();
  const collapsed = unquote((text ?? "").replace(/\s+/g, " ").trim());
  return unquote(collapsed.replace(/^(?:access[-_ ]?token\s*[:=]|bearer\s)\s*/i, "")).replace(/\s+/g, "");
}

const TOKEN_KEYS = ["accessToken", "access_token", "token", "newToken", "jwtToken"] as const;
const EXPIRY_KEYS = ["expiryTime", "expiry_time", "tokenValidity", "expiresAt", "expiry"] as const;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * The new token in a RenewToken answer, whose shape the docs don't show: `{ accessToken, expiryTime }` (like
 * generateAccessToken), snake case, inside `data`, or the bare token as JSON string or text. Undefined without one.
 */
export function renewedToken(body: unknown): { readonly token: string; readonly expiry?: unknown } | undefined {
  if (typeof body === "string") {
    const token = cleanToken(body);
    return JWT.test(token) ? { token } : undefined;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const record = body as Readonly<Record<string, unknown>>;
  for (const source of [record, record.data]) {
    if (typeof source !== "object" || source === null || Array.isArray(source)) continue;
    const fields = source as Readonly<Record<string, unknown>>;
    const token = TOKEN_KEYS.map((key) => fields[key]).find(
      (value) => typeof value === "string" && value.trim() !== "",
    );
    if (typeof token !== "string") continue;
    const expiry = EXPIRY_KEYS.map((key) => fields[key]).find((value) => value !== undefined && value !== null);
    return { token: cleanToken(token), ...(expiry === undefined ? {} : { expiry }) };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Enums

const ORDER_TYPE_TO_DHAN: Readonly<Record<OrderType, DhanOrderType>> = Object.freeze({
  MARKET: "MARKET",
  LIMIT: "LIMIT",
  SL: "STOP_LOSS",
  SL_M: "STOP_LOSS_MARKET",
});

/** Order book names and order update codes → our order type. */
const ORDER_TYPE_FROM_DHAN: Readonly<Record<string, OrderType>> = Object.freeze({
  MARKET: "MARKET",
  MKT: "MARKET",
  LIMIT: "LIMIT",
  LMT: "LIMIT",
  STOP_LOSS: "SL",
  SL: "SL",
  STOP_LOSS_MARKET: "SL_M",
  SLM: "SL_M",
});

/** Order book names and order update codes (C, I, M, F, V, B) → our product. MTF reads as MARGIN. */
const PRODUCT_FROM_DHAN: Readonly<Record<string, ProductType>> = Object.freeze({
  CNC: "DELIVERY",
  C: "DELIVERY",
  INTRADAY: "INTRADAY",
  I: "INTRADAY",
  MARGIN: "MARGIN",
  M: "MARGIN",
  MTF: "MARGIN",
  F: "MARGIN",
  CO: "CO",
  V: "CO",
  BO: "BO",
  B: "BO",
});

const STATUS_FROM_DHAN: Readonly<Record<string, BrokerOrderStatus>> = Object.freeze({
  TRANSIT: "PENDING",
  PENDING: "OPEN",
  TRIGGERED: "OPEN",
  PART_TRADED: "PARTIALLY_FILLED",
  TRADED: "FILLED",
  CLOSED: "FILLED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
});

export function toDhanOrderType(type: OrderType): DhanOrderType {
  return ORDER_TYPE_TO_DHAN[type];
}

/**
 * Our product → Dhan's. DELIVERY is CNC for cash and MARGIN (carry forward) for F&O, which has no CNC at Dhan. CO
 * and BO need stop-loss and target legs the normalised order doesn't carry, so they are refused before the broker.
 */
export function toDhanProduct(product: ProductType, key: ParsedInstrumentKey): DhanProductType {
  if (product === "CO" || product === "BO") {
    throw new BrokerInputError(`Dhan ${product} orders are not supported`, { broker: BROKER, operation: "placeOrder" });
  }
  if (product === "DELIVERY") return key.segment === "EQ" ? "CNC" : "MARGIN";
  return product;
}

function orderTypeOf(text: string): OrderType {
  return ORDER_TYPE_FROM_DHAN[text.toUpperCase()] ?? "LIMIT";
}

function productOf(text: string): ProductType {
  return PRODUCT_FROM_DHAN[text.toUpperCase()] ?? "INTRADAY";
}

function statusOf(text: string): BrokerOrderStatus {
  return STATUS_FROM_DHAN[text.trim().toUpperCase()] ?? "PENDING";
}

function validityOf(text: string | null | undefined): Validity {
  return text?.toUpperCase() === "IOC" ? "IOC" : "DAY";
}

function sideOf(text: string): OrderSide {
  const upper = text.toUpperCase();
  return upper === "SELL" || upper === "S" ? "SELL" : "BUY";
}

function tagOf(correlationId: string | null | undefined): string | undefined {
  return OrderTagSchema.safeParse(correlationId).success ? (correlationId ?? undefined) : undefined;
}

function messageOf(...texts: (string | null | undefined)[]): string | undefined {
  for (const text of texts) {
    const trimmed = text?.trim();
    if (trimmed !== undefined && trimmed !== "") return trimmed.slice(0, 500);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instruments

/** The derivative fields Dhan repeats on orders, positions and order updates. */
export interface DhanInstrumentHints {
  readonly tradingSymbol?: string | null | undefined;
  readonly expiry?: string | null | undefined;
  readonly optionType?: string | null | undefined;
  readonly strike?: number | null | undefined;
}

const OPTION_TYPES: Readonly<Record<string, "CE" | "PE">> = Object.freeze({
  CALL: "CE",
  CE: "CE",
  PUT: "PE",
  PE: "PE",
});

/** A key from the row itself, for instruments the map doesn't know (equity by symbol, F&O by its derivative fields). */
function derivedKey(segment: string, hints: DhanInstrumentHints): InstrumentKey | undefined {
  const token = tokenForDhanSegment(segment);
  const symbol = (hints.tradingSymbol ?? "").trim().toUpperCase();
  if (token === undefined || symbol === "") return undefined;
  try {
    if (token === "NSE_EQ" || token === "BSE_EQ") return formatInstrumentKey({ segment: "EQ", token, symbol });
    const underlying = (symbol.split("-")[0] ?? "").trim();
    const expiry = dhanDate(hints.expiry);
    if (expiry === undefined) return undefined;
    const optionType = OPTION_TYPES[(hints.optionType ?? "").toUpperCase()];
    const strike = hints.strike ?? 0;
    if (optionType !== undefined && strike > 0) {
      const strikeText = toDecimalString(strike.toFixed(4));
      return formatInstrumentKey({ segment: "OPT", token, symbol: underlying, expiry, strike: strikeText, optionType });
    }
    return formatInstrumentKey({ segment: "FUT", token, symbol: underlying, expiry });
  } catch {
    return undefined;
  }
}

/** The canonical key of a Dhan instrument from the map, else from the row itself; undefined when neither knows it. */
export function keyOf(
  map: DhanInstrumentMap,
  segment: string,
  securityId: string,
  hints: DhanInstrumentHints = {},
): InstrumentKey | undefined {
  return map.keyOf(segment, securityId) ?? derivedKey(segment, hints);
}

/**
 * The canonical key of a Dhan instrument.
 *
 * @throws {BrokerInternalError} when neither the map nor the row identifies it (sync the instrument master).
 */
export function resolveKey(
  map: DhanInstrumentMap,
  segment: string,
  securityId: string,
  hints: DhanInstrumentHints = {},
): InstrumentKey {
  const key = keyOf(map, segment, securityId, hints);
  if (key === undefined) {
    throw new BrokerInternalError(`Dhan instrument ${segment}:${securityId} is unknown; sync the instrument master`, {
      broker: BROKER,
    });
  }
  return key;
}

/** Holdings say `exchange: "ALL"` with no segment: try NSE, then BSE, then the symbol. */
function holdingKey(map: DhanInstrumentMap, holding: DhanHolding): InstrumentKey | undefined {
  const exchange = holding.exchange?.toUpperCase();
  const segments: DhanExchangeSegment[] = exchange === "BSE" ? ["BSE_EQ", "NSE_EQ"] : ["NSE_EQ", "BSE_EQ"];
  for (const segment of segments) {
    const key = map.keyOf(segment, holding.securityId);
    if (key !== undefined) return key;
  }
  return keyOf(map, segments[0] ?? "NSE_EQ", holding.securityId, { tradingSymbol: holding.tradingSymbol });
}

/** The key of an order book row, without throwing (rows we can't identify are left out of the book). */
export function orderKeyOf(map: DhanInstrumentMap, order: DhanOrder): InstrumentKey | undefined {
  return keyOf(map, order.exchangeSegment, order.securityId, {
    tradingSymbol: order.tradingSymbol,
    expiry: order.drvExpiryDate,
    optionType: order.drvOptionType,
    strike: order.drvStrikePrice,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Responses

/** `activeSegment` ("Equity, Derivative, Currency, Commodity") → our exchanges. */
export function toProfile(profile: DhanProfile): Profile {
  const active = (profile.activeSegment ?? "").toLowerCase();
  const exchanges = new Set<Exchange>();
  if (active.includes("equity")) for (const exchange of ["NSE", "BSE"] as const) exchanges.add(exchange);
  if (active.includes("derivative")) for (const exchange of ["NFO", "BFO"] as const) exchanges.add(exchange);
  if (active.includes("currency")) exchanges.add("CDS");
  if (active.includes("commodity")) exchanges.add("MCX");
  return {
    brokerClientId: profile.dhanClientId,
    // The profile API returns no name; never put the client id (PII) in the display name.
    name: "Dhan account",
    exchanges: EXCHANGES.filter((exchange) => exchanges.has(exchange)),
  };
}

/** `availabelBalance` (sic) is what new orders can use; `utilizedAmount` the day's margin use. */
export function toFunds(funds: DhanFundLimit): Funds {
  return {
    availableMargin: moneyOf(funds.availabelBalance ?? funds.availableBalance),
    usedMargin: moneyOf(funds.utilizedAmount),
    collateral: moneyOf(funds.collateralAmount),
    ...(funds.withdrawableBalance === undefined ? {} : { withdrawable: moneyOf(funds.withdrawableBalance) }),
  };
}

export function toBrokerOrder(map: DhanInstrumentMap, order: DhanOrder, now: () => Date): BrokerOrder {
  const type = orderTypeOf(order.orderType);
  const quantity = intOf(order.quantity);
  const filled =
    order.filledQty === undefined
      ? Math.max(0, quantity - intOf(order.remainingQuantity ?? quantity))
      : intOf(order.filledQty);
  const qty = Math.max(1, quantity, filled);
  const price = type === "LIMIT" || type === "SL" ? positivePriceOf(order.price) : undefined;
  const triggerPrice = type === "SL" || type === "SL_M" ? positivePriceOf(order.triggerPrice) : undefined;
  const averagePrice = positivePriceOf(order.averageTradedPrice);
  const status = statusOf(order.orderStatus);
  const statusMessage = messageOf(order.omsErrorDescription);
  const tag = tagOf(order.correlationId);
  const placedAt = istToIso(order.createTime) ?? istToIso(order.exchangeTime) ?? now().toISOString();
  return {
    brokerOrderId: order.orderId,
    instrumentKey: resolveKey(map, order.exchangeSegment, order.securityId, {
      tradingSymbol: order.tradingSymbol,
      expiry: order.drvExpiryDate,
      optionType: order.drvOptionType,
      strike: order.drvStrikePrice,
    }),
    side: sideOf(order.transactionType),
    type,
    product: productOf(order.productType),
    validity: validityOf(order.validity),
    qty,
    filledQty: Math.min(filled, qty),
    ...(price === undefined ? {} : { price }),
    ...(triggerPrice === undefined ? {} : { triggerPrice }),
    ...(averagePrice === undefined ? {} : { averagePrice }),
    status,
    ...(statusMessage === undefined ? {} : { statusMessage }),
    ...(tag === undefined ? {} : { tag }),
    placedAt,
    updatedAt: istToIso(order.updateTime) ?? placedAt,
  };
}

/** A position row; undefined when neither the map nor the row identifies the instrument (the row is left out). */
export function toBrokerPosition(map: DhanInstrumentMap, position: DhanPosition): BrokerPosition | undefined {
  const buyQty = intOf(position.buyQty);
  const sellQty = intOf(position.sellQty);
  const unrealised = decimalOf(position.unrealizedProfit);
  const instrumentKey = keyOf(map, position.exchangeSegment, position.securityId, {
    tradingSymbol: position.tradingSymbol,
    expiry: position.drvExpiryDate,
    optionType: position.drvOptionType,
    strike: position.drvStrikePrice,
  });
  if (instrumentKey === undefined) return undefined;
  return {
    instrumentKey,
    product: productOf(position.productType),
    netQty: buyQty - sellQty,
    buyQty,
    sellQty,
    buyAvg: decimalOf(Math.max(0, position.buyAvg)) ?? "0",
    sellAvg: decimalOf(Math.max(0, position.sellAvg)) ?? "0",
    realisedPnl: moneyOf(position.realizedProfit),
    ...(unrealised === undefined ? {} : { unrealisedPnl: unrealised }),
  };
}

/**
 * `qty` is `totalQty` (delivered + T1); `t1Qty` is the undelivered part. Undefined when the instrument can't be
 * identified (the row is left out).
 */
export function toBrokerHolding(map: DhanInstrumentMap, holding: DhanHolding): BrokerHolding | undefined {
  const t1 = intOf(holding.t1Qty);
  const instrumentKey = holdingKey(map, holding);
  if (instrumentKey === undefined) return undefined;
  return {
    instrumentKey,
    qty: intOf(holding.totalQty),
    ...(t1 > 0 ? { t1Qty: t1 } : {}),
    avgPrice: decimalOf(Math.max(0, holding.avgCostPrice)) ?? "0",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Order updates (live order update socket)

const ALERT_SEGMENTS: Readonly<Record<string, DhanExchangeSegment>> = Object.freeze({
  "NSE:E": "NSE_EQ",
  "NSE:D": "NSE_FNO",
  "NSE:C": "NSE_CURRENCY",
  "BSE:E": "BSE_EQ",
  "BSE:D": "BSE_FNO",
  "BSE:C": "BSE_CURRENCY",
  "MCX:M": "MCX_COMM",
});

/** An order update's `Exchange` + `Segment` letter → Dhan's exchange segment. */
export function alertSegment(data: DhanOrderAlertData): string {
  return ALERT_SEGMENTS[`${data.Exchange.toUpperCase()}:${data.Segment.toUpperCase()}`] ?? data.Segment;
}

export function alertToOrder(map: DhanInstrumentMap, data: DhanOrderAlertData, now: () => Date): BrokerOrder {
  return toBrokerOrder(
    map,
    {
      orderId: data.OrderNo,
      correlationId: data.CorrelationId,
      orderStatus: data.Status,
      transactionType: sideOf(data.TxnType),
      exchangeSegment: alertSegment(data),
      productType: data.Product,
      orderType: data.OrderType,
      validity: data.Validity,
      tradingSymbol: data.Symbol,
      securityId: data.SecurityId,
      quantity: data.Quantity,
      price: data.Price,
      triggerPrice: data.TriggerPrice,
      createTime: data.OrderDateTime,
      updateTime: data.LastUpdatedTime,
      drvExpiryDate: data.ExpiryDate,
      drvOptionType: data.OptType,
      drvStrikePrice: data.StrikePrice,
      omsErrorDescription: statusOf(data.Status) === "REJECTED" ? (data.ReasonDescription ?? data.Remarks) : undefined,
      remainingQuantity: data.RemainingQuantity,
      averageTradedPrice: data.AvgTradedPrice,
      filledQty: data.TradedQty,
    },
    now,
  );
}

/**
 * A fill derived from an order update whose traded quantity grew. Dhan's update carries no exchange trade id, so the
 * id is `<OrderNo>-<cumulative traded qty>`: stable, so a replay after a reconnect dedupes downstream.
 */
export function alertToTrade(
  order: BrokerOrder,
  data: DhanOrderAlertData,
  previousFilled: number,
): BrokerTrade | undefined {
  const qty = order.filledQty - previousFilled;
  const price = positivePriceOf(data.TradedPrice) ?? order.averagePrice;
  if (qty <= 0 || price === undefined) return undefined;
  return {
    brokerTradeId: `${order.brokerOrderId}-${String(order.filledQty)}`,
    brokerOrderId: order.brokerOrderId,
    instrumentKey: order.instrumentKey,
    side: order.side,
    product: order.product,
    qty,
    price,
    executedAt: order.updatedAt,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Candles

/** How a timeframe is fetched: the daily endpoint, or an intraday interval aggregated `factor` times. */
export interface CandlePlan {
  readonly daily: boolean;
  readonly interval: DhanIntradayInterval;
  readonly factor: number;
  readonly bucketMs: number;
}

/** Dhan's intervals are 1, 5, 15, 25 and 60 minutes: M3 is built from M1 and M30 from M15. */
const CANDLE_PLANS: Readonly<Record<Timeframe, CandlePlan>> = Object.freeze({
  M1: { daily: false, interval: "1", factor: 1, bucketMs: 60_000 },
  M3: { daily: false, interval: "1", factor: 3, bucketMs: 180_000 },
  M5: { daily: false, interval: "5", factor: 1, bucketMs: 300_000 },
  M15: { daily: false, interval: "15", factor: 1, bucketMs: 900_000 },
  M30: { daily: false, interval: "15", factor: 2, bucketMs: 1_800_000 },
  H1: { daily: false, interval: "60", factor: 1, bucketMs: 3_600_000 },
  D1: { daily: true, interval: "1", factor: 1, bucketMs: MS_PER_DAY },
});

export function candlePlan(timeframe: Timeframe): CandlePlan {
  return CANDLE_PLANS[timeframe];
}

/** Session open (IST) per segment token: buckets of aggregated candles start there. */
function sessionOpenMinutes(key: ParsedInstrumentKey): number {
  return key.token === "MCX_FO" || key.token === "NSE_CD" ? 9 * 60 : 9 * 60 + 15;
}

/** Dhan's parallel arrays → candles (epoch ms), dropping malformed entries. */
export function toCandles(data: DhanCandles): Candle[] {
  const candles: Candle[] = [];
  for (const [index, ts] of data.timestamp.entries()) {
    const open = decimalOf(data.open[index]);
    const high = decimalOf(data.high[index]);
    const low = decimalOf(data.low[index]);
    const close = decimalOf(data.close[index]);
    const oi = data.open_interest?.[index];
    if (open === undefined || high === undefined || low === undefined || close === undefined || !(ts >= 0)) continue;
    if ([open, high, low, close].some((price) => price.startsWith("-"))) continue;
    const [lowN, highN] = [Number(low), Number(high)];
    if ([open, close].some((price) => Number(price) < lowN || Number(price) > highN)) continue;
    candles.push({
      ts: Math.trunc(ts) * 1000,
      open,
      high,
      low,
      close,
      volume: intOf(data.volume[index]),
      ...(oi !== undefined && oi > 0 ? { oi: intOf(oi) } : {}),
    });
  }
  return candles;
}

/** Merges consecutive candles into `bucketMs` buckets aligned to the IST session open (M3 from M1, M30 from M15). */
export function aggregateCandles(candles: readonly Candle[], bucketMs: number, key: ParsedInstrumentKey): Candle[] {
  const openOffsetMs = sessionOpenMinutes(key) * 60_000;
  const out: Candle[] = [];
  for (const candle of candles) {
    const istDayStart = Math.floor((candle.ts + IST_OFFSET_MS) / MS_PER_DAY) * MS_PER_DAY - IST_OFFSET_MS;
    const session = istDayStart + openOffsetMs;
    const bucket = session + Math.floor((candle.ts - session) / bucketMs) * bucketMs;
    const last = out.at(-1);
    if (last?.ts !== bucket) {
      out.push({ ...candle, ts: bucket });
      continue;
    }
    const high = Number(candle.high) > Number(last.high) ? candle.high : last.high;
    const low = Number(candle.low) < Number(last.low) ? candle.low : last.low;
    out[out.length - 1] = {
      ts: bucket,
      open: last.open,
      high,
      low,
      close: candle.close,
      volume: last.volume + candle.volume,
      ...(candle.oi === undefined ? (last.oi === undefined ? {} : { oi: last.oi }) : { oi: candle.oi }),
    };
  }
  return out;
}

/** Sorted, de-duplicated (last wins), and within `[from, to)`. */
export function finaliseCandles(candles: readonly Candle[], from: Date, to: Date): Candle[] {
  const byTs = new Map<number, Candle>();
  for (const candle of candles) {
    if (candle.ts >= from.getTime() && candle.ts < to.getTime()) byTs.set(candle.ts, candle);
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

/** A key parsed, for code paths that already validated it. */
export function parsedKey(key: InstrumentKey): ParsedInstrumentKey {
  const parsed = parseInstrumentKey(key);
  if (!parsed.ok) throw new BrokerInputError(`Invalid instrument key: ${parsed.error.message}`, { broker: BROKER });
  return parsed.value;
}
