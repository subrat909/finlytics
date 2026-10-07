import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";

import {
  canonicalStrike,
  dateToExpiry,
  expiryToDate,
  formatInstrumentKey,
  instrumentKeyFromParam,
  InstrumentKeySchema,
  instrumentKeyToParam,
  isInstrumentKey,
  MAX_INSTRUMENT_KEY_LENGTH,
  normalizeInstrumentKey,
  parseInstrumentKey,
} from "../instrument-key";
import type {
  InstrumentKey,
  InstrumentKeyError,
  InstrumentKeyErrorReason,
  InstrumentKeyParts,
  IsoDate,
  ParsedInstrumentKey,
} from "../instrument-key";
import { toDecimal } from "../money";
import { err, ok } from "../types/result";
import type { Result } from "../types/result";

/** A second, independent decimal.js copy: stands in for the one Prisma bundles (see money.test.ts). */
const { default: ForeignDecimal } = await import("decimal.js/decimal.js");

const NIFTY_CE = "NSE_FO|NIFTY|2025-10-30|24000|CE";

function reasonOf(result: Result<unknown, InstrumentKeyError>): InstrumentKeyErrorReason | undefined {
  return result.ok ? undefined : result.error.reason;
}

function errorOf(result: Result<unknown, InstrumentKeyError>): InstrumentKeyError {
  if (result.ok) throw new Error("expected a failed result");
  return result.error;
}

function key(text: string): InstrumentKey {
  const parsed = parseInstrumentKey(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.key;
}

describe("parseInstrumentKey", () => {
  it("parses equity, index, future and option keys with Prisma exchange and segment", () => {
    expect(parseInstrumentKey("NSE_EQ|INFY")).toEqual(
      ok({ key: "NSE_EQ|INFY", token: "NSE_EQ", exchange: "NSE", segment: "EQ", symbol: "INFY" }),
    );
    expect(parseInstrumentKey("BSE_INDEX|SENSEX")).toEqual(
      ok({ key: "BSE_INDEX|SENSEX", token: "BSE_INDEX", exchange: "BSE", segment: "INDEX", symbol: "SENSEX" }),
    );
    expect(parseInstrumentKey("MCX_FO|CRUDEOIL|2025-11-19")).toEqual(
      ok({
        key: "MCX_FO|CRUDEOIL|2025-11-19",
        token: "MCX_FO",
        exchange: "MCX",
        segment: "FUT",
        symbol: "CRUDEOIL",
        expiry: "2025-11-19",
      }),
    );
    expect(parseInstrumentKey(NIFTY_CE)).toEqual(
      ok({
        key: NIFTY_CE,
        token: "NSE_FO",
        exchange: "NFO",
        segment: "OPT",
        symbol: "NIFTY",
        expiry: "2025-10-30",
        strike: "24000",
        optionType: "CE",
      }),
    );
  });

  it.each<[string, string, string]>([
    ["NSE_INDEX|NIFTY 50", "NSE", "INDEX"],
    ["BSE_EQ|500325", "BSE", "EQ"],
    ["NSE_FO|BANKNIFTY|2025-10-28", "NFO", "FUT"],
    ["BSE_FO|SENSEX|2025-10-30|82000|PE", "BFO", "OPT"],
    ["NSE_CD|USDINR|2025-10-29", "CDS", "FUT"],
    ["NSE_CD|USDINR|2025-10-29|83.25|CE", "CDS", "OPT"],
    ["MCX_FO|GOLDM|2025-11-26|120000|PE", "MCX", "OPT"],
  ])("maps %s to exchange %s and segment %s", (text, exchange, segment) => {
    expect(parseInstrumentKey(text)).toMatchObject({ ok: true, value: { key: text, exchange, segment } });
  });

  it("narrows the parsed key by segment", () => {
    const parsed = parseInstrumentKey(NIFTY_CE);

    if (!parsed.ok || parsed.value.segment !== "OPT") throw new Error("expected an option key");
    expectTypeOf(parsed.value.key).toEqualTypeOf<InstrumentKey>();
    expectTypeOf(parsed.value.expiry).toEqualTypeOf<IsoDate>();
    expectTypeOf(parsed.value.optionType).toEqualTypeOf<"CE" | "PE">();
    expect(parsed.value.strike).toBe("24000");
  });

  it("accepts every symbol character, single inner spaces and symbols of 1 to 64 characters", () => {
    for (const symbol of [
      "M&M",
      "BAJAJ-AUTO",
      "J&KBANK",
      "NIFTY 50",
      "S&P BSE SENSEX",
      "ICICI PRU (E)",
      "A.B_C(D)/E-F&G",
      "3IINFOTECH",
      "A (( &&",
      "A",
      "Z".repeat(64),
      `${"A".repeat(31)} ${"B".repeat(32)}`,
    ]) {
      expect(parseInstrumentKey(`NSE_EQ|${symbol}`), symbol).toMatchObject({ ok: true, value: { symbol } });
    }
  });

  it("rejects a key whose arity does not match its segment token", () => {
    for (const text of [
      "NSE_EQ",
      "NSE_EQ|INFY|2025-10-30",
      "NSE_EQ|IN|FY",
      "NSE_INDEX|NIFTY|2025-10-30|24000|CE",
      "NSE_FO|NIFTY",
      "NSE_FO|NIFTY|2025-10-30|24000",
      "NSE_FO|NIFTY|2025-10-30|24000|CE|X",
      "MCX_FO|CRUDEOIL|2025-11-19|",
    ]) {
      expect(reasonOf(parseInstrumentKey(text)), text).toBe("ARITY");
    }
    expect(errorOf(parseInstrumentKey("NSE_FO|NIFTY|2025-10-30|24000")).message).toBe(
      "NSE_FO keys have 3 parts (a future: token|symbol|expiry) or 5 parts " +
        "(an option: token|symbol|expiry|strike|CE or PE), got 4",
    );
    expect(errorOf(parseInstrumentKey("NSE_EQ|INFY|X")).message).toBe("NSE_EQ keys have 2 parts (token|symbol), got 3");
  });

  it("rejects unknown segment tokens, including other casing and prototype keys", () => {
    for (const text of [
      "",
      "INFY",
      "nse_eq|INFY",
      "NSE|INFY",
      "NFO|NIFTY|2025-10-30",
      "NSE_FUT|NIFTY|2025-10-30",
      " NSE_EQ|INFY",
      "NSE_EQ |INFY",
      "toString|INFY",
      "__proto__|INFY",
      "constructor|INFY",
    ]) {
      expect(reasonOf(parseInstrumentKey(text)), JSON.stringify(text)).toBe("TOKEN");
    }
    expect(errorOf(parseInstrumentKey("NSE_XX|INFY")).message).toBe(
      'Unknown segment token "NSE_XX"; expected one of NSE_EQ, NSE_INDEX, NSE_FO, NSE_CD, BSE_EQ, BSE_INDEX, BSE_FO, MCX_FO',
    );
  });

  it("rejects lowercase symbols in strict mode", () => {
    for (const symbol of ["infy", "Infy", "nifty 50", "m&m"]) {
      const error = errorOf(parseInstrumentKey(`NSE_EQ|${symbol}`));

      expect(error.reason, symbol).toBe("SYMBOL");
      expect(error.message, symbol).toMatch(/symbols are uppercase \(display case lives in Instrument\.name\)$/);
    }
  });

  it("rejects symbols outside the grammar", () => {
    for (const symbol of [
      "",
      " INFY",
      "INFY ",
      "NIFTY  50",
      "-INFY",
      "&M",
      "(E)",
      "INF'Y",
      "INF+Y",
      "INF,Y",
      "INF%Y",
      "INF:Y",
      "INF\tY",
      "INF\nY",
      "INFY\u00a0",
      "ÄBC",
      "ＩＮＦＹ",
      "A".repeat(65),
    ]) {
      expect(reasonOf(parseInstrumentKey(`NSE_EQ|${symbol}`)), JSON.stringify(symbol)).toBe("SYMBOL");
    }
    expect(errorOf(parseInstrumentKey("NSE_EQ|INF'Y")).message).toBe(
      'Invalid symbol "INF\'Y": expected 1–64 characters from A–Z, 0–9, space and & - . _ ( ) /, starting with a ' +
        "letter or digit, with single spaces between words",
    );
  });

  it("rejects 2026-02-30 as an expiry", () => {
    expect(parseInstrumentKey("NSE_FO|NIFTY|2026-02-30")).toEqual(
      err({ reason: "EXPIRY", message: 'Expiry "2026-02-30" is not a calendar date' }),
    );
    expect(reasonOf(parseInstrumentKey("NSE_FO|NIFTY|2026-02-30|24000|CE"))).toBe("EXPIRY");
  });

  it("accepts leap days and the first and last days of 2000–2099", () => {
    for (const expiry of ["2000-01-01", "2000-02-29", "2024-02-29", "2026-02-28", "2025-12-31", "2099-12-31"]) {
      expect(parseInstrumentKey(`NSE_FO|NIFTY|${expiry}`), expiry).toMatchObject({ ok: true, value: { expiry } });
    }
  });

  it("rejects expiries that are not YYYY-MM-DD calendar dates from 2000 to 2099", () => {
    const rejected = {
      notACalendarDate: ["2025-02-29", "2100-02-29", "2025-04-31", "2025-13-01", "2025-00-10", "2025-01-00"],
      outsideTheYears: ["1999-12-31", "2100-01-01", "0000-01-01", "9999-12-31"],
      notYyyyMmDd: ["", "2025-1-05", "20251030", "2025/10/30", "30-10-2025", "2025-10-30T00:00:00Z", " 2025-10-30"],
      notAsciiDigits: ["２０２５-10-30", "2025-10-3O"],
    };

    for (const expiry of Object.values(rejected).flat()) {
      expect(reasonOf(parseInstrumentKey(`NSE_FO|NIFTY|${expiry}`)), JSON.stringify(expiry)).toBe("EXPIRY");
    }
    expect(errorOf(parseInstrumentKey("NSE_FO|NIFTY|1999-12-31")).message).toBe(
      'Expiry "1999-12-31" is outside the years 2000–2099',
    );
    expect(errorOf(parseInstrumentKey("NSE_FO|NIFTY|2025/10/30")).message).toBe(
      'Expiry "2025/10/30" is not a YYYY-MM-DD date',
    );
  });

  it("rejects non-canonical strikes in strict mode and normalises them in lenient mode", () => {
    const pairs: [nonCanonical: string, canonical: string][] = [
      ["24000.00", "24000"],
      ["24000.0", "24000"],
      ["82.50", "82.5"],
      ["0.0500", "0.05"],
      ["83.2500000", "83.25"],
    ];

    for (const [nonCanonical, canonical] of pairs) {
      const text = `NSE_FO|NIFTY|2025-10-30|${nonCanonical}|CE`;

      expect(reasonOf(parseInstrumentKey(text)), text).toBe("STRIKE");
      expect(normalizeInstrumentKey(text), text).toEqual(ok(`NSE_FO|NIFTY|2025-10-30|${canonical}|CE`));
    }
  });

  it("accepts canonical strikes and rejects every other strike in strict mode", () => {
    for (const strike of ["24000", "82.5", "0.05", "83.25", "0.0001", "99999999999999.9999"]) {
      expect(parseInstrumentKey(`NSE_FO|NIFTY|2025-10-30|${strike}|CE`), strike).toMatchObject({
        ok: true,
        value: { strike },
      });
    }
    for (const strike of [
      "0",
      "024000",
      "-24000",
      "+24000",
      "2.4e4",
      "24000.",
      ".5",
      "24,000",
      "100000000000000",
      "0.00001",
      "",
    ]) {
      expect(reasonOf(parseInstrumentKey(`NSE_FO|NIFTY|2025-10-30|${strike}|CE`)), strike).toBe("STRIKE");
    }
    expect(errorOf(parseInstrumentKey("NSE_FO|NIFTY|2025-10-30|0|CE")).message).toBe(
      'Strike must be greater than 0, got "0"',
    );
  });

  it("rejects option types other than CE and PE", () => {
    for (const optionType of ["ce", "Pe", "C", "CALL", "XX", "", "CE ", " PE"]) {
      expect(reasonOf(parseInstrumentKey(`NSE_FO|NIFTY|2025-10-30|24000|${optionType}`)), optionType).toBe(
        "OPTION_TYPE",
      );
    }
    expect(errorOf(parseInstrumentKey("NSE_FO|NIFTY|2025-10-30|24000|XX")).message).toBe(
      'Option type "XX" must be CE or PE',
    );
  });

  it("reports the first failing part in key order", () => {
    expect(reasonOf(parseInstrumentKey("nse_fo|nifty|2026-02-30|24000.00|XX"))).toBe("TOKEN");
    expect(reasonOf(parseInstrumentKey("NSE_FO|nifty|2026-02-30|24000.00|XX"))).toBe("SYMBOL");
    expect(reasonOf(parseInstrumentKey("NSE_FO|NIFTY|2026-02-30|24000.00|XX"))).toBe("EXPIRY");
    expect(reasonOf(parseInstrumentKey("NSE_FO|NIFTY|2026-02-27|24000.00|XX"))).toBe("STRIKE");
    expect(reasonOf(parseInstrumentKey("NSE_FO|NIFTY|2026-02-27|24000|XX"))).toBe("OPTION_TYPE");
    expect(reasonOf(parseInstrumentKey("NSE_FO|NIFTY|2026-02-27|24000|PE"))).toBeUndefined();
  });

  it("rejects keys over 128 chars before pattern matching", () => {
    // 129 characters with a valid token: past the length check, this would fail on its 122-character symbol.
    const tooLong = `NSE_EQ|${"A".repeat(122)}`;
    const exec = vi.spyOn(RegExp.prototype, "exec");
    const test = vi.spyOn(RegExp.prototype, "test");
    let results: Result<unknown, InstrumentKeyError>[];
    let regexCalls: number;
    try {
      results = [
        parseInstrumentKey(tooLong),
        normalizeInstrumentKey(tooLong),
        parseInstrumentKey("|".repeat(100_000)),
        normalizeInstrumentKey(`a${" ".repeat(200)}b`),
      ];
      regexCalls = exec.mock.calls.length + test.mock.calls.length;
    } finally {
      exec.mockRestore();
      test.mockRestore();
    }

    expect(tooLong).toHaveLength(MAX_INSTRUMENT_KEY_LENGTH + 1);
    expect(results.map(reasonOf)).toEqual(["LENGTH", "LENGTH", "LENGTH", "LENGTH"]);
    expect(regexCalls).toBe(0);
    expect(results[0]).toEqual(
      err({ reason: "LENGTH", message: "Instrument key is 129 characters long; the maximum is 128" }),
    );
    // Exactly 128 characters passes the length check and fails on the symbol instead.
    expect(reasonOf(parseInstrumentKey(tooLong.slice(0, -1)))).toBe("SYMBOL");
  });

  it("truncates caller input in error messages", () => {
    const message = errorOf(parseInstrumentKey(`NSE_EQ|${"a".repeat(100)}`)).message;

    expect(message).toContain(`"${"a".repeat(40)}…"`);
    expect(message).not.toContain("a".repeat(41));
  });

  it("throws a TypeError for a value that is not a string", () => {
    expect(() => parseInstrumentKey(42 as unknown as string)).toThrow(
      "Expected an instrument key as a string, got number",
    );
    expect(() => normalizeInstrumentKey(null as unknown as string)).toThrow(TypeError);
    expect(() => instrumentKeyFromParam(undefined as unknown as string)).toThrow(TypeError);
  });
});

describe("normalizeInstrumentKey", () => {
  it("trims, uppercases and canonicalises the strike", () => {
    expect(normalizeInstrumentKey("  nse_fo | nifty | 2025-10-30 | 24000.00 | ce  ")).toEqual(ok(NIFTY_CE));
    expect(normalizeInstrumentKey("\tnse_index|Nifty 50\n")).toEqual(ok("NSE_INDEX|NIFTY 50"));
    expect(normalizeInstrumentKey("\u00a0bse_eq|m&m\u3000")).toEqual(ok("BSE_EQ|M&M"));
  });

  it("leaves canonical keys unchanged", () => {
    for (const text of ["NSE_EQ|INFY", "NSE_INDEX|NIFTY 50", "MCX_FO|CRUDEOIL|2025-11-19", NIFTY_CE]) {
      expect(normalizeInstrumentKey(text), text).toEqual(ok(text));
    }
  });

  it("keeps whitespace inside a part, so double spaces are still rejected", () => {
    expect(reasonOf(normalizeInstrumentKey("NSE_INDEX|NIFTY  50"))).toBe("SYMBOL");
    expect(reasonOf(normalizeInstrumentKey("NSE _EQ|INFY"))).toBe("TOKEN");
    expect(reasonOf(normalizeInstrumentKey("NSE_FO|NIFTY|2025-10 -30"))).toBe("EXPIRY");
  });

  it("uppercases ASCII letters only, so look-alike letters are rejected", () => {
    for (const text of ["nse_eq|ınfy", "nse_eq|ſbin", "nse_eq|ﬀ", "nse_eq|straße"]) {
      expect(reasonOf(normalizeInstrumentKey(text)), text).toBe("SYMBOL");
    }
  });

  it("rejects a strike it can't make canonical, and never rounds", () => {
    const strikeError = (strike: string) =>
      errorOf(normalizeInstrumentKey(`NSE_FO|NIFTY|2025-10-30|${strike}|CE`)).message;

    expect(strikeError("24000.12345")).toBe('Strike "24000.12345" has more than 4 decimals; strikes are never rounded');
    expect(strikeError("0.0000")).toBe('Strike must be greater than 0, got "0.0000"');
    expect(strikeError("100000000000000")).toBe('Strike "100000000000000" has more than 14 integer digits');
    expect(strikeError("024000")).toBe('Strike "024000" is not a plain decimal number');
    for (const strike of ["-24000", "1e5", "24,000", "abc", ""]) {
      expect(reasonOf(normalizeInstrumentKey(`NSE_FO|NIFTY|2025-10-30|${strike}|CE`)), strike).toBe("STRIKE");
    }
  });

  it("doesn't repair expiries", () => {
    expect(reasonOf(normalizeInstrumentKey("NSE_FO|NIFTY|30-10-2025"))).toBe("EXPIRY");
    expect(reasonOf(normalizeInstrumentKey("NSE_FO|NIFTY|2025-1-5"))).toBe("EXPIRY");
  });

  it("checks the length after trimming the whole key", () => {
    expect(normalizeInstrumentKey(`${" ".repeat(500)}NSE_EQ|INFY${" ".repeat(500)}`)).toEqual(ok("NSE_EQ|INFY"));
    expect(reasonOf(normalizeInstrumentKey(`NSE_EQ|${"A".repeat(122)}`))).toBe("LENGTH");
  });
});

describe("InstrumentKeySchema and isInstrumentKey", () => {
  it("brands valid keys and explains invalid ones with their reason", () => {
    const parsed = InstrumentKeySchema.parse(NIFTY_CE);

    expect(parsed).toBe(NIFTY_CE);
    expectTypeOf(parsed).toEqualTypeOf<InstrumentKey>();
    expectTypeOf<z.infer<typeof InstrumentKeySchema>>().toEqualTypeOf<InstrumentKey>();
    expect(InstrumentKeySchema.safeParse("NSE_FO|NIFTY|2026-02-30").error?.issues).toEqual([
      { code: "custom", path: [], message: 'Expiry "2026-02-30" is not a calendar date', params: { reason: "EXPIRY" } },
    ]);
    expect(InstrumentKeySchema.safeParse(42).error?.issues).toMatchObject([
      { code: "invalid_type", expected: "string" },
    ]);
  });

  it("is strict: it never normalises", () => {
    for (const text of [" NSE_EQ|INFY", "nse_eq|INFY", "NSE_FO|NIFTY|2025-10-30|24000.00|CE"]) {
      expect(InstrumentKeySchema.safeParse(text).success, text).toBe(false);
    }
  });

  it("recognises canonical keys only", () => {
    expect(isInstrumentKey(NIFTY_CE)).toBe(true);
    expect(isInstrumentKey("NSE_INDEX|NIFTY 50")).toBe(true);
    for (const value of [" NSE_EQ|INFY", "NSE_EQ|infy", 42, null, undefined, {}, ["NSE_EQ|INFY"]]) {
      expect(isInstrumentKey(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("narrows unknown values and keeps plain strings out of the brand", () => {
    const value: unknown = "NSE_EQ|INFY";
    if (!isInstrumentKey(value)) throw new Error("expected a key");
    expectTypeOf(value).toEqualTypeOf<InstrumentKey>();

    // @ts-expect-error -- a plain string is not an InstrumentKey: it must come from a parser or formatInstrumentKey.
    const notAKey: InstrumentKey = "NSE_EQ|INFY";
    expect(notAKey).toBe(value);
  });
});

describe("formatInstrumentKey", () => {
  it("joins parts into a canonical key", () => {
    expect(formatInstrumentKey({ segment: "EQ", token: "NSE_EQ", symbol: "INFY" })).toBe("NSE_EQ|INFY");
    expect(formatInstrumentKey({ segment: "INDEX", token: "NSE_INDEX", symbol: "NIFTY 50" })).toBe(
      "NSE_INDEX|NIFTY 50",
    );
    expect(formatInstrumentKey({ segment: "FUT", token: "MCX_FO", symbol: "CRUDEOIL", expiry: "2025-11-19" })).toBe(
      "MCX_FO|CRUDEOIL|2025-11-19",
    );
    expect(
      formatInstrumentKey({
        segment: "OPT",
        token: "NSE_FO",
        symbol: "NIFTY",
        expiry: "2025-10-30",
        strike: canonicalStrike("24000.00"),
        optionType: "CE",
      }),
    ).toBe(NIFTY_CE);
  });

  it("accepts a parsed key as its parts", () => {
    const parsed = parseInstrumentKey(NIFTY_CE);
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(formatInstrumentKey(parsed.value)).toBe(NIFTY_CE);
  });

  it("throws a RangeError, with the reason as its cause, for parts that don't form a canonical key", () => {
    const attempts: [InstrumentKeyParts, InstrumentKeyErrorReason][] = [
      [{ segment: "EQ", token: "NSE_EQ", symbol: "infy" }, "SYMBOL"],
      [{ segment: "FUT", token: "NSE_FO", symbol: "NIFTY", expiry: "2026-02-30" }, "EXPIRY"],
      [
        {
          segment: "OPT",
          token: "NSE_FO",
          symbol: "NIFTY",
          expiry: "2025-10-30",
          strike: "24000.00",
          optionType: "CE",
        },
        "STRIKE",
      ],
      [{ segment: "FUT", token: "NSE_EQ", symbol: "INFY", expiry: "2025-10-30" }, "ARITY"],
    ];

    for (const [parts, reason] of attempts) {
      let thrown: unknown;
      try {
        formatInstrumentKey(parts);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, reason).toBeInstanceOf(RangeError);
      expect((thrown as RangeError).message, reason).toMatch(/^Invalid instrument key parts: /);
      expect((thrown as RangeError).cause, reason).toMatchObject({ reason });
    }
  });

  it("throws when the token doesn't carry the segment", () => {
    expect(() => formatInstrumentKey({ segment: "EQ", token: "NSE_INDEX", symbol: "NIFTY" })).toThrow(
      "NSE_INDEX|NIFTY has segment INDEX, not EQ",
    );
    const untyped = { segment: "BOND", token: "NSE_EQ", symbol: "INFY" } as unknown as InstrumentKeyParts;
    expect(() => formatInstrumentKey(untyped)).toThrow("NSE_EQ|INFY has segment EQ, not BOND");
  });
});

describe("canonicalStrike", () => {
  it("renders strikes canonically from strings and Decimal-like values", () => {
    expect(canonicalStrike("24000")).toBe("24000");
    expect(canonicalStrike("24000.00")).toBe("24000");
    expect(canonicalStrike("82.50")).toBe("82.5");
    expect(canonicalStrike("0.0500")).toBe("0.05");
    expect(canonicalStrike("99999999999999.9999")).toBe("99999999999999.9999");
    expect(canonicalStrike(new ForeignDecimal("24000.0000"))).toBe("24000");
    expect(canonicalStrike(toDecimal("83.25"))).toBe("83.25");
    expect(canonicalStrike({ toFixed: () => "82.5000" })).toBe("82.5");
  });

  it("rejects strikes that are not positive, or have more than 4 decimals or 14 integer digits", () => {
    expect(() => canonicalStrike("0")).toThrow('Strike must be greater than 0, got "0"');
    expect(() => canonicalStrike("-50")).toThrow(RangeError);
    expect(() => canonicalStrike("0.00001")).toThrow('Strike "0.00001" has more than 4 decimals');
    expect(() => canonicalStrike("24000.12345")).toThrow(/never rounded/);
    expect(() => canonicalStrike("100000000000000")).toThrow(
      'Strike "100000000000000" has more than 14 integer digits',
    );
  });

  it("rejects values that are not decimals with a TypeError", () => {
    expect(() => canonicalStrike("1e5")).toThrow(TypeError);
    expect(() => canonicalStrike("024000")).toThrow(TypeError);
    // @ts-expect-error -- numbers are not DecimalLike.
    expect(() => canonicalStrike(24000)).toThrow(TypeError);
  });
});

describe("expiry dates", () => {
  it("converts expiries to and from Dates at UTC midnight", () => {
    expect(expiryToDate("2025-10-30" as IsoDate).toISOString()).toBe("2025-10-30T00:00:00.000Z");
    expect(expiryToDate("2024-02-29" as IsoDate).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(dateToExpiry(new Date(Date.UTC(2025, 9, 30)))).toBe("2025-10-30");
    expect(dateToExpiry(new Date("2000-01-01T00:00:00.000Z"))).toBe("2000-01-01");
    expect(dateToExpiry(new Date("2099-12-31T00:00:00.000Z"))).toBe("2099-12-31");
    expectTypeOf(dateToExpiry).returns.toEqualTypeOf<IsoDate>();
  });

  it("round-trips the expiry of a parsed key", () => {
    const parsed = parseInstrumentKey(NIFTY_CE);
    if (!parsed.ok || parsed.value.segment !== "OPT") throw new Error("expected an option key");

    expect(dateToExpiry(expiryToDate(parsed.value.expiry))).toBe(parsed.value.expiry);
  });

  it("rejects Dates with a time of day, such as midnight in IST", () => {
    expect(() => dateToExpiry(new Date("2025-10-30T00:00:00+05:30"))).toThrow(
      "Expected a Date at UTC midnight, got 2025-10-29T18:30:00.000Z; build it with Date.UTC",
    );
    expect(() => dateToExpiry(new Date(Date.UTC(2025, 9, 30, 0, 0, 0, 1)))).toThrow(RangeError);
  });

  it("rejects invalid Dates, years outside 2000–2099 and values that are not Dates", () => {
    expect(() => dateToExpiry(new Date(Number.NaN))).toThrow("Expected a valid Date, got an Invalid Date");
    expect(() => dateToExpiry(new Date(Date.UTC(1999, 11, 31)))).toThrow(
      "Expiry year must be from 2000 to 2099, got 1999",
    );
    expect(() => dateToExpiry(new Date(Date.UTC(2100, 0, 1)))).toThrow(RangeError);
    for (const value of ["2025-10-30", 1_761_782_400_000, null, {}, { getTime: () => 0 }]) {
      expect(() => dateToExpiry(value as unknown as Date), JSON.stringify(value)).toThrow(TypeError);
    }
  });

  it("rejects strings cast to IsoDate that are not expiries", () => {
    let thrown: unknown;
    try {
      expiryToDate("2026-02-30" as IsoDate);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as RangeError).cause).toMatchObject({ reason: "EXPIRY" });
    expect(() => expiryToDate("1999-12-31" as IsoDate)).toThrow(RangeError);
    expect(() => expiryToDate(20_251_030 as unknown as IsoDate)).toThrow(TypeError);
  });
});

describe("URL params", () => {
  it("round-trips keys through URL params", () => {
    for (const text of [
      NIFTY_CE,
      "NSE_INDEX|NIFTY 50",
      "NSE_EQ|M&M",
      "BSE_EQ|A/B",
      "NSE_EQ|ICICI PRU (E)",
      "NSE_CD|USDINR|2025-10-29|83.25|PE",
    ]) {
      const param = instrumentKeyToParam(key(text));

      // encodeURIComponent's output alphabet: nothing that can split a path segment or a query.
      expect(param, text).toMatch(/^[A-Za-z0-9\-_.!~*'()%]+$/);
      expect(instrumentKeyFromParam(param), text).toMatchObject({ ok: true, value: { key: text } });
    }
    expect(instrumentKeyToParam(key("NSE_INDEX|NIFTY 50"))).toBe("NSE_INDEX%7CNIFTY%2050");
    expect(instrumentKeyToParam(key("NSE_EQ|M&M"))).toBe("NSE_EQ%7CM%26M");
  });

  it("returns an ENCODING error for malformed percent-encoding instead of throwing", () => {
    for (const param of ["%E0%A4%A", "%", "NSE_EQ%7", "%ZZ", "%C3%28", "%ED%A0%80"]) {
      expect(reasonOf(instrumentKeyFromParam(param)), param).toBe("ENCODING");
    }
    expect(errorOf(instrumentKeyFromParam("%E0%A4%A")).message).toBe(
      'URL parameter "%E0%A4%A" is not valid percent-encoding',
    );
  });

  it("accepts a parameter the framework has already decoded", () => {
    expect(instrumentKeyFromParam("NSE_INDEX|NIFTY 50")).toMatchObject({ ok: true, value: { symbol: "NIFTY 50" } });
  });

  it("parses the decoded key strictly", () => {
    expect(reasonOf(instrumentKeyFromParam("nse_eq%7Cinfy"))).toBe("TOKEN");
    expect(reasonOf(instrumentKeyFromParam("NSE_EQ%7CINFY%20"))).toBe("SYMBOL");
    expect(reasonOf(instrumentKeyFromParam("NSE_FO%7CNIFTY%7C2025-10-30%7C24000.00%7CCE"))).toBe("STRIKE");
  });

  it("rejects parameters longer than any encoded key before decoding them", () => {
    const decode = vi.spyOn(globalThis, "decodeURIComponent");
    let result: Result<ParsedInstrumentKey, InstrumentKeyError>;
    let decodeCalls: number;
    try {
      result = instrumentKeyFromParam("%7C".repeat(129));
      decodeCalls = decode.mock.calls.length;
    } finally {
      decode.mockRestore();
    }

    expect(result).toEqual(
      err({
        reason: "LENGTH",
        message: "URL parameter is 387 characters long; an encoded instrument key has at most 384",
      }),
    );
    expect(decodeCalls).toBe(0);
    // 384 characters are decoded; this one decodes to 128 pipes, so it fails on the token instead.
    expect(reasonOf(instrumentKeyFromParam("%7C".repeat(128)))).toBe("TOKEN");
  });
});
