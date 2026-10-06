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

/** `YYYY-MM-DDTHH:mm:ss[.SSS]` read as IST → Date (`expiryTime`), or `DD/MM/YYYY HH:mm` (`tokenValidity`). */
export function istToDate(text: string | null | undefined): Date | undefined {
  const value = text?.trim() ?? "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(value);
  const parts =
    iso !== null
      ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]]
      : dmy !== null
        ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5]]
        : undefined;
  if (parts === undefined) return undefined;
  const [year, month, day, hour, minute, second] = parts.map((part) => Number(part ?? 0));
  const ms = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0) - IST_OFFSET_MS;
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

/** The IST wall clock of a Date: `YYYY-MM-DD HH:mm:ss`. */
export function istWallClock(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/** The IST calendar date of a Date: `YYYY-MM-DD`. */
export function istDate(date: Date): string {
  return istWallClock(date).slice(0, 10);
}

/** A JWT's `exp` claim as a Date (Dhan's access tokens are JWTs); undefined when it can't be read. */
export function jwtExpiry(token: string): Date | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined || payload === "") return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const exp = typeof claims === "object" && claims !== null ? (claims as { exp?: unknown }).exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000) : undefined;
  } catch {
    return undefined;
  }
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
  const key = map.keyOf(segment, securityId) ?? derivedKey(segment, hints);
  if (key === undefined) {
    throw new BrokerInternalError(`Dhan instrument ${segment}:${securityId} is unknown; sync the instrument master`, {
      broker: BROKER,
    });
  }
  return key;
}

/** Holdings say `exchange: "ALL"` with no segment: try NSE, then BSE, then the symbol. */
function holdingKey(map: DhanInstrumentMap, holding: DhanHolding): InstrumentKey {
  const exchange = holding.exchange?.toUpperCase();
  const segments: DhanExchangeSegment[] = exchange === "BSE" ? ["BSE_EQ", "NSE_EQ"] : ["NSE_EQ", "BSE_EQ"];
  for (const segment of segments) {
    const key = map.keyOf(segment, holding.securityId);
    if (key !== undefined) return key;
  }
  return resolveKey(map, segments[0] ?? "NSE_EQ", holding.securityId, { tradingSymbol: holding.tradingSymbol });
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

export function toFunds(funds: DhanFundLimit): Funds {
  return {
    availableMargin: moneyOf(funds.availabelBalance),
    usedMargin: moneyOf(funds.utilizedAmount),
    collateral: moneyOf(funds.collateralAmount),
    ...(funds.withdrawableBalance === undefined || funds.withdrawableBalance === null
      ? {}
      : { withdrawable: moneyOf(funds.withdrawableBalance) }),
  };
}

export function toBrokerOrder(map: DhanInstrumentMap, order: DhanOrder, now: () => Date): BrokerOrder {
  const type = orderTypeOf(order.orderType);
  const quantity = intOf(order.quantity);
  const filled =
    order.filledQty === undefined || order.filledQty === null
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

export function toBrokerPosition(map: DhanInstrumentMap, position: DhanPosition): BrokerPosition {
  const buyQty = intOf(position.buyQty);
  const sellQty = intOf(position.sellQty);
  const unrealised = decimalOf(position.unrealizedProfit);
  return {
    instrumentKey: resolveKey(map, position.exchangeSegment, position.securityId, {
      tradingSymbol: position.tradingSymbol,
      expiry: position.drvExpiryDate,
      optionType: position.drvOptionType,
      strike: position.drvStrikePrice,
    }),
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

/** `qty` is `totalQty` (delivered + T1); `t1Qty` is the undelivered part. */
export function toBrokerHolding(map: DhanInstrumentMap, holding: DhanHolding): BrokerHolding {
  const t1 = intOf(holding.t1Qty);
  return {
    instrumentKey: holdingKey(map, holding),
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
