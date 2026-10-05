/**
 * Zod mirrors of the Prisma enums that cross the wire (plan D17). shared never imports Prisma, so the browser can use
 * these. The values must match `packages/database/prisma/schema.prisma` exactly, in the same order; a sync test in
 * packages/database compares every tuple below with the generated Prisma enum.
 *
 * Each enum has three exports: the value tuple (`EXCHANGES`), the schema (`ExchangeSchema`) and the type (`Exchange`).
 */
import { z } from "zod";

/** Exchanges. Asset class follows the exchange: MCX is commodities, CDS is currency derivatives. */
export const EXCHANGES = Object.freeze(["NSE", "BSE", "MCX", "NFO", "BFO", "CDS"] as const);
export const ExchangeSchema = z.enum(EXCHANGES);
export type Exchange = z.infer<typeof ExchangeSchema>;

/** Instrument kind (not asset class): equity, index, future or option. */
export const SEGMENTS = Object.freeze(["EQ", "INDEX", "FUT", "OPT"] as const);
export const SegmentSchema = z.enum(SEGMENTS);
export type Segment = z.infer<typeof SegmentSchema>;

/** Call (CE) or put (PE). */
export const OPTION_TYPES = Object.freeze(["CE", "PE"] as const);
export const OptionTypeSchema = z.enum(OPTION_TYPES);
export type OptionType = z.infer<typeof OptionTypeSchema>;

/** Supported brokers. PAPER is the built-in paper-trading broker. */
export const BROKER_CODES = Object.freeze([
  "UPSTOX",
  "DHAN",
  "ZERODHA",
  "ANGELONE",
  "FYERS",
  "SHOONYA",
  "PAPER",
] as const);
export const BrokerCodeSchema = z.enum(BROKER_CODES);
export type BrokerCode = z.infer<typeof BrokerCodeSchema>;

/** User roles (RBAC). */
export const ROLES = Object.freeze(["USER", "PRO", "ADMIN"] as const);
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** Order types. SL is stop-loss limit; SL_M is stop-loss market. */
export const ORDER_TYPES = Object.freeze(["MARKET", "LIMIT", "SL", "SL_M"] as const);
export const OrderTypeSchema = z.enum(ORDER_TYPES);
export type OrderType = z.infer<typeof OrderTypeSchema>;

/** Order product types. CO is cover order; BO is bracket order. */
export const PRODUCT_TYPES = Object.freeze(["INTRADAY", "DELIVERY", "MARGIN", "CO", "BO"] as const);
export const ProductTypeSchema = z.enum(PRODUCT_TYPES);
export type ProductType = z.infer<typeof ProductTypeSchema>;

/** Order validity. */
export const VALIDITIES = Object.freeze(["DAY", "IOC"] as const);
export const ValiditySchema = z.enum(VALIDITIES);
export type Validity = z.infer<typeof ValiditySchema>;

/**
 * Every mirrored enum, keyed by its Prisma enum name. The enum-sync test in packages/database iterates this record, so
 * an enum added here is checked against Prisma without touching the test.
 */
export const PRISMA_ENUM_MIRRORS = Object.freeze({
  Exchange: EXCHANGES,
  Segment: SEGMENTS,
  OptionType: OPTION_TYPES,
  BrokerCode: BROKER_CODES,
  Role: ROLES,
  OrderType: ORDER_TYPES,
  ProductType: PRODUCT_TYPES,
  Validity: VALIDITIES,
});
