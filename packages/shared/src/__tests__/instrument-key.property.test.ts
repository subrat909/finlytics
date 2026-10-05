import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SEGMENT_TOKEN_INFO, SEGMENT_TOKENS } from "../constants/exchanges";
import type { SegmentToken, SegmentTokenInfo } from "../constants/exchanges";
import {
  dateToExpiry,
  expiryToDate,
  formatInstrumentKey,
  instrumentKeyFromParam,
  instrumentKeyToParam,
  normalizeInstrumentKey,
  parseInstrumentKey,
} from "../instrument-key";
import type { InstrumentKeyErrorReason, InstrumentKeyParts, IsoDate } from "../instrument-key";
import { OPTION_TYPES } from "../schemas/enums";
import type { Segment } from "../schemas/enums";
import { ok } from "../types/result";

const RUNS = { numRuns: 500 };

// ---------------------------------------------------------------------------------------------------------------------
// Valid parts

/** The characters of an ASCII string. */
function chars(text: string): string[] {
  return Array.from(text);
}

const ALNUM = chars("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
const PUNCTUATION = chars("&-._()/");

/** Any symbol character except space; punctuation is rarer, as in real symbols. */
const wordChar = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...ALNUM) },
  { weight: 1, arbitrary: fc.constantFrom(...PUNCTUATION) },
);

/** A symbol: starts with a letter or digit; later words may start with punctuation; single spaces between words. */
const generatedSymbol = fc
  .tuple(
    fc.constantFrom(...ALNUM),
    fc.string({ unit: wordChar, maxLength: 12 }),
    fc.array(fc.string({ unit: wordChar, minLength: 1, maxLength: 12 }), { maxLength: 5 }),
  )
  .map(([lead, rest, words]) => [lead + rest, ...words].join(" "))
  .filter((symbol) => symbol.length <= 64);

const symbol = fc.oneof(
  { weight: 9, arbitrary: generatedSymbol },
  {
    weight: 1,
    arbitrary: fc.constantFrom("A", "M&M", "NIFTY 50", "Z".repeat(64), `${"A".repeat(31)} ${"(".repeat(32)}`),
  },
);

const expiry = fc.oneof(
  fc
    .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 31, 23, 59)), noInvalidDate: true })
    .map((date) => date.toISOString().slice(0, 10)),
  fc.constantFrom("2000-01-01", "2000-02-29", "2024-02-29", "2099-12-31"),
);

/** Canonical strikes: what toDecimalString renders for a positive Decimal(18,4). */
const strike = fc.stringMatching(/^(0|[1-9]\d{0,13})(\.\d{0,3}[1-9])?$/).filter((text) => text !== "0");

const optionType = fc.constantFrom(...OPTION_TYPES);

function tokensFor(kind: Segment): SegmentToken[] {
  return SEGMENT_TOKENS.filter((token) => {
    const info: SegmentTokenInfo = SEGMENT_TOKEN_INFO[token];
    return info.kinds.includes(kind);
  });
}

/** Parts of every kind, over every token that carries the kind. */
const parts: fc.Arbitrary<InstrumentKeyParts> = fc.oneof(
  fc.record({ token: fc.constantFrom(...tokensFor("EQ")), symbol }).map((p) => ({ segment: "EQ" as const, ...p })),
  fc
    .record({ token: fc.constantFrom(...tokensFor("INDEX")), symbol })
    .map((p) => ({ segment: "INDEX" as const, ...p })),
  fc
    .record({ token: fc.constantFrom(...tokensFor("FUT")), symbol, expiry })
    .map((p) => ({ segment: "FUT" as const, ...p })),
  fc
    .record({ token: fc.constantFrom(...tokensFor("OPT")), symbol, expiry, strike, optionType })
    .map((p) => ({ segment: "OPT" as const, ...p })),
);

/** The parts in key order, joined by the test itself so the key properties don't assume formatInstrumentKey. */
function partList(p: InstrumentKeyParts): string[] {
  if (p.segment === "OPT") return [p.token, p.symbol, p.expiry, p.strike, p.optionType];
  if (p.segment === "FUT") return [p.token, p.symbol, p.expiry];
  return [p.token, p.symbol];
}

const key = parts.map((p) => partList(p).join("|"));

// ---------------------------------------------------------------------------------------------------------------------
// Repairable variants: what normalizeInstrumentKey fixes

const whitespace = fc.string({ unit: fc.constantFrom(" ", "\t", "\n", "\u00a0", "\u3000"), maxLength: 2 });

/** A valid key with random lowercase letters, whitespace around every part and trailing zeros on the strike. */
const repairableVariant = fc
  .record({
    parts,
    lowercase: fc.array(fc.boolean(), { minLength: 128, maxLength: 128 }),
    padding: fc.array(fc.tuple(whitespace, whitespace), { minLength: 5, maxLength: 5 }),
    outer: fc.tuple(whitespace, whitespace),
    strikeZeros: fc.integer({ min: 0, max: 4 }),
  })
  .map(({ parts: p, lowercase, padding, outer, strikeZeros }) => {
    const list = partList(p);
    if (p.segment === "OPT" && strikeZeros > 0) {
      list[3] = p.strike.includes(".") ? p.strike + "0".repeat(strikeZeros) : `${p.strike}.${"0".repeat(strikeZeros)}`;
    }
    const padded = list.map((part, index) => {
      const [before = "", after = ""] = padding[index] ?? [];
      return before + part + after;
    });
    const cased = Array.from(padded.join("|"), (char, index) => (lowercase[index] ? char.toLowerCase() : char)).join(
      "",
    );
    return { parts: p, text: outer[0] + cased + outer[1] };
  });

// ---------------------------------------------------------------------------------------------------------------------
// Near misses: one part broken, tagged with the reason strict parsing must report

interface NearMiss {
  readonly text: string;
  readonly reason: InstrumentKeyErrorReason;
}

function replaced(list: readonly string[], index: number, value: string): string {
  return list.map((part, at) => (at === index ? value : part)).join("|");
}

const badToken = fc.constantFrom("nse_eq", "NSE", "NFO", "NSE_FUT", "NSE-EQ", "", " NSE_EQ", "toString", "__proto__");
const forbiddenChar = fc.constantFrom(...chars("'+,:;%#@!?*=<>\"\\\t\nÄé€\u00a0ı"));

/** Always invalid, whatever the symbol. */
function badSymbol(valid: string): fc.Arbitrary<string> {
  const at = fc.integer({ min: 0, max: valid.length });
  return fc.oneof(
    fc.constant(`${valid} `),
    fc.constant(` ${valid}`),
    fc.constant(`-${valid}`),
    fc.constant(""),
    fc.constant(`${valid}${"A".repeat(65)}`.slice(0, 65)),
    at.filter((index) => index > 0).map((index) => `${valid.slice(0, index)}  ${valid.slice(index)}`),
    fc.tuple(at, forbiddenChar).map(([index, char]) => valid.slice(0, index) + char + valid.slice(index)),
    // Lowercase one letter (or, for a symbol without letters, add a trailing space).
    at.map((index) => {
      const letters = chars(valid).flatMap((char, position) => (/[A-Z]/.test(char) ? [position] : []));
      if (letters.length === 0) return `${valid} `;
      const position = letters[index % letters.length] ?? 0;
      return valid.slice(0, position) + valid.charAt(position).toLowerCase() + valid.slice(position + 1);
    }),
  );
}

const badExpiry = fc.oneof(
  fc.constantFrom(
    "2026-02-30",
    "2025-02-29",
    "2100-02-29",
    "2025-04-31",
    "2025-13-01",
    "2025-00-10",
    "2025-01-00",
    "1999-12-31",
    "2100-01-01",
    "2025-1-05",
    "20251030",
    "2025/10/30",
    "30-10-2025",
    "",
    "2025-10-30 ",
    "2025-10-3O",
  ),
  // The day after the end of a month.
  fc
    .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 1)), noInvalidDate: true })
    .map((d) => {
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      return `${d.toISOString().slice(0, 8)}${String(lastDay + 1)}`;
    }),
);

function badStrike(valid: string): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom("0", "024000", "-1", "+1", "1e5", "24000.12345", "", ".5", "5.", "1,000", "100000000000000"),
    fc.constant(valid.includes(".") ? `${valid}0` : `${valid}.0`),
    fc.constant(`0${valid}`),
  );
}

const badOptionType = fc.constantFrom("ce", "pe", "Ce", "C", "P", "CALL", "PUT", "XX", "", "CE ", " PE");

const nearMiss: fc.Arbitrary<NearMiss> = parts.chain((p) => {
  const list = partList(p);
  const tagged = (reason: InstrumentKeyErrorReason) => (text: string) => ({ text, reason });
  const misses: fc.Arbitrary<NearMiss>[] = [
    badToken.map((token) => replaced(list, 0, token)).map(tagged("TOKEN")),
    fc.constantFrom(list.slice(0, -1).join("|"), [...list, "X"].join("|")).map(tagged("ARITY")),
    badSymbol(p.symbol)
      .map((value) => replaced(list, 1, value))
      .map(tagged("SYMBOL")),
    fc.constant(`${list.join("|")}|${"A".repeat(129)}`).map(tagged("LENGTH")),
  ];
  if (p.segment === "FUT" || p.segment === "OPT") {
    misses.push(badExpiry.map((value) => replaced(list, 2, value)).map(tagged("EXPIRY")));
  }
  if (p.segment === "OPT") {
    misses.push(
      badStrike(p.strike)
        .map((value) => replaced(list, 3, value))
        .map(tagged("STRIKE")),
    );
    misses.push(badOptionType.map((value) => replaced(list, 4, value)).map(tagged("OPTION_TYPE")));
  }
  return fc.oneof(...misses);
});

// ---------------------------------------------------------------------------------------------------------------------

describe("instrument key properties", () => {
  it("format(parse(k)) equals k", () => {
    fc.assert(
      fc.property(key, (k) => {
        const parsed = parseInstrumentKey(k);

        if (!parsed.ok) throw new Error(`${k}: ${parsed.error.message}`);
        expect(parsed.value.key).toBe(k);
        expect(formatInstrumentKey(parsed.value)).toBe(k);
      }),
      RUNS,
    );
  });

  it("parse(format(parts)) equals parts", () => {
    fc.assert(
      fc.property(parts, (p) => {
        const formatted = formatInstrumentKey(p);

        expect(parseInstrumentKey(formatted)).toEqual(
          ok({ ...p, key: formatted, exchange: SEGMENT_TOKEN_INFO[p.token].exchange }),
        );
      }),
      RUNS,
    );
  });

  it("normalize is idempotent", () => {
    const anyText = fc.oneof(
      repairableVariant.map((variant) => variant.text),
      nearMiss.map((miss) => miss.text),
      key,
      fc.string(),
      fc.string({ unit: fc.constantFrom(...chars("NSE_FOQBXINDCM|0123456789-.aceps ")), maxLength: 40 }),
    );

    fc.assert(
      fc.property(anyText, (text) => {
        const once = normalizeInstrumentKey(text);
        if (!once.ok) return;

        expect(normalizeInstrumentKey(once.value)).toEqual(once);
        expect(parseInstrumentKey(once.value)).toMatchObject({ ok: true, value: { key: once.value } });
      }),
      RUNS,
    );
  });

  it("normalises padded, lowercase and zero-padded-strike variants back to the canonical key", () => {
    fc.assert(
      fc.property(repairableVariant, ({ parts: p, text }) => {
        expect(normalizeInstrumentKey(text)).toEqual(ok(formatInstrumentKey(p)));
      }),
      RUNS,
    );
  });

  it("rejects near-miss keys with the reason of the broken part", () => {
    fc.assert(
      fc.property(nearMiss, ({ text, reason }) => {
        expect(parseInstrumentKey(text)).toMatchObject({ ok: false, error: { reason } });
      }),
      RUNS,
    );
  });

  it("round-trips every key through URL params", () => {
    fc.assert(
      fc.property(key, (k) => {
        const parsed = parseInstrumentKey(k);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const param = instrumentKeyToParam(parsed.value.key);

        expect(param).toMatch(/^[A-Za-z0-9\-_.!~*'()%]+$/);
        expect(instrumentKeyFromParam(param)).toEqual(parsed);
      }),
      RUNS,
    );
  });

  it("converts every expiry to a UTC-midnight Date and back", () => {
    fc.assert(
      fc.property(expiry, (text) => {
        const date = expiryToDate(text as IsoDate);

        expect(date.getTime() % 86_400_000).toBe(0);
        expect(date.toISOString().slice(0, 10)).toBe(text);
        expect(dateToExpiry(date)).toBe(text);
      }),
      RUNS,
    );
  });
});
