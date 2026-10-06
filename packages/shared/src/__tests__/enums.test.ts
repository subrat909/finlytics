import { describe, expect, it } from "vitest";

import {
  BROKER_CODES,
  BrokerCodeSchema,
  EXCHANGES,
  ExchangeSchema,
  OPTION_TYPES,
  OptionTypeSchema,
  ORDER_TYPES,
  OrderTypeSchema,
  PRISMA_ENUM_MIRRORS,
  PRODUCT_TYPES,
  ProductTypeSchema,
  ROLES,
  RoleSchema,
  SEGMENTS,
  SegmentSchema,
  VALIDITIES,
  ValiditySchema,
} from "../schemas/enums";

/** Each mirror's tuple and schema. The values themselves are checked against Prisma by packages/database. */
const MIRRORS = [
  ["Exchange", EXCHANGES, ExchangeSchema],
  ["Segment", SEGMENTS, SegmentSchema],
  ["OptionType", OPTION_TYPES, OptionTypeSchema],
  ["BrokerCode", BROKER_CODES, BrokerCodeSchema],
  ["Role", ROLES, RoleSchema],
  ["OrderType", ORDER_TYPES, OrderTypeSchema],
  ["ProductType", PRODUCT_TYPES, ProductTypeSchema],
  ["Validity", VALIDITIES, ValiditySchema],
] as const;

describe("Prisma enum mirrors", () => {
  it.each(MIRRORS)("derives the %s schema from its value tuple, in order", (name, values, schema) => {
    expect(schema.options).toEqual([...values]);
    expect(PRISMA_ENUM_MIRRORS[name]).toBe(values);
    for (const value of values) expect(schema.parse(value)).toBe(value);
  });

  it("lists every mirrored enum for the sync test in packages/database", () => {
    expect(Object.keys(PRISMA_ENUM_MIRRORS)).toEqual(MIRRORS.map(([name]) => name));
  });

  it("mirrors Segment as the instrument kind, without asset classes", () => {
    expect(SEGMENTS).toEqual(["EQ", "INDEX", "FUT", "OPT"]);
    expect(SegmentSchema.safeParse("COMMODITY").success).toBe(false);
    expect(SegmentSchema.safeParse("CURRENCY").success).toBe(false);
  });

  it("has only the USER and ADMIN roles; paid tiers are Plan rows, not roles", () => {
    expect(ROLES).toEqual(["USER", "ADMIN"]);
    expect(RoleSchema.safeParse("PRO").success).toBe(false);
  });

  it("rejects values outside the enum, including other casing", () => {
    expect(ExchangeSchema.safeParse("nse").success).toBe(false);
    expect(BrokerCodeSchema.safeParse("KITE").success).toBe(false);
    expect(OrderTypeSchema.safeParse("SL-M").success).toBe(false);
    expect(ValiditySchema.safeParse("GTC").success).toBe(false);
  });

  it("freezes the value tuples", () => {
    expect(Object.isFrozen(PRISMA_ENUM_MIRRORS)).toBe(true);
    for (const [name, values] of MIRRORS) expect(Object.isFrozen(values), name).toBe(true);
  });
});
