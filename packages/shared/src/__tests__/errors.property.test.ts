import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  isProblemDetails,
  MAX_FIELD_ERRORS,
  PROBLEM_LIMITS,
  ProblemDetailsSchema,
  problemTypeUrl,
  REQUEST_ID_PATTERN,
} from "../schemas/errors";
import type { ErrorCode, ProblemDetails } from "../schemas/errors";

const RUNS = { numRuns: 300 };

// ---------------------------------------------------------------------------------------------------------------------
// Arbitraries

/**
 * What single-line text must never contain: control characters, line and paragraph separators, bidirectional controls,
 * U+FEFF and lone surrogates. Written independently of the schema's pattern, so a mistake there shows up here.
 */
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u202a-\u202e\u2066-\u2069\ufeff]/u;

/**
 * One character allowed in single-line text: mostly printable ASCII, also any other BMP character outside the
 * surrogates (accents, Devanagari, ₹, CJK) and astral characters (emoji, mathematical letters, rare CJK), which are two
 * UTF-16 code units each. Never a character from {@link FORBIDDEN}.
 */
const lineChar = fc
  .oneof(
    { weight: 3, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
    { weight: 1, arbitrary: fc.integer({ min: 0xa0, max: 0xd7ff }) },
    { weight: 1, arbitrary: fc.integer({ min: 0xe000, max: 0xfffd }) },
    { weight: 1, arbitrary: fc.integer({ min: 0x10000, max: 0x10ffff }) },
  )
  .map((codePoint) => String.fromCodePoint(codePoint))
  .filter((char) => !FORBIDDEN.test(char));

/** `text` cut to at most `max` UTF-16 code units, never between the two halves of a surrogate pair. */
function fitTo(max: number): (text: string) => string {
  return (text) => {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
  };
}

/**
 * Single-line text of 0 (or `minLength`) to `max` code units: usually short, sometimes at the limit (`max`, or `max - 1`
 * when the last character is astral). `fc.string` counts characters, so text with astral characters is cut back to
 * `max` code units.
 */
function text(max: number, minLength = 0): fc.Arbitrary<string> {
  return fc
    .oneof(
      fc.string({ unit: lineChar, minLength, maxLength: max }),
      fc.string({ unit: lineChar, minLength: max, maxLength: max }),
    )
    .map(fitTo(max));
}

/** Non-empty single-line text of at most `max` code units (`max` is at least 2, so a cut never empties it). */
function line(max: number): fc.Arbitrary<string> {
  return text(max, 1);
}

/** One character from {@link FORBIDDEN}: a control character, a separator, a bidi control, U+FEFF or a lone surrogate. */
const forbiddenChar = fc
  .oneof(
    fc.integer({ min: 0x00, max: 0x1f }),
    fc.integer({ min: 0x7f, max: 0x9f }),
    fc.constantFrom(0x2028, 0x2029, 0xfeff),
    fc.integer({ min: 0x202a, max: 0x202e }),
    fc.integer({ min: 0x2066, max: 0x2069 }),
    fc.integer({ min: 0xd800, max: 0xdfff }),
  )
  .map((codeUnit) => String.fromCharCode(codeUnit));

const code = fc.constantFrom(...ERROR_CODES);

const asciiPathChar = fc.constantFrom(
  ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~%!$&'()*+,;=:@|"),
);
/** A non-ASCII character a decoded path may hold (é, ₹, Devanagari, CJK, emoji): no whitespace, `/`, `\`, `?` or `#`. */
const nonAsciiPathChar = lineChar.filter((char) => char > "\u007f" && !/[\s/\\?#]/u.test(char));
const pathChar = fc.oneof({ weight: 3, arbitrary: asciiPathChar }, { weight: 1, arbitrary: nonAsciiPathChar });
/**
 * A request path such as `/v1/instruments/NSE_EQ%7CINFY` or `/v1/watchlists/निफ्टी`: one leading slash, no query string
 * or fragment. At most 8 segments of 24 characters, two code units each at worst: always within the 512 limit.
 */
const instance = fc
  .array(fc.string({ unit: pathChar, minLength: 1, maxLength: 24 }), { maxLength: 8 })
  .map((segments) => `/${segments.join("/")}`);

/** A react-hook-form path such as `legs.0.strike`, or `""` for the whole body. */
const fieldPath = fc
  .array(fc.oneof(fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/), fc.nat({ max: 999 }).map(String)), {
    maxLength: 6,
  })
  .map((parts) => parts.join("."));

const fieldError = fc.record(
  {
    path: fieldPath,
    message: line(PROBLEM_LIMITS.fieldMessage),
    code: fc.stringMatching(/^[a-z][a-z0-9_]{0,63}$/),
  },
  { requiredKeys: ["path", "message"] },
);

const broker = fc.record(
  { code: line(PROBLEM_LIMITS.brokerCode), message: line(PROBLEM_LIMITS.brokerMessage) },
  { requiredKeys: ["code"] },
);

/** Any problem a server may send: any code, its own status, title and type, and any in-bounds optional members. */
const problem: fc.Arbitrary<ProblemDetails> = fc
  .tuple(
    code,
    fc.record(
      {
        detail: line(PROBLEM_LIMITS.detail),
        instance,
        requestId: fc.stringMatching(REQUEST_ID_PATTERN),
        errors: fc.array(fieldError, { maxLength: MAX_FIELD_ERRORS }),
        broker,
        retryAfterSec: fc.integer({ min: 0, max: PROBLEM_LIMITS.retryAfterSec }),
      },
      { requiredKeys: ["requestId"] },
    ),
  )
  .map(([errorCode, members]) => ({
    type: problemTypeUrl(errorCode),
    title: ERROR_TITLES[errorCode],
    status: ERROR_HTTP_STATUS[errorCode],
    code: errorCode,
    ...members,
  }));

type DerivedMember = "code" | "status" | "title" | "type";

/** What `member` is for a problem whose code is `errorCode`. */
function memberFor(errorCode: ErrorCode, member: DerivedMember): string | number {
  switch (member) {
    case "code":
      return errorCode;
    case "status":
      return ERROR_HTTP_STATUS[errorCode];
    case "title":
      return ERROR_TITLES[errorCode];
    case "type":
      return problemTypeUrl(errorCode);
  }
}

/** A free-text member of a problem: its issue path, its limit, and the members that put a text there. */
const textMember = fc.constantFrom<readonly [string, number, (text: string) => Partial<ProblemDetails>]>(
  ["detail", PROBLEM_LIMITS.detail, (detail) => ({ detail })],
  ["broker.code", PROBLEM_LIMITS.brokerCode, (code) => ({ broker: { code } })],
  ["broker.message", PROBLEM_LIMITS.brokerMessage, (message) => ({ broker: { code: "DH-906", message } })],
  ["errors.0.message", PROBLEM_LIMITS.fieldMessage, (message) => ({ errors: [{ path: "qty", message }] })],
  ["errors.0.path", PROBLEM_LIMITS.fieldPath, (path) => ({ errors: [{ path, message: "Required" }] })],
);

// ---------------------------------------------------------------------------------------------------------------------

describe("problem details properties", () => {
  it("a problem built from any code with in-bounds text passes; any code–status–title–type mismatch fails", () => {
    fc.assert(
      fc.property(problem, (candidate) => {
        expect(ProblemDetailsSchema.safeParse(candidate).error?.issues ?? []).toEqual([]);
      }),
      RUNS,
    );
    fc.assert(
      fc.property(
        problem,
        code,
        fc.constantFrom<DerivedMember>("code", "status", "title", "type"),
        (candidate, otherCode, member) => {
          const mismatched = { ...candidate, [member]: memberFor(otherCode, member) };
          // Codes that share a status (409, 422, 503) keep the problem consistent when only the status is swapped.
          fc.pre(mismatched[member] !== candidate[member]);

          expect(ProblemDetailsSchema.safeParse(mismatched).success).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it("rejects a text member with a control, separator, bidi control, U+FEFF or lone surrogate anywhere", () => {
    fc.assert(
      fc.property(
        problem,
        textMember,
        // One code unit short of the limit, so the inserted character keeps the text within it.
        fc.string({ unit: lineChar, maxLength: PROBLEM_LIMITS.detail }),
        forbiddenChar,
        fc.nat(),
        (candidate, [path, limit, member], longText, forbidden, position) => {
          const clean = fitTo(limit - 1)(longText);
          const at = position % (clean.length + 1);
          // Inserted anywhere, even between the halves of a pair: a lone surrogate there still leaves one half alone.
          const dirty = `${clean.slice(0, at)}${forbidden}${clean.slice(at)}`;
          const issues = ProblemDetailsSchema.safeParse({ ...candidate, ...member(dirty) }).error?.issues ?? [];

          expect(issues.map((issue) => issue.path.join("."))).toContain(path);
        },
      ),
      RUNS,
    );
  });

  it("measures every limit in UTF-16 code units: text at the limit passes, one unit more fails, emoji or not", () => {
    fc.assert(
      fc.property(
        problem,
        textMember,
        fc.string({ unit: lineChar, minLength: PROBLEM_LIMITS.detail, maxLength: PROBLEM_LIMITS.detail }),
        (candidate, [path, limit, member], longText) => {
          // `limit` code units (or one fewer, when the cut fell inside a pair), then padded to the limit and past it.
          const atLimit = fitTo(limit)(longText).padEnd(limit, "x");
          const failingPathsOf = (value: string) =>
            (ProblemDetailsSchema.safeParse({ ...candidate, ...member(value) }).error?.issues ?? []).map((issue) =>
              issue.path.join("."),
            );

          expect(failingPathsOf(atLimit)).toEqual([]);
          expect(failingPathsOf(`${atLimit}x`)).toEqual([path]);
        },
      ),
      RUNS,
    );
  });

  it("is recognised by the tolerant client guard, also after a JSON round trip", () => {
    fc.assert(
      fc.property(problem, (candidate) => {
        const received: unknown = JSON.parse(JSON.stringify(candidate));

        expect(ProblemDetailsSchema.safeParse(received).success).toBe(true);
        expect(isProblemDetails(received)).toBe(true);
      }),
      RUNS,
    );
  });
});
