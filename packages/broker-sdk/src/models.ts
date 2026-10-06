/**
 * Normalised broker models (plan B1, B3). Every adapter maps its broker's payloads into these shapes; the gateway
 * validates inputs before they reach the broker and adapter outputs before they reach the platform.
 *
 * - Instruments are canonical {@link InstrumentKey}s (`NSE_FO|NIFTY|2025-10-30|24000|CE`).
 * - Prices and amounts are decimal strings (`PriceSchema`, `MoneySchema` from @finlytics/shared), never floats.
 * - Quantities are integers in units, not lots. Timestamps are ISO 8601 strings with an offset (orders, trades) or
 *   epoch milliseconds (candles, ticks: high volume).
 */
import {
  ExchangeSchema,
  InstrumentKeySchema,
  MoneySchema,
  OptionTypeSchema,
  OrderTypeSchema,
  parseInstrumentKey,
  PriceSchema,
  ProductTypeSchema,
  QuantitySchema,
  SegmentSchema,
  toDecimal,
  ValiditySchema,
} from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Enums not mirrored in @finlytics/shared yet (plan carry-forward 4)

/** Order side; equals Prisma `OrderSide`. */
export const ORDER_SIDES = Object.freeze(["BUY", "SELL"] as const);
export const OrderSideSchema = z.enum(ORDER_SIDES);
export type OrderSide = z.infer<typeof OrderSideSchema>;

/** A broker's order status: Prisma `OrderStatus` without `FAILED`, which is ours (the order never reached a broker). */
export const BROKER_ORDER_STATUSES = Object.freeze([
  "PENDING",
  "OPEN",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
] as const);
export const BrokerOrderStatusSchema = z.enum(BROKER_ORDER_STATUSES);
export type BrokerOrderStatus = z.infer<typeof BrokerOrderStatusSchema>;

/** Statuses an order never leaves. */
export const TERMINAL_ORDER_STATUSES: ReadonlySet<BrokerOrderStatus> = new Set([
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
]);

/** Candle timeframes; equal Prisma `Timeframe`. */
export const TIMEFRAMES = Object.freeze(["M1", "M3", "M5", "M15", "M30", "H1", "D1"] as const);
export const TimeframeSchema = z.enum(TIMEFRAMES);
export type Timeframe = z.infer<typeof TimeframeSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Building blocks

const IsoTimestampSchema = z.iso.datetime({ offset: true });
const IsoDateSchema = z.iso.date();
const NonNegativeIntSchema = z.int().min(0);
const EpochMsSchema = z.int().min(0);
/** A broker's id for an order or trade: printable, no whitespace. */
export const BrokerIdSchema = z.string().regex(/^[A-Za-z0-9._:/-]{1,64}$/, "Expected a broker id (1–64 characters)");
/** Our correlation id on an order (algo id or idempotency correlation): what Upstox and Dhan both accept. */
export const OrderTagSchema = z.string().regex(/^[A-Za-z0-9_-]{1,20}$/, "Expected 1–20 of A–Z, a–z, 0–9, _ and -");
const PositivePriceSchema = PriceSchema.refine((value) => toDecimal(value).gt(0), "Expected a price above 0");
const MessageSchema = z.string().min(1).max(500);

// ---------------------------------------------------------------------------------------------------------------------
// Auth (operation 1)

/** How a user connects: an OAuth redirect (Upstox), pasted fields (Dhan's static token), or nothing (Paper). */
export const AuthStartSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("oauth"), url: z.url({ protocol: /^https$/ }) }),
  z.strictObject({
    mode: z.literal("token"),
    fields: z
      .array(
        z.strictObject({
          name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
          label: z.string().min(1).max(80),
          secret: z.boolean(),
        }),
      )
      .min(1),
  }),
  z.strictObject({ mode: z.literal("none") }),
]);
export type AuthStart = z.infer<typeof AuthStartSchema>;

/** What `exchangeToken` receives: the OAuth `code` (with its redirect URI) or the pasted fields. */
export interface ExchangeTokenInput {
  readonly code?: string | undefined;
  readonly redirectUri?: string | undefined;
  readonly fields?: Readonly<Record<string, string>> | undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Profile and funds (operations 3, 4)

export const ProfileSchema = z.strictObject({
  /** The broker's client id. PII: stored encrypted by the api. */
  brokerClientId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  email: z.string().max(320).optional(),
  exchanges: z.array(ExchangeSchema),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const FundsSchema = z.strictObject({
  /** What new orders can use now. */
  availableMargin: MoneySchema,
  usedMargin: MoneySchema,
  collateral: MoneySchema,
  withdrawable: MoneySchema.optional(),
});
export type Funds = z.infer<typeof FundsSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Instrument master (operation 5)

export const InstrumentRowSchema = z
  .strictObject({
    instrumentKey: InstrumentKeySchema,
    /** The broker's own id (Upstox `instrument_key`, Dhan `security_id`): the reverse lookup for feeds. */
    brokerToken: z.string().min(1).max(64),
    exchange: ExchangeSchema,
    segment: SegmentSchema,
    tradingSymbol: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    isin: z
      .string()
      .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/)
      .optional(),
    expiry: IsoDateSchema.optional(),
    strike: PositivePriceSchema.optional(),
    optionType: OptionTypeSchema.optional(),
    lotSize: z.int().min(1),
    tickSize: PositivePriceSchema,
    freezeQty: z.int().min(1).optional(),
  })
  .superRefine((row, ctx) => {
    const parsed = parseInstrumentKey(row.instrumentKey);
    if (!parsed.ok) return; // InstrumentKeySchema has already reported it.
    const key = parsed.value;
    if (key.exchange !== row.exchange || key.segment !== row.segment) {
      ctx.addIssue({ code: "custom", path: ["instrumentKey"], message: "Key does not match exchange and segment" });
    }
    const expiry = key.segment === "FUT" || key.segment === "OPT" ? key.expiry : undefined;
    if (row.expiry !== expiry)
      ctx.addIssue({ code: "custom", path: ["expiry"], message: "Must equal the key's expiry" });
    const option = key.segment === "OPT" ? key : undefined;
    if (row.optionType !== option?.optionType) {
      ctx.addIssue({ code: "custom", path: ["optionType"], message: "Must equal the key's option type" });
    }
    if (
      (row.strike === undefined) !== (option === undefined) ||
      (row.strike !== undefined && option !== undefined && !toDecimal(row.strike).eq(option.strike))
    ) {
      ctx.addIssue({ code: "custom", path: ["strike"], message: "Must equal the key's strike" });
    }
  });
export type InstrumentRow = z.infer<typeof InstrumentRowSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Orders (operations 6–9)

export const PlaceOrderInputSchema = z
  .strictObject({
    instrumentKey: InstrumentKeySchema,
    side: OrderSideSchema,
    type: OrderTypeSchema,
    product: ProductTypeSchema,
    validity: ValiditySchema,
    qty: QuantitySchema,
    /** Limit price: required for LIMIT and SL, forbidden for MARKET and SL_M. */
    price: PositivePriceSchema.optional(),
    /** Required for SL and SL_M, forbidden otherwise. */
    triggerPrice: PositivePriceSchema.optional(),
    /** Algo id / correlation tag; how a timed-out placement is found again in the order book. */
    tag: OrderTagSchema.optional(),
  })
  .superRefine((order, ctx) => {
    const needsPrice = order.type === "LIMIT" || order.type === "SL";
    const needsTrigger = order.type === "SL" || order.type === "SL_M";
    if (needsPrice !== (order.price !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: needsPrice ? "Required for this order type" : "Not allowed for this order type",
      });
    }
    if (needsTrigger !== (order.triggerPrice !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["triggerPrice"],
        message: needsTrigger ? "Required for this order type" : "Not allowed for this order type",
      });
    }
  });
export type PlaceOrderInput = z.infer<typeof PlaceOrderInputSchema>;

export const PlaceOrderResultSchema = z.strictObject({ brokerOrderId: BrokerIdSchema });
export type PlaceOrderResult = z.infer<typeof PlaceOrderResultSchema>;

export const ModifyOrderInputSchema = z
  .strictObject({
    brokerOrderId: BrokerIdSchema,
    type: OrderTypeSchema.optional(),
    qty: QuantitySchema.optional(),
    price: PositivePriceSchema.optional(),
    triggerPrice: PositivePriceSchema.optional(),
    validity: ValiditySchema.optional(),
  })
  .refine(
    (input) =>
      [input.type, input.qty, input.price, input.triggerPrice, input.validity].some((value) => value !== undefined),
    "Change at least one field",
  );
export type ModifyOrderInput = z.infer<typeof ModifyOrderInputSchema>;

export const BrokerOrderSchema = z
  .strictObject({
    brokerOrderId: BrokerIdSchema,
    instrumentKey: InstrumentKeySchema,
    side: OrderSideSchema,
    type: OrderTypeSchema,
    product: ProductTypeSchema,
    validity: ValiditySchema,
    qty: QuantitySchema,
    filledQty: NonNegativeIntSchema,
    price: PriceSchema.optional(),
    triggerPrice: PriceSchema.optional(),
    averagePrice: PriceSchema.optional(),
    status: BrokerOrderStatusSchema,
    statusMessage: MessageSchema.optional(),
    tag: OrderTagSchema.optional(),
    placedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .refine((order) => order.filledQty <= order.qty, { path: ["filledQty"], message: "Cannot exceed qty" });
export type BrokerOrder = z.infer<typeof BrokerOrderSchema>;

/** One execution (a fill or part of one). */
export const BrokerTradeSchema = z.strictObject({
  brokerTradeId: BrokerIdSchema,
  brokerOrderId: BrokerIdSchema,
  instrumentKey: InstrumentKeySchema,
  side: OrderSideSchema,
  product: ProductTypeSchema,
  qty: QuantitySchema,
  price: PriceSchema,
  /** Charges on this fill, when the broker reports them (Paper always does). */
  charges: MoneySchema.optional(),
  executedAt: IsoTimestampSchema,
});
export type BrokerTrade = z.infer<typeof BrokerTradeSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Positions and holdings (operation 10)

export const BrokerPositionSchema = z.strictObject({
  instrumentKey: InstrumentKeySchema,
  product: ProductTypeSchema,
  /** buyQty − sellQty: positive long, negative short, 0 closed. */
  netQty: z.int(),
  buyQty: NonNegativeIntSchema,
  sellQty: NonNegativeIntSchema,
  buyAvg: PriceSchema,
  sellAvg: PriceSchema,
  realisedPnl: MoneySchema,
  ltp: PriceSchema.optional(),
  unrealisedPnl: MoneySchema.optional(),
});
export type BrokerPosition = z.infer<typeof BrokerPositionSchema>;

export const BrokerHoldingSchema = z.strictObject({
  instrumentKey: InstrumentKeySchema,
  qty: NonNegativeIntSchema,
  /** Bought but not yet delivered (T1). */
  t1Qty: NonNegativeIntSchema.optional(),
  avgPrice: PriceSchema,
  ltp: PriceSchema.optional(),
});
export type BrokerHolding = z.infer<typeof BrokerHoldingSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Historical candles (operation 11)

export const CandleSchema = z
  .strictObject({
    /** Bucket start, epoch milliseconds (UTC). */
    ts: EpochMsSchema,
    open: PriceSchema,
    high: PriceSchema,
    low: PriceSchema,
    close: PriceSchema,
    volume: NonNegativeIntSchema,
    oi: NonNegativeIntSchema.optional(),
  })
  .refine(
    (candle) => {
      const [low, high] = [toDecimal(candle.low), toDecimal(candle.high)];
      return [candle.open, candle.close].every((price) => toDecimal(price).gte(low) && toDecimal(price).lte(high));
    },
    { message: "open and close must lie within low–high" },
  );
export type Candle = z.infer<typeof CandleSchema>;

export interface CandleQuery {
  readonly instrumentKey: InstrumentKey;
  readonly timeframe: Timeframe;
  readonly from: Date;
  readonly to: Date;
}

// ---------------------------------------------------------------------------------------------------------------------
// Feeds (operation 12)

/** Market feed detail: LTP only, top of book, or full depth (+ Greeks for options where the broker sends them). */
export const FEED_MODES = Object.freeze(["ltp", "quote", "full"] as const);
export const FeedModeSchema = z.enum(FEED_MODES);
export type FeedMode = z.infer<typeof FeedModeSchema>;

const DepthLevelSchema = z.strictObject({
  price: PriceSchema,
  qty: NonNegativeIntSchema,
  orders: NonNegativeIntSchema.optional(),
});
export type DepthLevel = z.infer<typeof DepthLevelSchema>;

/**
 * One normalised market tick. Prices are decimal strings (plan B1); the feed converts the broker's numbers once.
 * Greeks are model outputs, not prices, so they stay numbers. Not parsed per tick: {@link TickSchema} is for fixtures.
 */
export const TickSchema = z.strictObject({
  instrumentKey: InstrumentKeySchema,
  ltp: PriceSchema,
  /** Exchange timestamp of the last trade, epoch milliseconds. */
  ts: EpochMsSchema,
  ltq: NonNegativeIntSchema.optional(),
  /** Previous close, for change and change %. */
  close: PriceSchema.optional(),
  open: PriceSchema.optional(),
  high: PriceSchema.optional(),
  low: PriceSchema.optional(),
  atp: PriceSchema.optional(),
  volume: NonNegativeIntSchema.optional(),
  oi: NonNegativeIntSchema.optional(),
  bid: PriceSchema.optional(),
  ask: PriceSchema.optional(),
  bidQty: NonNegativeIntSchema.optional(),
  askQty: NonNegativeIntSchema.optional(),
  depth: z.strictObject({ bids: z.array(DepthLevelSchema), asks: z.array(DepthLevelSchema) }).optional(),
  greeks: z
    .strictObject({
      iv: z.number(),
      delta: z.number(),
      gamma: z.number(),
      theta: z.number(),
      vega: z.number(),
      rho: z.number().optional(),
    })
    .optional(),
});
export type Tick = z.infer<typeof TickSchema>;

/** An order's latest state from the order feed. `brokerClientId` says whose order it is on app-wide feeds. */
export interface OrderUpdate {
  readonly brokerClientId?: string | undefined;
  readonly order: BrokerOrder;
}

/** A fill from the order feed. */
export interface TradeUpdate {
  readonly brokerClientId?: string | undefined;
  readonly trade: BrokerTrade;
}
