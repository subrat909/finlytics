/**
 * The paper book of one account (plan B13): orders, fills, positions, funds. Synchronous and deterministic: the
 * adapter passes in the current quote and serialises calls; the engine returns the events to publish.
 *
 * Fills
 * - MARKET (and a triggered SL_M): fills at the ask for a buy, the bid for a sell, else the LTP. No quote: REJECTED.
 * - LIMIT (and a triggered SL): fills when the market price crosses the limit, at the market price (never worse than
 *   the limit). Otherwise it rests and re-matches on the next quote.
 * - SL / SL_M trigger when the LTP reaches the trigger (buy: LTP ≥ trigger; sell: LTP ≤ trigger).
 * - IOC: whatever doesn't fill on placement is cancelled.
 * - `maxFillQtyPerMatch` caps each fill, so a large order fills over several quotes (partial fills).
 *
 * Rejections (no quote for a market order, unknown instrument, lot size, freeze quantity, tick size, funds) end the
 * order in REJECTED with a message, the way a broker's RMS does.
 *
 * Money: per instrument and product, buy and sell quantities and values. Realised P&L = matched qty × (sell avg − buy
 * avg); unrealised = open qty against the LTP; their sum is sell value − buy value + net × LTP. Used margin = open
 * exposure at its average price. Available = initial cash + realised − charges − used margin. Unrealised losses are
 * not deducted, and open orders block nothing (simplifications of a paper broker).
 */
import { toDecimal, toDecimalString } from "@finlytics/shared";
import type { Decimal, InstrumentKey, OrderType, ProductType, Validity } from "@finlytics/shared";

import { BrokerNotFoundError, BrokerRejectedError } from "../../errors";
import { TERMINAL_ORDER_STATUSES } from "../../models";
import type {
  BrokerOrder,
  BrokerOrderStatus,
  BrokerPosition,
  BrokerTrade,
  Funds,
  InstrumentRow,
  ModifyOrderInput,
  OrderSide,
  PlaceOrderInput,
} from "../../models";

import type { PaperChargesFn } from "./charges";
import type { PaperQuote } from "./quotes";

export interface PaperEngineConfig {
  readonly initialCash: Decimal;
  readonly charges: PaperChargesFn;
  readonly maxFillQtyPerMatch: number | undefined;
  /** Instrument rules by key; when empty, lot size, freeze quantity and tick size aren't checked. */
  readonly instruments: ReadonlyMap<InstrumentKey, InstrumentRow>;
  readonly newId: (kind: "order" | "trade") => string;
  readonly now: () => Date;
}

export type PaperEvent =
  { readonly kind: "order"; readonly order: BrokerOrder } | { readonly kind: "trade"; readonly trade: BrokerTrade };

interface OrderState {
  readonly brokerOrderId: string;
  readonly instrumentKey: InstrumentKey;
  readonly side: OrderSide;
  readonly product: ProductType;
  readonly placedAt: string;
  readonly tag: string | undefined;
  type: OrderType;
  validity: Validity;
  qty: number;
  price: string | undefined;
  triggerPrice: string | undefined;
  filledQty: number;
  filledValue: Decimal;
  status: BrokerOrderStatus;
  statusMessage: string | undefined;
  updatedAt: string;
  triggered: boolean;
}

interface PositionState {
  readonly instrumentKey: InstrumentKey;
  readonly product: ProductType;
  buyQty: number;
  sellQty: number;
  buyValue: Decimal;
  sellValue: Decimal;
}

const ZERO = toDecimal("0");

function needsTrigger(type: OrderType): boolean {
  return type === "SL" || type === "SL_M";
}

function hasLimit(type: OrderType): boolean {
  return type === "LIMIT" || type === "SL";
}

/** The price a marketable order trades at: ask for a buy, bid for a sell, else the LTP. */
export function marketPrice(side: OrderSide, quote: PaperQuote): Decimal {
  return toDecimal((side === "BUY" ? quote.ask : quote.bid) ?? quote.ltp);
}

function average(value: Decimal, qty: number): Decimal {
  return qty === 0 ? ZERO : value.div(qty);
}

function realisedPnl(position: PositionState): Decimal {
  const matched = Math.min(position.buyQty, position.sellQty);
  if (matched === 0) return ZERO;
  return average(position.sellValue, position.sellQty)
    .minus(average(position.buyValue, position.buyQty))
    .times(matched);
}

function netQty(position: PositionState): number {
  return position.buyQty - position.sellQty;
}

/** Open exposure at its average price. */
function usedMargin(position: PositionState): Decimal {
  const net = netQty(position);
  if (net > 0) return average(position.buyValue, position.buyQty).times(net);
  if (net < 0) return average(position.sellValue, position.sellQty).times(-net);
  return ZERO;
}

function unrealisedPnl(position: PositionState, ltp: Decimal): Decimal {
  const net = netQty(position);
  if (net > 0) return ltp.minus(average(position.buyValue, position.buyQty)).times(net);
  if (net < 0) return average(position.sellValue, position.sellQty).minus(ltp).times(-net);
  return ZERO;
}

export class PaperAccount {
  readonly #orders = new Map<string, OrderState>();
  readonly #positions = new Map<string, PositionState>();
  #charges: Decimal = ZERO;

  constructor(
    readonly clientId: string,
    readonly token: string,
    private readonly config: PaperEngineConfig,
  ) {}

  /** Accepts (or rejects) an order and matches it against `quote`. */
  place(input: PlaceOrderInput, quote: PaperQuote | undefined): { brokerOrderId: string; events: PaperEvent[] } {
    const now = this.config.now().toISOString();
    const order: OrderState = {
      brokerOrderId: this.config.newId("order"),
      instrumentKey: input.instrumentKey,
      side: input.side,
      product: input.product,
      placedAt: now,
      tag: input.tag,
      type: input.type,
      validity: input.validity,
      qty: input.qty,
      price: input.price,
      triggerPrice: input.triggerPrice,
      filledQty: 0,
      filledValue: ZERO,
      status: "OPEN",
      statusMessage: undefined,
      updatedAt: now,
      triggered: false,
    };
    this.#orders.set(order.brokerOrderId, order);
    const rejection = this.#rejection(order, quote);
    if (rejection !== undefined) {
      order.status = "REJECTED";
      order.statusMessage = rejection;
      return { brokerOrderId: order.brokerOrderId, events: [this.#orderEvent(order)] };
    }
    const events = [this.#orderEvent(order), ...this.#match(order, quote), ...this.#settleIoc(order)];
    return { brokerOrderId: order.brokerOrderId, events };
  }

  /**
   * Changes an open order, then re-matches it.
   *
   * @throws {BrokerNotFoundError} for an unknown order.
   * @throws {BrokerRejectedError} when the order is no longer open or the change is invalid.
   */
  modify(input: ModifyOrderInput, quote: PaperQuote | undefined): PaperEvent[] {
    const order = this.#openOrder(input.brokerOrderId);
    const type = input.type ?? order.type;
    const price = input.price ?? (hasLimit(type) ? order.price : undefined);
    const triggerPrice = input.triggerPrice ?? (needsTrigger(type) ? order.triggerPrice : undefined);
    const qty = input.qty ?? order.qty;
    if (hasLimit(type) !== (price !== undefined) || needsTrigger(type) !== (triggerPrice !== undefined)) {
      throw new BrokerRejectedError("Price and trigger price don't fit the order type", {
        brokerError: { code: "PAPER_INVALID_MODIFY" },
      });
    }
    if (qty <= order.filledQty) {
      throw new BrokerRejectedError("Quantity must stay above the filled quantity", {
        brokerError: { code: "PAPER_INVALID_MODIFY" },
      });
    }
    const tickProblem = this.#tickProblem(order.instrumentKey, [price, triggerPrice]);
    if (tickProblem !== undefined)
      throw new BrokerRejectedError(tickProblem, { brokerError: { code: "PAPER_TICK_SIZE" } });
    if (needsTrigger(type) && (!needsTrigger(order.type) || triggerPrice !== order.triggerPrice))
      order.triggered = false;
    order.type = type;
    order.qty = qty;
    order.price = hasLimit(type) ? price : undefined;
    order.triggerPrice = needsTrigger(type) ? triggerPrice : undefined;
    order.validity = input.validity ?? order.validity;
    order.updatedAt = this.config.now().toISOString();
    return [this.#orderEvent(order), ...this.#match(order, quote), ...this.#settleIoc(order)];
  }

  /**
   * @throws {BrokerNotFoundError} for an unknown order.
   * @throws {BrokerRejectedError} when the order is no longer open.
   */
  cancel(brokerOrderId: string): PaperEvent[] {
    return [this.#cancel(this.#openOrder(brokerOrderId), "Cancelled by user")];
  }

  /** Re-matches every open order on `key` against a new quote. */
  onQuote(key: InstrumentKey, quote: PaperQuote): PaperEvent[] {
    const events: PaperEvent[] = [];
    for (const order of this.#orders.values()) {
      if (order.instrumentKey === key && !TERMINAL_ORDER_STATUSES.has(order.status))
        events.push(...this.#match(order, quote));
    }
    return events;
  }

  orders(): BrokerOrder[] {
    return [...this.#orders.values()].map((order) => this.#snapshot(order));
  }

  /** Positions with LTP and unrealised P&L where `ltpOf` knows the price. */
  positions(ltpOf: (key: InstrumentKey) => string | undefined): BrokerPosition[] {
    return [...this.#positions.values()].map((position) => {
      const ltp = ltpOf(position.instrumentKey);
      return {
        instrumentKey: position.instrumentKey,
        product: position.product,
        netQty: netQty(position),
        buyQty: position.buyQty,
        sellQty: position.sellQty,
        buyAvg: toDecimalString(average(position.buyValue, position.buyQty)),
        sellAvg: toDecimalString(average(position.sellValue, position.sellQty)),
        realisedPnl: toDecimalString(realisedPnl(position)),
        ...(ltp === undefined ? {} : { ltp, unrealisedPnl: toDecimalString(unrealisedPnl(position, toDecimal(ltp))) }),
      };
    });
  }

  funds(): Funds {
    const available = this.#available();
    return {
      availableMargin: toDecimalString(available),
      usedMargin: toDecimalString(this.#usedMargin()),
      collateral: "0",
      withdrawable: toDecimalString(available.gt(0) ? available : ZERO),
    };
  }

  #usedMargin(): Decimal {
    let used = ZERO;
    for (const position of this.#positions.values()) used = used.plus(usedMargin(position));
    return used;
  }

  #available(): Decimal {
    let realised = ZERO;
    for (const position of this.#positions.values()) realised = realised.plus(realisedPnl(position));
    return this.config.initialCash.plus(realised).minus(this.#charges).minus(this.#usedMargin());
  }

  #openOrder(brokerOrderId: string): OrderState {
    const order = this.#orders.get(brokerOrderId);
    if (order === undefined)
      throw new BrokerNotFoundError("No such order", { brokerError: { code: "PAPER_ORDER_NOT_FOUND" } });
    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      throw new BrokerRejectedError(`Order is ${order.status.toLowerCase()}, not open`, {
        brokerError: { code: "PAPER_ORDER_NOT_OPEN" },
      });
    }
    return order;
  }

  #rejection(order: OrderState, quote: PaperQuote | undefined): string | undefined {
    const instrument = this.config.instruments.get(order.instrumentKey);
    if (this.config.instruments.size > 0) {
      if (instrument === undefined) return "Unknown instrument";
      if (order.qty % instrument.lotSize !== 0)
        return `Quantity must be a multiple of the lot size (${String(instrument.lotSize)})`;
      if (instrument.freezeQty !== undefined && order.qty > instrument.freezeQty) {
        return `Quantity exceeds the freeze quantity (${String(instrument.freezeQty)})`;
      }
    }
    const tickProblem = this.#tickProblem(order.instrumentKey, [order.price, order.triggerPrice]);
    if (tickProblem !== undefined) return tickProblem;
    const estimate =
      order.price ?? (quote === undefined ? order.triggerPrice : marketPrice(order.side, quote).toFixed());
    if (estimate === undefined) return `No market price for ${order.instrumentKey}`;
    const required = toDecimal(estimate).times(this.#exposureIncrease(order));
    const available = this.#available();
    if (required.gt(available)) {
      return `Insufficient funds: needs ${toDecimalString(required)}, available ${toDecimalString(available)}`;
    }
    return undefined;
  }

  #tickProblem(key: InstrumentKey, prices: readonly (string | undefined)[]): string | undefined {
    const tick = this.config.instruments.get(key)?.tickSize;
    if (tick === undefined) return undefined;
    for (const price of prices) {
      if (price !== undefined && !toDecimal(price).mod(tick).isZero()) {
        return `Price must be a multiple of the tick size (${tick})`;
      }
    }
    return undefined;
  }

  /** How much of the order adds exposure (the rest closes an opposite position). */
  #exposureIncrease(order: OrderState): number {
    const position = this.#positions.get(`${order.product}:${order.instrumentKey}`);
    const net = position === undefined ? 0 : netQty(position);
    const opposite = order.side === "BUY" ? Math.max(0, -net) : Math.max(0, net);
    return Math.max(0, order.qty - opposite);
  }

  #match(order: OrderState, quote: PaperQuote | undefined): PaperEvent[] {
    if (quote === undefined || TERMINAL_ORDER_STATUSES.has(order.status)) return [];
    if (needsTrigger(order.type) && !order.triggered) {
      const ltp = toDecimal(quote.ltp);
      const trigger = toDecimal(order.triggerPrice ?? "0");
      if (!(order.side === "BUY" ? ltp.gte(trigger) : ltp.lte(trigger))) return [];
      order.triggered = true;
    }
    const price = marketPrice(order.side, quote);
    if (hasLimit(order.type)) {
      const limit = toDecimal(order.price ?? "0");
      if (!(order.side === "BUY" ? price.lte(limit) : price.gte(limit))) return [];
    }
    const remaining = order.qty - order.filledQty;
    const qty = Math.min(remaining, this.config.maxFillQtyPerMatch ?? remaining);
    return this.#fill(order, qty, price);
  }

  #fill(order: OrderState, qty: number, price: Decimal): PaperEvent[] {
    const fillPrice = toDecimalString(price);
    const charges = toDecimal(
      this.config.charges({
        instrumentKey: order.instrumentKey,
        side: order.side,
        product: order.product,
        qty,
        price: fillPrice,
      }),
    );
    if (charges.isNegative()) throw new RangeError("Paper charges must not be negative");
    const executedAt = this.config.now().toISOString();
    const value = toDecimal(fillPrice).times(qty);
    order.filledQty += qty;
    order.filledValue = order.filledValue.plus(value);
    order.status = order.filledQty === order.qty ? "FILLED" : "PARTIALLY_FILLED";
    order.updatedAt = executedAt;

    const positionKey = `${order.product}:${order.instrumentKey}`;
    let position = this.#positions.get(positionKey);
    if (position === undefined) {
      position = {
        instrumentKey: order.instrumentKey,
        product: order.product,
        buyQty: 0,
        sellQty: 0,
        buyValue: ZERO,
        sellValue: ZERO,
      };
      this.#positions.set(positionKey, position);
    }
    if (order.side === "BUY") {
      position.buyQty += qty;
      position.buyValue = position.buyValue.plus(value);
    } else {
      position.sellQty += qty;
      position.sellValue = position.sellValue.plus(value);
    }
    this.#charges = this.#charges.plus(charges);

    const trade: BrokerTrade = {
      brokerTradeId: this.config.newId("trade"),
      brokerOrderId: order.brokerOrderId,
      instrumentKey: order.instrumentKey,
      side: order.side,
      product: order.product,
      qty,
      price: fillPrice,
      charges: toDecimalString(charges),
      executedAt,
    };
    return [{ kind: "trade", trade }, this.#orderEvent(order)];
  }

  #settleIoc(order: OrderState): PaperEvent[] {
    if (order.validity !== "IOC" || TERMINAL_ORDER_STATUSES.has(order.status)) return [];
    return [this.#cancel(order, "IOC: unfilled quantity cancelled")];
  }

  #cancel(order: OrderState, message: string): PaperEvent {
    order.status = "CANCELLED";
    order.statusMessage = message;
    order.updatedAt = this.config.now().toISOString();
    return this.#orderEvent(order);
  }

  #orderEvent(order: OrderState): PaperEvent {
    return { kind: "order", order: this.#snapshot(order) };
  }

  #snapshot(order: OrderState): BrokerOrder {
    return {
      brokerOrderId: order.brokerOrderId,
      instrumentKey: order.instrumentKey,
      side: order.side,
      type: order.type,
      product: order.product,
      validity: order.validity,
      qty: order.qty,
      filledQty: order.filledQty,
      ...(order.price === undefined ? {} : { price: order.price }),
      ...(order.triggerPrice === undefined ? {} : { triggerPrice: order.triggerPrice }),
      ...(order.filledQty === 0 ? {} : { averagePrice: toDecimalString(order.filledValue.div(order.filledQty)) }),
      status: order.status,
      ...(order.statusMessage === undefined ? {} : { statusMessage: order.statusMessage }),
      ...(order.tag === undefined ? {} : { tag: order.tag }),
      placedAt: order.placedAt,
      updatedAt: order.updatedAt,
    };
  }
}
