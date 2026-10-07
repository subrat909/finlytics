/**
 * Portfolio (plan phase-1b-terminal-ui-live-data "Portfolio"): funds, positions and holdings of one broker account,
 * read through BrokerGateway (operations 4 and 10) and cached 5 s per account. `accountId` defaults to the user's
 * default ACTIVE account (else their latest ACTIVE one); none → 404 `NOT_FOUND` "Connect a broker", or 409
 * `NEEDS_RELOGIN` when the user has an account that only needs a new broker login (as for a named account that isn't
 * ACTIVE, or a token the broker refuses). Money and prices are decimal strings.
 */
import { z } from "zod";

import { InstrumentKeySchema } from "../instrument-key";
import { MoneySchema, PriceSchema } from "../money";

import { BrokerAccountIdSchema } from "./brokers";
import { BrokerCodeSchema, ExchangeSchema, ProductTypeSchema, SegmentSchema } from "./enums";

/** `?accountId=` on every portfolio endpoint. */
export const PortfolioQuerySchema = z.strictObject({ accountId: BrokerAccountIdSchema.optional() });
export type PortfolioQuery = z.infer<typeof PortfolioQuerySchema>;

/** Which account answered, and when the broker was asked (the cache's fill time). */
const AccountStampShape = {
  accountId: z.string().min(1),
  broker: BrokerCodeSchema,
  asOf: z.iso.datetime(),
} as const;

/** `GET /v1/portfolio/funds`. */
export const FundsViewSchema = z.strictObject({
  ...AccountStampShape,
  availableMargin: MoneySchema,
  usedMargin: MoneySchema,
  collateral: MoneySchema,
  withdrawable: MoneySchema.nullable(),
});
export type FundsView = z.infer<typeof FundsViewSchema>;

/** The instrument columns every row carries (from our instrument master; null when we don't know the key). */
const InstrumentColumnsShape = {
  instrumentKey: InstrumentKeySchema,
  symbol: z.string().min(1).max(64),
  name: z.string().max(200).nullable(),
  exchange: ExchangeSchema.nullable(),
  segment: SegmentSchema.nullable(),
  lotSize: z.int().min(1).nullable(),
} as const;

export const PositionViewSchema = z.strictObject({
  ...InstrumentColumnsShape,
  product: ProductTypeSchema,
  /** buyQty − sellQty: positive long, negative short, 0 closed today. */
  netQty: z.int(),
  buyQty: z.int().min(0),
  sellQty: z.int().min(0),
  buyAvg: PriceSchema,
  sellAvg: PriceSchema,
  realisedPnl: MoneySchema,
  /** The broker's, else our cached quote's; null when neither has it. The UI recomputes live from ticks. */
  ltp: PriceSchema.nullable(),
  unrealisedPnl: MoneySchema.nullable(),
});
export type PositionView = z.infer<typeof PositionViewSchema>;

/** `GET /v1/portfolio/positions`: today's net positions, open first. */
export const PositionsViewSchema = z.strictObject({
  ...AccountStampShape,
  positions: z.array(PositionViewSchema),
});
export type PositionsView = z.infer<typeof PositionsViewSchema>;

export const HoldingViewSchema = z.strictObject({
  ...InstrumentColumnsShape,
  qty: z.int().min(0),
  t1Qty: z.int().min(0),
  avgPrice: PriceSchema,
  ltp: PriceSchema.nullable(),
  /** Previous close, for the day's change (from our quote cache). */
  close: PriceSchema.nullable(),
});
export type HoldingView = z.infer<typeof HoldingViewSchema>;

/** `GET /v1/portfolio/holdings`: delivery holdings, largest value first. */
export const HoldingsViewSchema = z.strictObject({
  ...AccountStampShape,
  holdings: z.array(HoldingViewSchema),
});
export type HoldingsView = z.infer<typeof HoldingsViewSchema>;
