/**
 * Pure mappings between Upstox's wire format (./types.ts) and the sdk's models: enums, IST timestamps, numbers to
 * decimal strings, instrument master rows to canonical keys, and decoded feed messages to ticks. No I/O.
 */
import {
  canonicalStrike,
  EXCHANGES,
  normalizeInstrumentKey,
  parseInstrumentKey,
  toDecimalString,
} from "@finlytics/shared";
import type {
  Exchange,
  InstrumentKey,
  OrderType,
  ProductType,
  Segment,
  SegmentToken,
  Validity,
} from "@finlytics/shared";
import Decimal from "decimal.js";

import { marketIndexAlias } from "../../index-aliases";
import type { MarketIndexAlias } from "../../index-aliases";
import type {
  BrokerHolding,
  BrokerOrder,
  BrokerOrderStatus,
  BrokerPosition,
  Candle,
  DepthLevel,
  FeedMode,
  Funds,
  InstrumentRow,
  OrderSide,
  Profile,
  Tick,
  Timeframe,
} from "../../models";
import { OrderTagSchema } from "../../models";

import { UPSTOX_CANDLE_HISTORY } from "./types";
import type {
  UpstoxCandle,
  UpstoxCandleUnit,
  UpstoxFeed,
  UpstoxFeedMode,
  UpstoxFunds,
  UpstoxHolding,
  UpstoxInstrument,
  UpstoxOptionGreeks,
  UpstoxOrder,
  UpstoxOrderStatus,
  UpstoxOrderType,
  UpstoxPosition,
  UpstoxProduct,
  UpstoxProfile,
  UpstoxQuote,
} from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Time (India has no DST: IST is always UTC+05:30)

export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/**
 * When an Upstox access token made at `now` stops working: 03:30 IST on the next occasion, i.e. the next day, or the
 * same day when the login happens between 00:00 and 03:30 IST (Get Token docs).
 */
export function upstoxTokenExpiry(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 3, 30) - IST_OFFSET_MS;
  return new Date(today > now.getTime() ? today : today + DAY_MS);
}

/** The IST calendar date (`YYYY-MM-DD`) of an instant. */
export function istDate(epochMs: number): string {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const IST_LOCAL_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

/** Upstox order times (`"2023-10-19 09:23:23"`, IST) as ISO 8601 with the offset. Empty or unknown forms: undefined. */
export function istTimestamp(text: string | null | undefined): string | undefined {
  const match = IST_LOCAL_TIMESTAMP.exec(text ?? "");
  return match === null ? undefined : `${match[1] ?? ""}T${match[2] ?? ""}+05:30`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbers

/** A JSON number as a canonical decimal string, at most 4 decimals (decimal.js reads the number's shortest form). */
export function decimalString(value: number): string {
  return toDecimalString(new Decimal(value));
}

/** A non-negative integer from a broker number (quantities, volume, OI). */
export function count(value: number | null | undefined): number {
  return value === undefined || value === null || !(value > 0) ? 0 : Math.round(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// Enums

/** The kind (Prisma segment) of a canonical key. */
export function segmentOf(key: InstrumentKey): Segment {
  const parsed = parseInstrumentKey(key);
  return parsed.ok ? parsed.value.segment : "EQ";
}

/**
 * Our product → Upstox's. Upstox `D` is delivery for equity and carry-forward (NRML) for derivatives, so MARGIN is `D`
 * on FUT/OPT and `MTF` on equity. Place accepts I, D and MTF only: CO and BO are undefined (not supported).
 */
export function toUpstoxProduct(product: ProductType, segment: Segment): UpstoxProduct | undefined {
  switch (product) {
    case "INTRADAY":
      return "I";
    case "DELIVERY":
      return "D";
    case "MARGIN":
      return segment === "FUT" || segment === "OPT" ? "D" : "MTF";
    default:
      return undefined;
  }
}

/** Upstox's product → ours (the inverse of {@link toUpstoxProduct}; `D` on derivatives is MARGIN). */
export function fromUpstoxProduct(product: string, segment: Segment): ProductType | undefined {
  switch (product) {
    case "I":
      return "INTRADAY";
    case "D":
      return segment === "FUT" || segment === "OPT" ? "MARGIN" : "DELIVERY";
    case "MTF":
      return "MARGIN";
    case "CO":
      return "CO";
    default:
      return undefined;
  }
}

export function toUpstoxOrderType(type: OrderType): UpstoxOrderType {
  return type === "SL_M" ? "SL-M" : type;
}

export function fromUpstoxOrderType(type: string): OrderType | undefined {
  if (type === "SL-M") return "SL_M";
  return type === "MARKET" || type === "LIMIT" || type === "SL" ? type : undefined;
}

function fromUpstoxSide(side: string): OrderSide | undefined {
  return side === "BUY" || side === "SELL" ? side : undefined;
}

export function fromUpstoxValidity(validity: string): Validity | undefined {
  return validity === "DAY" || validity === "IOC" ? validity : undefined;
}

/** Working statuses: OPEN, or PARTIALLY_FILLED once something filled. */
const LIVE = "LIVE";

const ORDER_STATUS: Readonly<Record<UpstoxOrderStatus, BrokerOrderStatus | typeof LIVE>> = Object.freeze({
  "put order req received": "PENDING",
  "validation pending": "PENDING",
  "open pending": "PENDING",
  "after market order req received": "PENDING",
  "modify after market order req received": "PENDING",
  open: LIVE,
  "trigger pending": LIVE,
  "modify pending": LIVE,
  "modify validation pending": LIVE,
  modified: LIVE,
  "not modified": LIVE,
  "cancel pending": LIVE,
  "not cancelled": LIVE,
  complete: "FILLED",
  cancelled: "CANCELLED",
  "cancelled after market order": "CANCELLED",
  rejected: "REJECTED",
});

/** Upstox's status text → ours. An unknown status is PENDING: not terminal, so the order is reconciled again. */
export function toOrderStatus(status: string, filledQty: number): BrokerOrderStatus {
  const mapped = Object.hasOwn(ORDER_STATUS, status) ? ORDER_STATUS[status as UpstoxOrderStatus] : "PENDING";
  if (mapped !== LIVE) return mapped;
  return filledQty > 0 ? "PARTIALLY_FILLED" : "OPEN";
}

// ---------------------------------------------------------------------------------------------------------------------
// Profile and funds

export function toProfile(profile: UpstoxProfile): Profile {
  const exchanges: readonly string[] = EXCHANGES;
  return {
    brokerClientId: profile.user_id,
    name: profile.user_name,
    ...(profile.email ? { email: profile.email } : {}),
    exchanges: profile.exchanges.filter((exchange): exchange is Exchange => exchanges.includes(exchange)),
  };
}

/**
 * Since 19 July 2025 Upstox returns the combined equity and commodity funds in `equity` (the docs' notice), so only
 * `equity` is read. Upstox reports no collateral figure: `collateral` is 0.
 */
export function toFunds(funds: UpstoxFunds): Funds {
  return {
    availableMargin: decimalString(funds.equity.available_margin),
    usedMargin: decimalString(funds.equity.used_margin),
    collateral: "0",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders, positions, holdings

function optionalPrice(value: number | null | undefined): string | undefined {
  return value === undefined || value === null || !(value > 0) ? undefined : decimalString(value);
}

/** `{ [name]: price }` for a price above 0, else `{}` (Upstox sends 0 for "none yet"). */
function priceField<K extends string>(name: K, value: number | null | undefined): Partial<Record<K, string>> {
  const price = optionalPrice(value);
  return price === undefined ? {} : ({ [name]: price } as Partial<Record<K, string>>);
}

/** An order book row (or order update) as a BrokerOrder; undefined for rows the sdk can't represent. */
export function toBrokerOrder(row: UpstoxOrder, key: InstrumentKey, now: Date): BrokerOrder | undefined {
  const segment = segmentOf(key);
  const product = fromUpstoxProduct(row.product, segment);
  const type = fromUpstoxOrderType(row.order_type);
  const side = fromUpstoxSide(row.transaction_type);
  const validity = fromUpstoxValidity(row.validity);
  const qty = Math.trunc(row.quantity);
  if (product === undefined || type === undefined || side === undefined || validity === undefined || qty < 1) {
    return undefined;
  }
  const filledQty = Math.min(count(row.filled_quantity), qty);
  const price = type === "LIMIT" || type === "SL" ? optionalPrice(row.price) : undefined;
  const triggerPrice = type === "SL" || type === "SL_M" ? optionalPrice(row.trigger_price) : undefined;
  const averagePrice = optionalPrice(row.average_price);
  const statusMessage = row.status_message?.trim().slice(0, 500);
  const tag = OrderTagSchema.safeParse(row.tag);
  const placedAt = istTimestamp(row.order_timestamp) ?? now.toISOString();
  return {
    brokerOrderId: row.order_id,
    instrumentKey: key,
    side,
    type,
    product,
    validity,
    qty,
    filledQty,
    ...(price === undefined ? {} : { price }),
    ...(triggerPrice === undefined ? {} : { triggerPrice }),
    ...(averagePrice === undefined ? {} : { averagePrice }),
    status: toOrderStatus(row.status, filledQty),
    ...(statusMessage ? { statusMessage } : {}),
    ...(tag.success ? { tag: tag.data } : {}),
    placedAt,
    updatedAt: istTimestamp(row.exchange_timestamp) ?? placedAt,
  };
}

/** A position row; `netQty` is Upstox's `quantity`, buy/sell quantities are day + overnight. */
export function toPosition(row: UpstoxPosition, key: InstrumentKey): BrokerPosition | undefined {
  const product = fromUpstoxProduct(row.product, segmentOf(key));
  if (product === undefined) return undefined;
  return {
    instrumentKey: key,
    product,
    netQty: Math.trunc(row.quantity),
    buyQty: count(row.day_buy_quantity) + count(row.overnight_buy_quantity),
    sellQty: count(row.day_sell_quantity) + count(row.overnight_sell_quantity),
    buyAvg: decimalString(row.buy_price ?? 0),
    sellAvg: decimalString(row.sell_price ?? 0),
    realisedPnl: decimalString(row.realised ?? 0),
    ...(row.last_price === undefined || row.last_price === null ? {} : { ltp: decimalString(row.last_price) }),
    ...priceField("close", row.close_price),
    ...(row.unrealised === undefined || row.unrealised === null
      ? {}
      : { unrealisedPnl: decimalString(row.unrealised) }),
  };
}

/** NSE equity series a trading symbol may carry (`NHPC-EQ` in the portfolio stream's example). */
const NSE_SERIES_SUFFIX = /-(?:EQ|BE|BZ|SM|ST)$/i;

/**
 * The canonical key of an equity row the resolver doesn't know (`NSE_EQ|INE002A01018` + trading symbol `RELIANCE` or
 * `RELIANCE-EQ` → `NSE_EQ|RELIANCE`, as the master maps it), so holdings and equity positions show before the master
 * is synced. Undefined for anything else: derivatives need the master.
 */
export function fallbackEquityKey(
  instrumentToken: string,
  tradingSymbol: string | null | undefined,
): InstrumentKey | undefined {
  const segment = instrumentToken.split("|")[0];
  const raw = (tradingSymbol ?? "").trim();
  const symbol = segment === "NSE_EQ" ? raw.replace(NSE_SERIES_SUFFIX, "") : raw;
  if ((segment !== "NSE_EQ" && segment !== "BSE_EQ") || symbol === "") return undefined;
  const normalized = normalizeInstrumentKey(`${segment}|${symbol}`);
  return normalized.ok ? normalized.value : undefined;
}

export function toHolding(row: UpstoxHolding, key: InstrumentKey): BrokerHolding {
  return {
    instrumentKey: key,
    qty: count(row.quantity),
    ...(row.t1_quantity === undefined || row.t1_quantity === null ? {} : { t1Qty: count(row.t1_quantity) }),
    avgPrice: decimalString(row.average_price),
    ...(row.last_price === undefined || row.last_price === null ? {} : { ltp: decimalString(row.last_price) }),
    ...priceField("close", row.close_price),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Candles

export interface CandleSpec {
  readonly unit: UpstoxCandleUnit;
  readonly interval: number;
  /** Bucket length. */
  readonly ms: number;
  /** The longest date range one historical request may cover (Upstox: 1 month ≤ 15 min, 1 quarter above, decade). */
  readonly maxDays: number;
  /** The first IST date Upstox has data for at this unit (`YYYY-MM-DD`); earlier days are not asked for. */
  readonly since: string;
}

const MINUTES_SINCE = UPSTOX_CANDLE_HISTORY.minutes.since;
const CANDLE_SPECS: Readonly<Record<Timeframe, CandleSpec>> = Object.freeze({
  M1: { unit: "minutes", interval: 1, ms: 60_000, maxDays: 28, since: MINUTES_SINCE },
  M3: { unit: "minutes", interval: 3, ms: 180_000, maxDays: 28, since: MINUTES_SINCE },
  M5: { unit: "minutes", interval: 5, ms: 300_000, maxDays: 28, since: MINUTES_SINCE },
  M15: { unit: "minutes", interval: 15, ms: 900_000, maxDays: 28, since: MINUTES_SINCE },
  M30: { unit: "minutes", interval: 30, ms: 1_800_000, maxDays: 89, since: MINUTES_SINCE },
  H1: { unit: "hours", interval: 1, ms: 3_600_000, maxDays: 89, since: UPSTOX_CANDLE_HISTORY.hours.since },
  D1: { unit: "days", interval: 1, ms: DAY_MS, maxDays: 3650, since: UPSTOX_CANDLE_HISTORY.days.since },
});

export function candleSpec(timeframe: Timeframe): CandleSpec {
  return CANDLE_SPECS[timeframe];
}

/** One V3 candle; `withOi` for derivatives (equity and index rows carry a meaningless 0). */
export function toCandle(raw: UpstoxCandle, withOi: boolean): Candle | undefined {
  const ts = Date.parse(raw[0]);
  if (Number.isNaN(ts)) return undefined;
  const oi = raw[6];
  return {
    ts,
    open: decimalString(raw[1]),
    high: decimalString(raw[2]),
    low: decimalString(raw[3]),
    close: decimalString(raw[4]),
    volume: count(raw[5]),
    ...(withOi && oi !== undefined ? { oi: count(oi) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Instrument master

/** Upstox segment → canonical segment token. NSE_COM, BCD_FO and GLOBAL_* have no canonical token and are skipped. */
const SEGMENT_TOKENS: Readonly<Record<string, SegmentToken>> = Object.freeze({
  NSE_EQ: "NSE_EQ",
  NSE_INDEX: "NSE_INDEX",
  NSE_FO: "NSE_FO",
  NCD_FO: "NSE_CD",
  BSE_EQ: "BSE_EQ",
  BSE_INDEX: "BSE_INDEX",
  BSE_FO: "BSE_FO",
  MCX_FO: "MCX_FO",
});

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
/** Indices carry no tick size; they aren't traded. */
const INDEX_TICK = "0.05";

/** A pinned market index row (`NSE_INDEX|Nifty 50`, trading symbol `NIFTY`): by its key's name, name or symbol. */
function indexAliasOf(raw: UpstoxInstrument, token: SegmentToken): MarketIndexAlias | undefined {
  if (!token.endsWith("_INDEX")) return undefined;
  return marketIndexAlias(token, raw.instrument_key.split("|")[1], raw.name, raw.trading_symbol);
}

/** The canonical key text of a master row, before validation; undefined for kinds the platform doesn't model. */
function canonicalKeyText(raw: UpstoxInstrument, token: SegmentToken): string | undefined {
  if (token.endsWith("_INDEX")) {
    return indexAliasOf(raw, token)?.key ?? `${token}|${raw.instrument_key.split("|")[1] ?? ""}`;
  }
  if (token.endsWith("_EQ")) return `${token}|${raw.trading_symbol ?? ""}`;
  const type = raw.instrument_type;
  if (type !== "FUT" && type !== "CE" && type !== "PE") return undefined;
  if (raw.expiry === undefined || raw.expiry === null) return undefined;
  const future = `${token}|${raw.underlying_symbol ?? ""}|${istDate(raw.expiry)}`;
  if (type === "FUT") return future;
  return `${future}|${new Decimal(raw.strike_price ?? 0).toFixed()}|${type}`;
}

/**
 * A master row → an InstrumentRow with a canonical key; undefined when the row has no canonical form (unsupported
 * segment or type, a symbol outside the key grammar). Canonical symbols: equity `trading_symbol`; the pinned market
 * indices through {@link marketIndexAlias} (`NSE_INDEX|Nifty 50` → `NSE_INDEX|NIFTY 50`, with the seed's trading
 * symbol and name); other indices the name part of `instrument_key` upper-cased; derivatives `underlying_symbol` with
 * the IST expiry date. `tick_size` is converted from paise to rupees.
 */
export function toInstrumentRow(raw: UpstoxInstrument): InstrumentRow | undefined {
  const token = Object.hasOwn(SEGMENT_TOKENS, raw.segment) ? SEGMENT_TOKENS[raw.segment] : undefined;
  if (token === undefined) return undefined;
  const text = canonicalKeyText(raw, token);
  const normalized = text === undefined ? undefined : normalizeInstrumentKey(text);
  if (normalized?.ok !== true) return undefined;
  const parsed = parseInstrumentKey(normalized.value);
  if (!parsed.ok) return undefined;
  const key = parsed.value;
  const index = indexAliasOf(raw, token);
  const tradingSymbol = index?.symbol ?? ((raw.trading_symbol ?? "").trim().slice(0, 64) || key.symbol);
  const name = index?.name ?? ((raw.name ?? "").trim().slice(0, 200) || tradingSymbol);
  const tick = raw.tick_size !== undefined && raw.tick_size !== null && raw.tick_size > 0 ? raw.tick_size : undefined;
  const lotSize = count(raw.lot_size);
  const freezeQty = Math.trunc(raw.freeze_quantity ?? 0);
  const isin = key.segment === "EQ" && ISIN.test(raw.isin ?? "") ? (raw.isin ?? undefined) : undefined;
  return {
    instrumentKey: key.key,
    brokerToken: raw.instrument_key,
    exchange: key.exchange,
    segment: key.segment,
    tradingSymbol,
    name,
    ...(isin === undefined ? {} : { isin }),
    ...(key.segment === "FUT" || key.segment === "OPT" ? { expiry: key.expiry } : {}),
    ...(key.segment === "OPT" ? { strike: canonicalStrike(key.strike), optionType: key.optionType } : {}),
    lotSize: lotSize >= 1 ? lotSize : 1,
    tickSize: tick === undefined ? INDEX_TICK : toDecimalString(new Decimal(tick).div(100)),
    ...(freezeQty >= 1 ? { freezeQty } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Market feed

/**
 * Our feed mode → Upstox's: `ltp` is `ltpc`; `quote` is `option_greeks` for options (top of book, Greeks, OI, volume:
 * what an option chain needs, at a higher subscription limit) and `full` for everything else; `full` is `full`
 * (5 depth levels; Greeks for options).
 */
export function toUpstoxFeedMode(key: InstrumentKey, mode: FeedMode): UpstoxFeedMode {
  if (mode === "ltp") return "ltpc";
  return mode === "quote" && segmentOf(key) === "OPT" ? "option_greeks" : "full";
}

type MutableTick = { -readonly [K in keyof Tick]: Tick[K] };

function levels(quotes: readonly UpstoxQuote[], side: "bid" | "ask"): DepthLevel[] {
  const result: DepthLevel[] = [];
  for (const quote of quotes) {
    const price = side === "bid" ? quote.bidP : quote.askP;
    if (price !== undefined && price > 0) {
      result.push({ price: decimalString(price), qty: count(side === "bid" ? quote.bidQ : quote.askQ) });
    }
  }
  return result;
}

function addTopOfBook(tick: MutableTick, quote: UpstoxQuote | undefined): void {
  if (quote?.bidP !== undefined && quote.bidP > 0) {
    tick.bid = decimalString(quote.bidP);
    tick.bidQty = count(quote.bidQ);
  }
  if (quote?.askP !== undefined && quote.askP > 0) {
    tick.ask = decimalString(quote.askP);
    tick.askQty = count(quote.askQ);
  }
}

function addGreeks(tick: MutableTick, greeks: UpstoxOptionGreeks | undefined, iv: number | undefined): void {
  if (greeks === undefined) return;
  tick.greeks = {
    iv: iv ?? 0,
    delta: greeks.delta ?? 0,
    gamma: greeks.gamma ?? 0,
    theta: greeks.theta ?? 0,
    vega: greeks.vega ?? 0,
    ...(greeks.rho === undefined ? {} : { rho: greeks.rho }),
  };
}

/** Sets a price field only for a price above 0 (proto3 leaves "none yet" at 0). */
function setPrice(
  tick: MutableTick,
  field: "close" | "open" | "high" | "low" | "atp",
  value: number | undefined,
): void {
  if (value !== undefined && value > 0) tick[field] = decimalString(value);
}

/**
 * One decoded feed entry as a Tick; undefined when it carries no LTPC. `ts` is the last trade time, else the message
 * time. `close` is the previous close (`cp`); open, high and low are the day's (`marketOHLC` interval `1d`, also for
 * indices in `indexFF`); `volume` is `vtt`; `tbq`/`tsq` are the book totals. Prices at 0 and OI at 0 are left out.
 * Greeks only for options (Upstox sends zeros for other instruments in full mode).
 */
export function toTick(key: InstrumentKey, feed: UpstoxFeed, currentTs: number, isOption: boolean): Tick | undefined {
  const market = feed.fullFeed?.marketFF;
  const index = feed.fullFeed?.indexFF;
  const first = feed.firstLevelWithGreeks;
  const ltpc = feed.ltpc ?? market?.ltpc ?? index?.ltpc ?? first?.ltpc;
  if (ltpc === undefined) return undefined;
  const tick: MutableTick = {
    instrumentKey: key,
    ltp: decimalString(ltpc.ltp ?? 0),
    ts: ltpc.ltt !== undefined && ltpc.ltt > 0 ? ltpc.ltt : currentTs,
  };
  if (ltpc.ltq !== undefined) tick.ltq = count(ltpc.ltq);
  setPrice(tick, "close", ltpc.cp);
  const day = (market?.marketOHLC ?? index?.marketOHLC)?.ohlc?.find((candle) => candle.interval === "1d");
  setPrice(tick, "open", day?.open);
  setPrice(tick, "high", day?.high);
  setPrice(tick, "low", day?.low);
  if (market !== undefined) {
    const quotes = market.marketLevel?.bidAskQuote ?? [];
    setPrice(tick, "atp", market.atp);
    tick.volume = count(market.vtt);
    if (count(market.oi) > 0) tick.oi = count(market.oi);
    tick.tbq = count(market.tbq);
    tick.tsq = count(market.tsq);
    addTopOfBook(tick, quotes[0]);
    tick.depth = { bids: levels(quotes, "bid"), asks: levels(quotes, "ask") };
    if (isOption) addGreeks(tick, market.optionGreeks, market.iv);
  }
  if (first !== undefined) {
    tick.volume = count(first.vtt);
    if (count(first.oi) > 0) tick.oi = count(first.oi);
    addTopOfBook(tick, first.firstDepth);
    if (isOption) addGreeks(tick, first.optionGreeks, first.iv);
  }
  return tick;
}
