/**
 * Portfolio arithmetic (plan phase-1b "Dashboard and brokers"): positions' live P&L and holdings' value, in exact
 * decimals (`toDecimal` from @finlytics/shared), never binary floats. A live price comes from a tick as a display number;
 * ticks carry at most four decimals, so four places turn it back into the exact decimal the feed sent.
 *
 * Conventions (what Indian brokers show):
 * - A position's unrealised P&L is `(ltp − avg) × netQty`, with the buy average for a long and the sell average for a
 *   short (netQty is negative, so the sign works out). Closed positions (netQty 0) have none.
 * - Day P&L is realised + unrealised over today's positions (M2M); holdings have their own day change, from the
 *   previous close.
 * - Holdings count settled and T1 quantity together, like the brokers' holdings screens.
 */
import { toDecimal } from "@finlytics/shared";
import type { Decimal, FundsView, HoldingView, PositionView } from "@finlytics/shared";

const ZERO = toDecimal("0");
const HUNDRED = toDecimal("100");

/** A tick price (number) or a wire price (decimal string) as a Decimal; null for a missing or non-finite value. */
export function priceDecimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? toDecimal(value.toFixed(4)) : null;
  return toDecimal(value);
}

/** `part / whole × 100` as a display number; null when the whole is zero or negative. */
export function percentOf(part: Decimal, whole: Decimal): number | null {
  return whole.gt(0) ? part.div(whole).times(HUNDRED).toNumber() : null;
}

export type PositionSide = "long" | "short" | "flat";

export function positionSide(netQty: number): PositionSide {
  if (netQty > 0) return "long";
  if (netQty < 0) return "short";
  return "flat";
}

export type PositionInput = Pick<
  PositionView,
  "netQty" | "buyAvg" | "sellAvg" | "realisedPnl" | "ltp" | "unrealisedPnl"
>;

export interface PositionPnl {
  side: PositionSide;
  /** The open side's average: buy for a long, sell for a short; the buy average once closed. */
  avg: Decimal;
  /** The live price, else the broker's snapshot; null when neither is known. */
  ltp: Decimal | null;
  realised: Decimal;
  /** Null for an open position without any price. */
  unrealised: Decimal | null;
  /** realised + unrealised; null when unrealised is unknown. */
  total: Decimal | null;
  /** Unrealised P&L as a percent of the open value (avg × |qty|); null when flat or unknown. */
  returnPct: number | null;
  /** Whether the price came from a live tick. */
  live: boolean;
}

/**
 * One position's P&L at `liveLtp` (a tick), else at the broker's last price, else the broker's own unrealised figure.
 */
export function positionPnl(position: PositionInput, liveLtp?: number | null): PositionPnl {
  const side = positionSide(position.netQty);
  const realised = toDecimal(position.realisedPnl);
  const live = priceDecimal(liveLtp);
  const ltp = live ?? priceDecimal(position.ltp);
  const avg = toDecimal(side === "short" ? position.sellAvg : position.buyAvg);

  let unrealised: Decimal | null;
  if (side === "flat") unrealised = ZERO;
  else if (ltp !== null) unrealised = ltp.minus(avg).times(position.netQty);
  else unrealised = priceDecimal(position.unrealisedPnl);

  const openValue = avg.times(Math.abs(position.netQty));
  return {
    side,
    avg,
    ltp,
    realised,
    unrealised,
    total: unrealised === null ? null : realised.plus(unrealised),
    returnPct: side === "flat" || unrealised === null ? null : percentOf(unrealised, openValue),
    live: live !== null,
  };
}

/**
 * The previous close a position carries (the api adds it when the broker reports it), else null. Read defensively, so
 * responses with and without the field both work.
 */
export function positionPrevClose(position: object): string | null {
  const value = (position as { close?: unknown }).close;
  return typeof value === "string" ? value : null;
}

/** The instrument's change today, in percent of the previous close; null without both prices. */
export function dayChangePct(ltp: Decimal | null, prevClose: Decimal | null): number | null {
  return ltp === null || prevClose === null ? null : percentOf(ltp.minus(prevClose), prevClose);
}

export interface PositionsSummary {
  realised: Decimal;
  unrealised: Decimal;
  /** Day P&L: realised + unrealised. */
  total: Decimal;
  open: number;
  closed: number;
  long: number;
  short: number;
  /** Open positions without any price: their unrealised P&L is missing from the totals. */
  unpriced: number;
}

/** Today's totals; `ltpOf` reads the live price of an instrument (undefined without a tick). */
export function summarisePositions(
  positions: readonly (PositionInput & { instrumentKey: string })[],
  ltpOf: (instrumentKey: string) => number | undefined,
): PositionsSummary {
  const summary: PositionsSummary = {
    realised: ZERO,
    unrealised: ZERO,
    total: ZERO,
    open: 0,
    closed: 0,
    long: 0,
    short: 0,
    unpriced: 0,
  };
  for (const position of positions) {
    const pnl = positionPnl(position, ltpOf(position.instrumentKey));
    summary.realised = summary.realised.plus(pnl.realised);
    if (pnl.unrealised === null) summary.unpriced += 1;
    else summary.unrealised = summary.unrealised.plus(pnl.unrealised);
    if (pnl.side === "flat") summary.closed += 1;
    else {
      summary.open += 1;
      if (pnl.side === "long") summary.long += 1;
      else summary.short += 1;
    }
  }
  summary.total = summary.realised.plus(summary.unrealised);
  return summary;
}

export type HoldingInput = Pick<HoldingView, "qty" | "t1Qty" | "avgPrice" | "ltp" | "close">;

/** A holding's live price and previous close, from a tick (the close is `ltp − chg`). */
export interface LiveQuote {
  ltp?: number | null | undefined;
  prevClose?: number | null | undefined;
}

export interface HoldingMetrics {
  /** Settled + T1. */
  qty: number;
  avg: Decimal;
  ltp: Decimal | null;
  invested: Decimal;
  /** Null without a price. */
  current: Decimal | null;
  pnl: Decimal | null;
  pnlPct: number | null;
  /** Today's change in value from the previous close; null without both prices. */
  dayChange: Decimal | null;
  dayChangePct: number | null;
}

export function holdingMetrics(holding: HoldingInput, live: LiveQuote = {}): HoldingMetrics {
  const qty = holding.qty + holding.t1Qty;
  const avg = toDecimal(holding.avgPrice);
  const ltp = priceDecimal(live.ltp) ?? priceDecimal(holding.ltp);
  const prevClose = priceDecimal(holding.close) ?? priceDecimal(live.prevClose);
  const invested = avg.times(qty);
  const current = ltp === null ? null : ltp.times(qty);
  const pnl = current === null ? null : current.minus(invested);
  const dayMove = ltp !== null && prevClose !== null ? ltp.minus(prevClose) : null;
  return {
    qty,
    avg,
    ltp,
    invested,
    current,
    pnl,
    pnlPct: pnl === null ? null : percentOf(pnl, invested),
    dayChange: dayMove === null ? null : dayMove.times(qty),
    dayChangePct: dayMove === null || prevClose === null ? null : percentOf(dayMove, prevClose),
  };
}

export interface HoldingsSummary {
  count: number;
  invested: Decimal;
  /** Unpriced holdings count at their invested value. */
  current: Decimal;
  pnl: Decimal;
  pnlPct: number | null;
  dayChange: Decimal;
  /** Against yesterday's value (current − day change). */
  dayChangePct: number | null;
  unpriced: number;
}

export function summariseHoldings(
  holdings: readonly (HoldingInput & { instrumentKey: string })[],
  quoteOf: (instrumentKey: string) => LiveQuote | undefined,
): HoldingsSummary {
  let invested = ZERO;
  let current = ZERO;
  let dayChange = ZERO;
  let unpriced = 0;
  for (const holding of holdings) {
    const metrics = holdingMetrics(holding, quoteOf(holding.instrumentKey));
    invested = invested.plus(metrics.invested);
    if (metrics.current === null) {
      unpriced += 1;
      current = current.plus(metrics.invested);
    } else current = current.plus(metrics.current);
    if (metrics.dayChange !== null) dayChange = dayChange.plus(metrics.dayChange);
  }
  const pnl = current.minus(invested);
  return {
    count: holdings.length,
    invested,
    current,
    pnl,
    pnlPct: percentOf(pnl, invested),
    dayChange,
    dayChangePct: percentOf(dayChange, current.minus(dayChange)),
    unpriced,
  };
}

/** Used margin as a share (0–1) of used + available; null when there's no margin at all. */
export function marginUsage(funds: Pick<FundsView, "availableMargin" | "usedMargin">): number | null {
  const used = maxDecimal(toDecimal(funds.usedMargin), ZERO);
  const available = maxDecimal(toDecimal(funds.availableMargin), ZERO);
  const total = used.plus(available);
  if (total.isZero()) return null;
  return used.div(total).toNumber();
}

function maxDecimal(a: Decimal, b: Decimal): Decimal {
  return a.gt(b) ? a : b;
}
