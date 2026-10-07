/**
 * Broker answers (BrokerGateway's validated Funds, BrokerPosition and BrokerHolding) as the portfolio views of
 * @finlytics/shared `schemas/portfolio.ts`. Pure functions: the service supplies our instrument master and quote cache.
 *
 * - Instrument columns come from `Instrument` (symbol = the exchange's trading symbol when known); for a key we don't
 *   know, the exchange and segment come from the key itself, and name and lot size are null.
 * - `ltp` (and a holding's `close`) is the broker's, else our cached quote's (rounded to 4 decimals), else null.
 * - A position's `unrealisedPnl` is the broker's, else `(ltp − buyAvg) × netQty` long or `(sellAvg − ltp) × −netQty`
 *   short; a closed position (netQty 0) has 0.
 * - Positions: open first, then by symbol and product. Holdings: largest value first (`(qty + t1Qty) × (ltp, else the
 *   average price)`), then by symbol.
 */
import type { BrokerHolding, BrokerPosition, Funds } from "@finlytics/broker-sdk";
import { parseInstrumentKey, toDecimal, toDecimalString } from "@finlytics/shared";
import type {
  BrokerCode,
  Decimal,
  Exchange,
  FundsView,
  HoldingView,
  InstrumentKey,
  ParsedInstrumentKey,
  PositionView,
  Segment,
} from "@finlytics/shared";

/** Which account answered, and when the broker was asked. */
export interface AccountStamp {
  readonly accountId: string;
  readonly broker: BrokerCode;
  /** ISO 8601 (UTC). */
  readonly asOf: string;
}

/** The `Instrument` columns rows are enriched with. */
export interface InstrumentInfo {
  readonly key: string;
  readonly exchange: Exchange;
  readonly segment: Segment;
  readonly symbol: string;
  readonly tradingSymbol: string | null;
  readonly name: string;
  readonly lotSize: number;
}

/** What our quote cache knows about an instrument (decimal strings, any precision). */
export interface QuotePrices {
  readonly ltp?: string | undefined;
  readonly close?: string | undefined;
}

/** The instrument columns every portfolio row carries. */
export interface InstrumentColumns {
  readonly instrumentKey: InstrumentKey;
  readonly symbol: string;
  readonly name: string | null;
  readonly exchange: Exchange | null;
  readonly segment: Segment | null;
  readonly lotSize: number | null;
}

const MAX_SYMBOL = 64;
const MAX_NAME = 200;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** A readable symbol for a key we have no instrument for: `RELIANCE`, `NIFTY 2026-10-27 FUT`, `NIFTY 2026-10-27 24000 CE`. */
function keyLabel(key: ParsedInstrumentKey): string {
  switch (key.segment) {
    case "EQ":
    case "INDEX":
      return key.symbol;
    case "FUT":
      return `${key.symbol} ${key.expiry} FUT`;
    case "OPT":
      return `${key.symbol} ${key.expiry} ${key.strike} ${key.optionType}`;
  }
}

export function instrumentColumns(key: InstrumentKey, info: InstrumentInfo | undefined): InstrumentColumns {
  if (info !== undefined) {
    const symbol = info.tradingSymbol !== null && info.tradingSymbol !== "" ? info.tradingSymbol : info.symbol;
    return {
      instrumentKey: key,
      symbol: clip(symbol, MAX_SYMBOL),
      name: info.name === "" ? null : clip(info.name, MAX_NAME),
      exchange: info.exchange,
      segment: info.segment,
      lotSize: Number.isSafeInteger(info.lotSize) && info.lotSize >= 1 ? info.lotSize : null,
    };
  }
  const parsed = parseInstrumentKey(key);
  if (!parsed.ok)
    return {
      instrumentKey: key,
      symbol: clip(key, MAX_SYMBOL),
      name: null,
      exchange: null,
      segment: null,
      lotSize: null,
    };
  return {
    instrumentKey: key,
    symbol: clip(keyLabel(parsed.value), MAX_SYMBOL),
    name: null,
    exchange: parsed.value.exchange,
    segment: parsed.value.segment,
    lotSize: null,
  };
}

/** A price for the wire (PriceSchema: not negative, at most 4 decimals), or null when absent or unusable. */
export function wirePrice(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const text = toDecimalString(value);
    return text.startsWith("-") ? null : text;
  } catch {
    return null;
  }
}

/** The unrealised P&L of a net position at `ltp`, or null without a price (or when it doesn't fit Decimal(18,4)). */
export function unrealisedPnl(
  position: Pick<BrokerPosition, "netQty" | "buyAvg" | "sellAvg">,
  ltp: string | null,
): string | null {
  if (position.netQty === 0) return "0";
  if (ltp === null) return null;
  const price = toDecimal(ltp);
  const qty = String(Math.abs(position.netQty));
  const pnl =
    position.netQty > 0 ? price.minus(position.buyAvg).times(qty) : toDecimal(position.sellAvg).minus(price).times(qty);
  try {
    return toDecimalString(pnl);
  } catch {
    return null;
  }
}

export function toFundsView(stamp: AccountStamp, funds: Funds): FundsView {
  return {
    ...stamp,
    availableMargin: funds.availableMargin,
    usedMargin: funds.usedMargin,
    collateral: funds.collateral,
    withdrawable: funds.withdrawable ?? null,
  };
}

export function toPositionView(
  position: BrokerPosition,
  info: InstrumentInfo | undefined,
  quote: QuotePrices | undefined,
): PositionView {
  const ltp = wirePrice(position.ltp) ?? wirePrice(quote?.ltp);
  return {
    ...instrumentColumns(position.instrumentKey, info),
    product: position.product,
    netQty: position.netQty,
    buyQty: position.buyQty,
    sellQty: position.sellQty,
    buyAvg: position.buyAvg,
    sellAvg: position.sellAvg,
    realisedPnl: position.realisedPnl,
    ltp,
    unrealisedPnl: position.unrealisedPnl ?? unrealisedPnl(position, ltp),
  };
}

/** The previous close a broker reported for a holding, if any (adapters that know it set `close`). */
export function brokerClose(holding: { readonly close?: string | undefined }): string | undefined {
  return holding.close;
}

export function toHoldingView(
  holding: BrokerHolding,
  info: InstrumentInfo | undefined,
  quote: QuotePrices | undefined,
): HoldingView {
  return {
    ...instrumentColumns(holding.instrumentKey, info),
    qty: holding.qty,
    t1Qty: holding.t1Qty ?? 0,
    avgPrice: holding.avgPrice,
    ltp: wirePrice(holding.ltp) ?? wirePrice(quote?.ltp),
    close: wirePrice(brokerClose(holding)) ?? wirePrice(quote?.close),
  };
}

/** Open positions first, then by symbol and product. */
export function comparePositions(a: PositionView, b: PositionView): number {
  const open = Number(b.netQty !== 0) - Number(a.netQty !== 0);
  return open !== 0 ? open : a.symbol.localeCompare(b.symbol) || a.product.localeCompare(b.product);
}

function holdingValue(holding: HoldingView): Decimal {
  return toDecimal(holding.ltp ?? holding.avgPrice).times(String(holding.qty + holding.t1Qty));
}

/** Largest value first, then by symbol. */
export function compareHoldings(a: HoldingView, b: HoldingView): number {
  return holdingValue(b).comparedTo(holdingValue(a)) || a.symbol.localeCompare(b.symbol);
}
