import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";

import {
  DecimalStringSchema,
  formatInr,
  formatInrCompact,
  isOnTick,
  MoneySchema,
  PriceSchema,
  QuantitySchema,
  roundToTick,
  toDecimal,
  toDecimalString,
} from "../money";
import type { DecimalLike, DecimalRounding, FormatInrOptions, TickRounding } from "../money";

/**
 * The CommonJS build of decimal.js: a second, independent copy of the library in this process, standing in for the
 * copy Prisma bundles (and for the ESM/CJS dual-package case). Its instances share no prototype or constructor with ours.
 */
const { default: ForeignDecimal } = await import("decimal.js/decimal.js");

describe("DecimalStringSchema", () => {
  it("accepts decimal strings that fit Decimal(18,4)", () => {
    for (const text of [
      "0",
      "-0",
      "-0.5",
      "24000.05",
      "1.5000",
      "0.0001",
      "99999999999999.9999",
      "-99999999999999.9999",
    ]) {
      expect(DecimalStringSchema.safeParse(text).success, text).toBe(true);
    }
  });

  it("rejects leading zeros, exponents, more than 4 decimals and more than 14 integer digits", () => {
    const rejected = {
      leadingZeros: ["01", "00", "007", "-01.5"],
      exponents: ["1e5", "1E5", "2.5e-3"],
      moreThan4Decimals: ["1.00001", "0.12345"],
      moreThan14IntegerDigits: ["100000000000000", "-123456789012345", "123456789012345.5"],
    };

    for (const text of Object.values(rejected).flat()) {
      expect(DecimalStringSchema.safeParse(text).success, text).toBe(false);
    }
  });

  it("rejects signs, whitespace, separators and other notations", () => {
    for (const text of ["", "-", "+1", " 1", "1 ", ".5", "5.", "1,000", "1_000", "0x10", "NaN", "Infinity", "١٢"]) {
      expect(DecimalStringSchema.safeParse(text).success, JSON.stringify(text)).toBe(false);
    }
  });

  it("rejects numbers: money travels as strings", () => {
    expect(DecimalStringSchema.safeParse(24000.05).success).toBe(false);
  });
});

describe("PriceSchema, MoneySchema and QuantitySchema", () => {
  it("accepts non-negative prices only", () => {
    expect(PriceSchema.safeParse("0").success).toBe(true);
    expect(PriceSchema.safeParse("24000.05").success).toBe(true);
    expect(PriceSchema.safeParse("-0.05").success).toBe(false);
    expect(PriceSchema.safeParse("-0").success).toBe(false);
    expect(PriceSchema.safeParse("1.00001").success).toBe(false);
  });

  it("accepts signed amounts", () => {
    expect(MoneySchema.safeParse("-1234.5").success).toBe(true);
    expect(MoneySchema.safeParse("1e3").success).toBe(false);
  });

  it("accepts quantities from 1 to the Postgres Int maximum", () => {
    for (const qty of [1, 75, 2_147_483_647]) expect(QuantitySchema.safeParse(qty).success, String(qty)).toBe(true);
    for (const qty of [0, -1, 1.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(QuantitySchema.safeParse(qty).success, String(qty)).toBe(false);
    }
  });
});

describe("toDecimal", () => {
  it("converts plain decimal strings exactly", () => {
    expect(toDecimal("0.1").plus("0.2").toFixed()).toBe("0.3");
    expect(toDecimal("-12345678901234.5678").toFixed()).toBe("-12345678901234.5678");
  });

  it("accepts any precision for intermediate values", () => {
    expect(toDecimal("123456789012345678.123456789").toFixed()).toBe("123456789012345678.123456789");
  });

  it("computes with 40 significant digits", () => {
    expect(toDecimal("1").div("3").toFixed()).toBe(`0.${"3".repeat(40)}`);
  });

  it("rejects numbers, at the type level and at runtime", () => {
    // @ts-expect-error -- numbers are not DecimalLike: a float has already lost precision before we see it.
    expect(() => toDecimal(0.1)).toThrow(/Numbers are not accepted/);
    // @ts-expect-error -- every helper takes DecimalLike, so none accepts a number.
    expect(() => formatInr(1500)).toThrow(TypeError);
    // A boxed Number type-checks (it is an object with toFixed), and its toFixed() would round to an integer.
    expect(() => toDecimal(new Number(1.5))).toThrow(/Numbers are not accepted/);
  });

  it("rejects malformed strings", () => {
    for (const text of ["", "1e5", "+1", " 1", "1 ", ".5", "5.", "01", "0x10", "NaN", "Infinity", "1_000", "--1"]) {
      expect(() => toDecimal(text), JSON.stringify(text)).toThrow(TypeError);
    }
  });

  it("truncates long inputs in error messages", () => {
    expect(() => toDecimal(`${"9".repeat(60)}e5`)).toThrow(/^Not a plain decimal string: "9{40}…"$/);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
    ["a bigint", 10n],
    ["a plain object", {}],
    ["an array", []],
    ["an object whose toFixed returns a number", { toFixed: () => 1.5 }],
    ["an object whose toFixed returns an exponent", { toFixed: () => "1e5" }],
  ])("rejects %s", (_label, value) => {
    expect(() => toDecimal(value as unknown as DecimalLike)).toThrow(TypeError);
  });

  it("rejects non-finite Decimals", () => {
    expect(() => toDecimal(toDecimal("1").div("0"))).toThrow(/Not a finite decimal: Infinity/);
    expect(() => toDecimal(toDecimal("0").div("0"))).toThrow(/Not a finite decimal: NaN/);
    expect(() => toDecimal(new ForeignDecimal("-Infinity"))).toThrow(TypeError);
  });

  it("returns this package's Decimals as they are", () => {
    const decimal = toDecimal("24000.05");

    expect(toDecimal(decimal)).toBe(decimal);
  });

  it("accepts Prisma Decimal-like values without float conversion", () => {
    // 18 significant digits: through a float this would come back as 12345678901234.568.
    const fromPrisma = new ForeignDecimal("12345678901234.5678");
    const toNumber = vi.spyOn(fromPrisma, "toNumber");
    const valueOf = vi.spyOn(fromPrisma, "valueOf");

    expect(toDecimalString(fromPrisma)).toBe("12345678901234.5678");
    expect(roundToTick(fromPrisma, new ForeignDecimal("0.05"), "down")).toBe("12345678901234.55");
    expect(formatInr(fromPrisma, { decimals: 4 })).toBe("₹1,23,45,67,89,01,234.5678");
    expect(toNumber).not.toHaveBeenCalled();
    expect(valueOf).not.toHaveBeenCalled();
  });

  it("accepts Decimals from another decimal.js copy and computes with this package's settings", () => {
    const foreign = new ForeignDecimal("1");
    const converted = toDecimal(foreign);

    // The stand-in really is a separate copy: no shared prototype, so instanceof could never work across them.
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.getPrototypeOf(converted));
    expect(converted.div("3").toFixed()).toBe(`0.${"3".repeat(40)}`);
    expect(foreign.div("3").toFixed()).toBe(`0.${"3".repeat(20)}`);
  });

  it("accepts any object whose toFixed() returns plain decimal notation", () => {
    const bigJsLike = { toFixed: () => "-0.1000" };

    expect(toDecimalString(bigJsLike)).toBe("-0.1");
    expect(toDecimalString(new Decimal("1.5e3"))).toBe("1500");
  });

  it("ignores the global decimal.js configuration", () => {
    Decimal.set({ precision: 2, rounding: Decimal.ROUND_DOWN, toExpNeg: -1, toExpPos: 1 });
    try {
      expect(toDecimal("1").div("3").toFixed()).toBe(`0.${"3".repeat(40)}`);
      expect(toDecimalString("0.00005")).toBe("0.0001");
      expect(String(toDecimal("0.0000001"))).toBe("0.0000001");
      expect(JSON.stringify(toDecimal("123456789012345678901234"))).toBe('"123456789012345678901234"');
    } finally {
      Decimal.set({ defaults: true });
    }
  });
});

describe("toDecimalString", () => {
  it("renders canonical strings: at most 4 decimals, trailing zeros trimmed, no exponent", () => {
    expect(toDecimalString("24000.05")).toBe("24000.05");
    expect(toDecimalString("1.50")).toBe("1.5");
    expect(toDecimalString("100")).toBe("100");
    expect(toDecimalString("0.00010")).toBe("0.0001");
    expect(toDecimalString("1.23456")).toBe("1.2346");
    expect(toDecimalString(toDecimal("2").div("3"))).toBe("0.6667");
    expect(toDecimalString(new Decimal("1e-7"))).toBe("0");
  });

  it("never emits negative zero", () => {
    expect(toDecimalString("-0")).toBe("0");
    expect(toDecimalString("-0.0000")).toBe("0");
    expect(toDecimalString("-0.00001")).toBe("0");
    expect(toDecimalString("-0.00004", "up")).toBe("0");
    expect(toDecimalString(toDecimal("-0"))).toBe("0");
    expect(toDecimalString(new ForeignDecimal("-0"))).toBe("0");
    expect(roundToTick("-0.01", "0.05", "nearest")).toBe("0");
    expect(roundToTick("-0.04", "0.05", "up")).toBe("0");
    expect(formatInr("-0.001")).toBe("₹0.00");
    expect(formatInr("-0.004", { sign: "always" })).toBe("₹0.00");
    expect(formatInr("-0.4", { decimals: 0 })).toBe("₹0");
    expect(formatInrCompact("-0.001")).toBe("₹0");
  });

  it.each<[string, DecimalRounding, string]>([
    ["0.00005", "half-up", "0.0001"],
    ["-0.00005", "half-up", "-0.0001"],
    ["0.00015", "half-even", "0.0002"],
    ["0.00025", "half-even", "0.0002"],
    ["0.00019", "down", "0.0001"],
    ["-0.00011", "down", "-0.0002"],
    ["0.00011", "up", "0.0002"],
    ["-0.00019", "up", "-0.0001"],
  ])("rounds %s %s to %s", (value, rounding, expected) => {
    expect(toDecimalString(value, rounding)).toBe(expected);
  });

  it("throws a RangeError beyond 14 integer digits, including after rounding", () => {
    expect(() => toDecimalString("100000000000000")).toThrow(RangeError);
    expect(() => toDecimalString("-100000000000000")).toThrow(RangeError);
    expect(() => toDecimalString("99999999999999.99995")).toThrow(/more than 14 integer digits/);
    expect(toDecimalString("99999999999999.99995", "down")).toBe("99999999999999.9999");
    expect(toDecimalString("-99999999999999.99994")).toBe("-99999999999999.9999");
  });

  it("rejects an unknown rounding mode", () => {
    expect(() => toDecimalString("1", "nearest" as DecimalRounding)).toThrow(RangeError);
    expect(() => toDecimalString("1", "toString" as DecimalRounding)).toThrow(/Unknown rounding: "toString"/);
  });
});

describe("roundToTick", () => {
  it.each<[string, string, string]>([
    ["24000.07", "0.05", "24000.05"],
    ["24000.075", "0.05", "24000.1"],
    ["-24000.075", "0.05", "-24000.1"],
    ["-0.025", "0.05", "-0.05"],
    ["0.024", "0.05", "0"],
    ["83.1234", "0.0025", "83.1225"],
    ["72345.5", "1", "72346"],
  ])("rounds %s to the nearest %s tick, ties away from zero", (price, tick, expected) => {
    expect(roundToTick(price, tick, "nearest")).toBe(expected);
  });

  it("rounds down to the floor and up to the ceiling, also for negative prices", () => {
    expect(roundToTick("1.03", "0.05", "down")).toBe("1");
    expect(roundToTick("1.03", "0.05", "up")).toBe("1.05");
    expect(roundToTick("-1.03", "0.05", "down")).toBe("-1.05");
    expect(roundToTick("-1.03", "0.05", "up")).toBe("-1");
  });

  it("leaves a price that is already on a tick unchanged in every mode", () => {
    for (const mode of ["nearest", "down", "up"] as const) {
      expect(roundToTick("-1.05", "0.05", mode)).toBe("-1.05");
      expect(roundToTick("24000", "0.05", mode)).toBe("24000");
    }
  });

  it("rejects a tick size that is zero or negative", () => {
    for (const tick of ["0", "-0", "-0.05"]) {
      expect(() => roundToTick("100", tick, "nearest"), tick).toThrow(RangeError);
      expect(() => isOnTick("100", tick), tick).toThrow(/greater than 0/);
    }
  });

  it("rejects a tick size with more than 4 decimals", () => {
    expect(() => roundToTick("1", "0.00001", "down")).toThrow(/more than 4 decimals/);
  });

  it("rejects an unknown mode", () => {
    expect(() => roundToTick("1", "0.05", "ceil" as TickRounding)).toThrow(/Unknown tick rounding mode: "ceil"/);
  });

  it("throws a RangeError when the result has more than 14 integer digits", () => {
    expect(() => roundToTick("99999999999999.99", "0.05", "up")).toThrow(RangeError);
    expect(roundToTick("99999999999999.99", "0.05", "down")).toBe("99999999999999.95");
  });
});

describe("isOnTick", () => {
  it("checks whether a price is a multiple of the tick size", () => {
    expect(isOnTick("24000.05", "0.05")).toBe(true);
    expect(isOnTick("24000.07", "0.05")).toBe(false);
    expect(isOnTick("-1.05", "0.05")).toBe(true);
    expect(isOnTick("0", "0.05")).toBe(true);
    expect(isOnTick("83.1225", "0.0025")).toBe(true);
    expect(isOnTick("83.1226", "0.0025")).toBe(false);
    expect(isOnTick("1.00001", "0.00001")).toBe(true);
  });
});

describe("formatInr", () => {
  it("formats INR with lakh and crore grouping", () => {
    expect(formatInr("0")).toBe("₹0.00");
    expect(formatInr("999.5")).toBe("₹999.50");
    expect(formatInr("100000")).toBe("₹1,00,000.00");
    expect(formatInr("-12345678.9")).toBe("-₹1,23,45,678.90");
  });

  it("groups thousands, lakhs and crores at every length", () => {
    expect(formatInr("1000")).toBe("₹1,000.00");
    expect(formatInr("12345")).toBe("₹12,345.00");
    expect(formatInr("123456")).toBe("₹1,23,456.00");
    expect(formatInr("10000000")).toBe("₹1,00,00,000.00");
    expect(formatInr("1000000000000")).toBe("₹10,00,00,00,00,000.00");
  });

  it.each<[string, FormatInrOptions, string]>([
    ["1234.565", {}, "₹1,234.57"],
    ["1234.5", { decimals: 0 }, "₹1,235"],
    ["-1234.5", { decimals: 0 }, "-₹1,235"],
    ["1.2", { decimals: 4 }, "₹1.2000"],
    ["0.00005", { decimals: 4 }, "₹0.0001"],
  ])("rounds %s half-up with %o to %s", (value, options, expected) => {
    expect(formatInr(value, options)).toBe(expected);
  });

  it("adds a plus sign on request and never signs zero", () => {
    expect(formatInr("1250", { sign: "always" })).toBe("+₹1,250.00");
    expect(formatInr("-5", { sign: "always" })).toBe("-₹5.00");
    expect(formatInr("0", { sign: "always" })).toBe("₹0.00");
    expect(formatInr("0.004", { sign: "always" })).toBe("₹0.00");
  });

  it("omits the rupee symbol on request", () => {
    expect(formatInr("-12345678.9", { symbol: false })).toBe("-1,23,45,678.90");
    expect(formatInr("1", { symbol: false, sign: "always" })).toBe("+1.00");
  });

  it("rejects unknown options", () => {
    expect(() => formatInr("1", { decimals: 3 } as unknown as FormatInrOptions)).toThrow(/decimals must be 0, 2 or 4/);
    expect(() => formatInr("1", { sign: "never" } as unknown as FormatInrOptions)).toThrow(/Unknown sign: "never"/);
  });

  it("formats without Intl, so server and browser render the same text", () => {
    vi.stubGlobal("Intl", undefined);
    try {
      expect(formatInr("-12345678.9")).toBe("-₹1,23,45,678.90");
      expect(formatInrCompact("12300000")).toBe("₹1.23 Cr");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("formatInrCompact", () => {
  it("formats compact INR at the K, L and Cr thresholds", () => {
    expect(formatInrCompact("999")).toBe("₹999");
    expect(formatInrCompact("1000")).toBe("₹1 K");
    expect(formatInrCompact("12300")).toBe("₹12.3 K");
    expect(formatInrCompact("99999")).toBe("₹1 L");
    expect(formatInrCompact("100000")).toBe("₹1 L");
    expect(formatInrCompact("4560000")).toBe("₹45.6 L");
    expect(formatInrCompact("10000000")).toBe("₹1 Cr");
    expect(formatInrCompact("12300000")).toBe("₹1.23 Cr");
  });

  it.each<[string, string]>([
    ["999.994", "₹999.99"],
    ["999.995", "₹1 K"],
    ["999.999", "₹1 K"],
    ["99994.99", "₹99.99 K"],
    ["99999.999", "₹1 L"],
    ["9999499.99", "₹99.99 L"],
    ["9999999.999", "₹1 Cr"],
    ["-999.999", "-₹1 K"],
  ])("rounds %s at a unit boundary to %s", (value, expected) => {
    expect(formatInrCompact(value)).toBe(expected);
  });

  it("carries into the next unit with maxDecimals 0 too", () => {
    expect(formatInrCompact("999.5", { maxDecimals: 0 })).toBe("₹1 K");
    expect(formatInrCompact("99499", { maxDecimals: 0 })).toBe("₹99 K");
    expect(formatInrCompact("99500", { maxDecimals: 0 })).toBe("₹1 L");
  });

  it("shows up to maxDecimals decimals and trims trailing zeros", () => {
    expect(formatInrCompact("1234567")).toBe("₹12.35 L");
    expect(formatInrCompact("1234567", { maxDecimals: 0 })).toBe("₹12 L");
    expect(formatInrCompact("1234567", { maxDecimals: 4 })).toBe("₹12.3457 L");
    expect(formatInrCompact("1200000")).toBe("₹12 L");
    expect(formatInrCompact("0.5")).toBe("₹0.5");
    expect(formatInrCompact("0")).toBe("₹0");
  });

  it("signs negative values and groups large crore amounts", () => {
    expect(formatInrCompact("-12300000")).toBe("-₹1.23 Cr");
    expect(formatInrCompact("1000000000000")).toBe("₹1,00,000 Cr");
    expect(formatInrCompact(new ForeignDecimal("-45600000000"))).toBe("-₹4,560 Cr");
  });

  it("rejects maxDecimals outside 0–4", () => {
    for (const maxDecimals of [5, -1, 1.5]) {
      expect(() => formatInrCompact("1", { maxDecimals } as unknown as { maxDecimals: 2 })).toThrow(RangeError);
    }
  });
});
