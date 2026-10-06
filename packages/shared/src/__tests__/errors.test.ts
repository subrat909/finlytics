import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  checkProblemConsistency,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  ErrorCodeSchema,
  isKnownErrorCode,
  isProblemDetails,
  isRetryableErrorCode,
  MAX_FIELD_ERRORS,
  PROBLEM_LIMITS,
  ProblemDetailsSchema,
  problemTypeUrl,
  REQUEST_ID_PATTERN,
  RETRYABLE_ERROR_CODES,
} from "../schemas/errors";
import type { ErrorCode, FieldError, ProblemDetails, RetryableErrorCode } from "../schemas/errors";

/** The status table of docs/04 §6, grouped by status. */
const STATUS_TABLE: readonly (readonly [number, readonly ErrorCode[]])[] = [
  [400, ["VALIDATION"]],
  [401, ["UNAUTHENTICATED"]],
  [403, ["FORBIDDEN"]],
  [404, ["NOT_FOUND"]],
  [409, ["CONFLICT", "IDEMPOTENT_REPLAY", "NEEDS_RELOGIN"]],
  [413, ["PAYLOAD_TOO_LARGE"]],
  [415, ["UNSUPPORTED_MEDIA_TYPE"]],
  [422, ["BROKER_REJECTED", "RISK_LIMIT", "INSUFFICIENT_FUNDS", "MARKET_CLOSED"]],
  [423, ["KILL_SWITCH"]],
  [429, ["RATE_LIMITED"]],
  [500, ["INTERNAL"]],
  [503, ["BROKER_UNAVAILABLE", "SERVICE_UNAVAILABLE"]],
];

/** A complete problem, as the API sends it for a broker margin rejection. */
function brokerRejection(): ProblemDetails {
  return {
    type: "https://finlytics.app/errors/broker-rejected",
    title: "Broker rejected the request",
    status: 422,
    code: "BROKER_REJECTED",
    detail: "Insufficient margin",
    instance: "/v1/orders",
    requestId: "req_01J9Z6Y3K8",
    broker: { code: "DH-906", message: "Margin shortfall" },
  };
}

/** Validation against the strict server-side contract (what the API may send), as opposed to the tolerant client guard. */
function isStrictProblem(value: unknown): boolean {
  return ProblemDetailsSchema.safeParse(value).success;
}

/** The paths of the issues a value fails the server-side contract with, e.g. `["detail"]`. */
function failingPaths(value: unknown): string[] {
  return (ProblemDetailsSchema.safeParse(value).error?.issues ?? []).map((issue) => issue.path.join("."));
}

function problemFor(code: ErrorCode): ProblemDetails {
  return {
    type: problemTypeUrl(code),
    title: ERROR_TITLES[code],
    status: ERROR_HTTP_STATUS[code],
    code,
    requestId: "req_01J9Z6Y3K8",
  };
}

describe("error codes", () => {
  it("covers exactly the docs/04 §6 codes, without duplicates", () => {
    const docs04 = STATUS_TABLE.flatMap(([, codes]) => codes);

    expect([...ERROR_CODES].sort()).toEqual([...docs04].sort());
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it("maps every error code to an HTTP status and type URL", () => {
    for (const code of ERROR_CODES) {
      const problem = problemFor(code);

      expect(Number.isInteger(problem.status), code).toBe(true);
      expect(problem.title, code).not.toBe("");
      expect(problem.type, code).toMatch(/^https:\/\/finlytics\.app\/errors\/[a-z]+(-[a-z]+)*$/);
      expect(ProblemDetailsSchema.parse(problem), code).toEqual(problem);
    }
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(ERROR_TITLES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("uses the docs/04 status table exactly", () => {
    const expected = Object.fromEntries(STATUS_TABLE.flatMap(([status, codes]) => codes.map((code) => [code, status])));

    expect(ERROR_HTTP_STATUS).toEqual(expected);
  });

  it("answers NEEDS_RELOGIN with 409, never 401, and KILL_SWITCH with 423", () => {
    expect(ERROR_HTTP_STATUS.NEEDS_RELOGIN).toBe(409);
    expect(ERROR_HTTP_STATUS.KILL_SWITCH).toBe(423);
    expect(ERROR_HTTP_STATUS.UNAUTHENTICATED).toBe(401);
    // Literal types, so a server can type a response status per code.
    expectTypeOf(ERROR_HTTP_STATUS.NEEDS_RELOGIN).toEqualTypeOf<409>();
    expectTypeOf(ERROR_HTTP_STATUS.KILL_SWITCH).toEqualTypeOf<423>();
  });

  it("maps PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE and SERVICE_UNAVAILABLE to 413, 415 and 503", () => {
    expect([
      ERROR_HTTP_STATUS.PAYLOAD_TOO_LARGE,
      ERROR_HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
      ERROR_HTTP_STATUS.SERVICE_UNAVAILABLE,
    ]).toEqual([413, 415, 503]);
    expect([
      ERROR_TITLES.PAYLOAD_TOO_LARGE,
      ERROR_TITLES.UNSUPPORTED_MEDIA_TYPE,
      ERROR_TITLES.SERVICE_UNAVAILABLE,
    ]).toEqual(["Payload too large", "Unsupported media type", "Service unavailable"]);
    expect(problemTypeUrl("UNSUPPORTED_MEDIA_TYPE")).toBe("https://finlytics.app/errors/unsupported-media-type");
    expectTypeOf(ERROR_HTTP_STATUS.SERVICE_UNAVAILABLE).toEqualTypeOf<503>();
    // A database or Redis outage is ours, not the broker's: it must not show the broker banner.
    expect(ERROR_TITLES.SERVICE_UNAVAILABLE).not.toBe(ERROR_TITLES.BROKER_UNAVAILABLE);
  });

  it("builds kebab-case problem type URLs", () => {
    expect(problemTypeUrl("BROKER_REJECTED")).toBe("https://finlytics.app/errors/broker-rejected");
    expect(problemTypeUrl("INSUFFICIENT_FUNDS")).toBe("https://finlytics.app/errors/insufficient-funds");
    expect(problemTypeUrl("IDEMPOTENT_REPLAY")).toBe("https://finlytics.app/errors/idempotent-replay");
    expect(problemTypeUrl("NOT_FOUND")).toBe("https://finlytics.app/errors/not-found");
    expect(problemTypeUrl("INTERNAL")).toBe("https://finlytics.app/errors/internal");
    expectTypeOf(problemTypeUrl("KILL_SWITCH")).toEqualTypeOf<"https://finlytics.app/errors/kill-switch">();
  });

  it("rejects codes outside the contract", () => {
    for (const candidate of ["TIMEOUT", "validation", "Kill_Switch", "", "STEP_UP_REQUIRED"]) {
      expect(ErrorCodeSchema.safeParse(candidate).success, candidate).toBe(false);
    }
  });

  it("freezes the shared lookup tables", () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(ERROR_HTTP_STATUS)).toBe(true);
    expect(Object.isFrozen(ERROR_TITLES)).toBe(true);
    expect(Object.isFrozen(RETRYABLE_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(PROBLEM_LIMITS)).toBe(true);
  });
});

describe("ProblemDetailsSchema", () => {
  it("accepts a complete problem", () => {
    const problem = { ...brokerRejection(), retryAfterSec: 0 };

    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it("ties status, title and type to the code", () => {
    const killSwitch = problemFor("KILL_SWITCH");

    // Each member taken from another code is rejected on its own path, even when it is valid for that code.
    expect(failingPaths({ ...killSwitch, status: ERROR_HTTP_STATUS.RISK_LIMIT })).toEqual(["status"]);
    expect(failingPaths({ ...killSwitch, title: ERROR_TITLES.RISK_LIMIT })).toEqual(["title"]);
    expect(failingPaths({ ...killSwitch, type: problemTypeUrl("RISK_LIMIT") })).toEqual(["type"]);
    // Swapping only the code leaves title and type behind (both 409s share a status).
    expect(failingPaths({ ...problemFor("CONFLICT"), code: "IDEMPOTENT_REPLAY" })).toEqual(["title", "type"]);
    // A generic HTTP title is not the code's title.
    expect(failingPaths({ ...problemFor("NOT_FOUND"), title: "Not Found" })).toEqual(["title"]);
  });

  it("rejects problem details without requestId", () => {
    const withoutRequestId: Partial<ProblemDetails> = brokerRejection();
    delete withoutRequestId.requestId;

    const result = ProblemDetailsSchema.safeParse(withoutRequestId);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["requestId"]]);
    expect(isStrictProblem({ ...brokerRejection(), requestId: "" })).toBe(false);
  });

  it("requires requestId to match REQUEST_ID_PATTERN", () => {
    const accepted = [
      "req_01J9Z6Y3K8",
      "6f1c1f5e-2c5d-4b7a-9a8e-3c2b1a0f9e8d", // crypto.randomUUID()
      "abcdefgh", // 8 characters
      "A1._-zZ9",
      `a${"b".repeat(127)}`, // 128 characters
    ];
    const rejected = [
      "abcdefg", // 7 characters
      `a${"b".repeat(128)}`, // 129 characters
      "-leading-dash",
      ".leading-dot",
      "has space here",
      "line\nbreak-id",
      "semi;colon-id",
      'quote"injection',
      "unicodé-request",
    ];

    for (const requestId of accepted) {
      expect(REQUEST_ID_PATTERN.test(requestId), requestId).toBe(true);
      expect(isStrictProblem({ ...brokerRejection(), requestId }), requestId).toBe(true);
    }
    for (const requestId of rejected) {
      expect(REQUEST_ID_PATTERN.test(requestId), requestId).toBe(false);
      expect(failingPaths({ ...brokerRejection(), requestId }), requestId).toEqual(["requestId"]);
    }
  });

  it("rejects a multi-line or oversized detail", () => {
    const withDetail = (detail: string) => ({ ...brokerRejection(), detail });

    expect(isStrictProblem(withDetail("x".repeat(PROBLEM_LIMITS.detail)))).toBe(true);
    expect(isStrictProblem(withDetail("Margin shortfall: ₹1,200 more needed 🙏"))).toBe(true);
    for (const detail of [
      "x".repeat(PROBLEM_LIMITS.detail + 1),
      "",
      "first line\nsecond line",
      "carriage\rreturn",
      "tab\tseparated",
      "next\u0085line", // NEL (C1)
      "line\u2028separator",
      "paragraph\u2029separator",
      "nul\u0000byte",
      "delete\u007fchar",
    ]) {
      expect(failingPaths(withDetail(detail)), JSON.stringify(detail)).toEqual(["detail"]);
    }
  });

  it("rejects bidirectional controls, U+FEFF and lone surrogates in every text member", () => {
    const hidden = [
      ...["\u202a", "\u202b", "\u202c", "\u202d", "\u202e"], // embeddings, overrides and their terminator
      ...["\u2066", "\u2067", "\u2068", "\u2069"], // isolates and their terminator
      "\ufeff", // byte order mark, zero-width no-break space
      "\ud83d", // a high surrogate without its low half
      "\ude4f", // a low surrogate without its high half
    ];
    const members: ((text: string) => [string, Record<string, unknown>])[] = [
      (text) => ["detail", { ...brokerRejection(), detail: text }],
      (text) => ["broker.code", { ...brokerRejection(), broker: { code: text } }],
      (text) => ["broker.message", { ...brokerRejection(), broker: { code: "DH-906", message: text } }],
      (text) => ["errors.0.path", { ...problemFor("VALIDATION"), errors: [{ path: text, message: "Required" }] }],
      (text) => ["errors.0.message", { ...problemFor("VALIDATION"), errors: [{ path: "qty", message: text }] }],
      (text) => ["instance", { ...brokerRejection(), instance: `/v1/${text}` }],
    ];

    for (const char of hidden) {
      for (const member of members) {
        const [path, problem] = member(`isAdmin${char}x`);
        expect(failingPaths(problem), `${path} with ${JSON.stringify(char)}`).toEqual([path]);
      }
    }
    // A reversed pair is two lone surrogates.
    expect(failingPaths({ ...brokerRejection(), detail: "\ude4f\ud83d" })).toEqual(["detail"]);
  });

  it("accepts astral characters, whose surrogate pairs are well formed, up to the limit in code units", () => {
    const folded = "\u{1f64f}"; // two UTF-16 code units
    const withDetail = (detail: string) => ({ ...brokerRejection(), detail });

    expect(isStrictProblem(withDetail(`Margin shortfall ${folded} \u{1d400}\u{20000}`))).toBe(true);
    expect(isStrictProblem(withDetail(folded.repeat(PROBLEM_LIMITS.detail / 2)))).toBe(true);
    expect(isStrictProblem(withDetail(`${folded.repeat(PROBLEM_LIMITS.detail / 2)}x`))).toBe(false);
    expect(isStrictProblem({ ...brokerRejection(), instance: `/v1/watchlists/${folded}` })).toBe(true);
    // Characters that only look unusual are text: U+FFFD (what servers substitute) and the left-to-right mark.
    expect(isStrictProblem(withDetail("replaced \ufffd mark \u200e"))).toBe(true);
  });

  it("rejects an instance with a scheme, host, query or fragment", () => {
    const withInstance = (instance: string) => ({ ...brokerRejection(), instance });

    for (const instance of [
      "/",
      "/v1/orders",
      "/v1/instruments/NSE_FO%7CNIFTY%7C2025-10-30%7C24000%7CCE",
      "/v1/watchlists/\u0928\u093f\u092b\u094d\u091f\u0940-\u20b9-\u00e9", // a decoded, non-ASCII path
      `/${"a".repeat(PROBLEM_LIMITS.instance - 1)}`,
    ]) {
      expect(isStrictProblem(withInstance(instance)), instance).toBe(true);
    }
    for (const instance of [
      "https://finlytics.app/v1/orders", // scheme and host
      "javascript:alert(1)", // scheme
      "//evil.example/v1/orders", // network-path reference: a host
      "/\\evil.example/v1/orders", // browsers read "/\" as "//"
      "/v1/orders?code=secret-oauth-code", // query string
      "/v1/orders#fragment",
      "v1/orders", // relative
      "/v1/orders with space",
      "/v1/orders\r\nSet-Cookie: x=1",
      "",
      `/${"a".repeat(PROBLEM_LIMITS.instance)}`,
    ]) {
      expect(failingPaths(withInstance(instance)), JSON.stringify(instance)).toEqual(["instance"]);
    }
  });

  it("accepts field-level validation errors", () => {
    const errors: FieldError[] = [
      { path: "legs.0.strike", message: "Strike must be a multiple of 50", code: "not_on_tick" },
      { path: "qty", message: "Too small: expected number to be >=1", code: "too_small" },
      { path: "", message: "Request body is required" },
    ];
    const problem = { ...problemFor("VALIDATION"), errors };

    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it("bounds field-error paths, messages and codes", () => {
    const withError = (fieldError: Record<string, unknown>) => ({
      ...problemFor("VALIDATION"),
      errors: [fieldError],
    });
    const valid = { path: "qty", message: "Required", code: "invalid_type" };

    expect(isStrictProblem(withError({ ...valid, path: "p".repeat(PROBLEM_LIMITS.fieldPath) }))).toBe(true);
    expect(isStrictProblem(withError({ ...valid, message: "m".repeat(PROBLEM_LIMITS.fieldMessage) }))).toBe(true);
    expect(isStrictProblem(withError({ ...valid, code: `c${"_".repeat(PROBLEM_LIMITS.fieldCode - 1)}` }))).toBe(true);
    const rejected: Record<string, unknown>[] = [
      { ...valid, path: "p".repeat(PROBLEM_LIMITS.fieldPath + 1) },
      { ...valid, path: "legs.0\nstrike" },
      { ...valid, message: "m".repeat(PROBLEM_LIMITS.fieldMessage + 1) },
      { ...valid, message: "" },
      { ...valid, message: "two\nlines" },
      { ...valid, code: `c${"_".repeat(PROBLEM_LIMITS.fieldCode)}` },
      { ...valid, code: "NOT_ON_TICK" },
      { ...valid, code: "too-small" },
      { ...valid, code: "1st" },
      { ...valid, code: "" },
    ];
    for (const fieldError of rejected) {
      expect(isStrictProblem(withError(fieldError)), JSON.stringify(fieldError)).toBe(false);
    }
  });

  it("bounds the broker's code and message", () => {
    const withBroker = (broker: Record<string, unknown>) => ({ ...brokerRejection(), broker });

    expect(isStrictProblem(withBroker({ code: "c".repeat(PROBLEM_LIMITS.brokerCode) }))).toBe(true);
    expect(isStrictProblem(withBroker({ code: "DH-906", message: "m".repeat(PROBLEM_LIMITS.brokerMessage) }))).toBe(
      true,
    );
    for (const broker of [
      { code: "c".repeat(PROBLEM_LIMITS.brokerCode + 1) },
      { code: "" },
      { code: "DH-906", message: "m".repeat(PROBLEM_LIMITS.brokerMessage + 1) },
      { code: "DH-906", message: "raw\npayload" },
    ]) {
      expect(isStrictProblem(withBroker(broker)), JSON.stringify(broker)).toBe(false);
    }
  });

  it("caps field errors at MAX_FIELD_ERRORS", () => {
    const fieldErrors = (count: number): FieldError[] =>
      Array.from({ length: count }, (_, index) => ({ path: `legs.${String(index)}.qty`, message: "Required" }));

    expect(MAX_FIELD_ERRORS).toBe(100);
    expect(isStrictProblem({ ...problemFor("VALIDATION"), errors: fieldErrors(100) })).toBe(true);
    expect(isStrictProblem({ ...problemFor("VALIDATION"), errors: fieldErrors(101) })).toBe(false);
  });

  it("rejects unknown members at every level, such as a stack trace", () => {
    const stack = "Error: boom\n    at OrderService.place (order.service.ts:42:11)";

    expect(isStrictProblem({ ...brokerRejection(), stack })).toBe(false);
    expect(isStrictProblem({ ...brokerRejection(), broker: { code: "DH-906", raw: { stack } } })).toBe(false);
    expect(
      isStrictProblem({ ...problemFor("VALIDATION"), errors: [{ path: "qty", message: "Required", stack }] }),
    ).toBe(false);
  });

  it("rejects statuses outside 400–599 and non-integer statuses", () => {
    for (const status of [200, 399, 600, 422.5]) {
      expect(isStrictProblem({ ...brokerRejection(), status }), String(status)).toBe(false);
    }
  });

  it("rejects type URLs that are not Finlytics problem types", () => {
    for (const type of [
      "about:blank",
      "javascript:alert(1)",
      "http://finlytics.app/errors/internal",
      "https://evil.example/errors/internal",
      "https://finlytics.app/errors/BROKER_REJECTED",
      " https://finlytics.app/errors/internal",
    ]) {
      expect(isStrictProblem({ ...brokerRejection(), type }), type).toBe(false);
    }
  });

  it("accepts retryAfterSec as whole seconds from 0 to one day", () => {
    const rateLimited = problemFor("RATE_LIMITED");

    expect(isStrictProblem({ ...rateLimited, retryAfterSec: 30 })).toBe(true);
    expect(isStrictProblem({ ...rateLimited, retryAfterSec: PROBLEM_LIMITS.retryAfterSec })).toBe(true);
    expect(isStrictProblem({ ...rateLimited, retryAfterSec: PROBLEM_LIMITS.retryAfterSec + 1 })).toBe(false);
    expect(isStrictProblem({ ...rateLimited, retryAfterSec: -1 })).toBe(false);
    expect(isStrictProblem({ ...rateLimited, retryAfterSec: 1.5 })).toBe(false);
  });
});

describe("checkProblemConsistency", () => {
  /** The refinement on its own, after a schema that lets any code through. */
  const consistency = z
    .object({ code: z.string(), status: z.number(), title: z.string(), type: z.string() })
    .superRefine(checkProblemConsistency);
  const pathsOf = (value: unknown) =>
    (consistency.safeParse(value).error?.issues ?? []).map((issue) => issue.path.join("."));

  it("adds nothing for a code this build doesn't know, whichever members come with it", () => {
    expect(pathsOf({ code: "STEP_UP_REQUIRED", status: 403, title: "Step-up required", type: "about:blank" })).toEqual(
      [],
    );
    expect(pathsOf({ code: "", status: 0, title: "", type: "" })).toEqual([]);
  });

  it("reports each member that doesn't match a known code", () => {
    expect(pathsOf(problemFor("KILL_SWITCH"))).toEqual([]);
    expect(pathsOf({ ...problemFor("KILL_SWITCH"), status: 500, title: "Internal error", type: "x" })).toEqual([
      "status",
      "title",
      "type",
    ]);
  });

  it("is what ProblemDetailsSchema applies: an unknown code fails on code alone", () => {
    expect(failingPaths({ ...problemFor("KILL_SWITCH"), code: "STEP_UP_REQUIRED" })).toEqual(["code"]);
  });
});

describe("isProblemDetails", () => {
  it("recognises a problem parsed from a JSON response body", () => {
    const body: unknown = JSON.parse(JSON.stringify(brokerRejection()));

    expect(isProblemDetails(body)).toBe(true);
  });

  it("works structurally, without relying on prototypes", () => {
    const withoutPrototype: unknown = Object.assign(Object.create(null) as object, problemFor("KILL_SWITCH"));

    expect(isProblemDetails(withoutPrototype)).toBe(true);
  });

  it("rejects values that are not problems", () => {
    for (const value of [null, undefined, "Internal error", 500, [], new Error("boom"), { code: "INTERNAL" }]) {
      expect(isProblemDetails(value)).toBe(false);
    }
  });

  it("still recognises problems with unknown codes and members on the client", () => {
    // RFC 9457 §3.2: clients ignore members they don't recognise. A tab opened before a deploy must keep the
    // requestId, errors[] and retryAfterSec of a problem whose code it has never seen.
    const fromNewerServer: unknown = JSON.parse(
      JSON.stringify({
        type: "https://finlytics.app/errors/step-up-required",
        title: "Step-up required",
        status: 403,
        code: "STEP_UP_REQUIRED",
        requestId: "req_01J9Z6Y3K8",
        retryAfterSec: 0,
        errors: [{ path: "totp", message: "Enter your 2FA code", hint: "6 digits" }],
        broker: { code: "DH-906", raw: { reason: "margin" } },
        stepUp: { methods: ["totp"] },
      }),
    );
    // The server-side bounds are not the client's to enforce: a newer server may relax them.
    const beyondTodaysBounds: unknown = {
      ...problemFor("SERVICE_UNAVAILABLE"),
      detail: `multi-line\n${"x".repeat(PROBLEM_LIMITS.detail)}`,
      requestId: "short",
      retryAfterSec: 2 * PROBLEM_LIMITS.retryAfterSec,
    };

    expect(isProblemDetails(fromNewerServer)).toBe(true);
    expect(isStrictProblem(fromNewerServer)).toBe(false);
    expect(isProblemDetails(beyondTodaysBounds)).toBe(true);
    expect(isStrictProblem(beyondTodaysBounds)).toBe(false);
  });

  it("still requires the members a client acts on", () => {
    const withoutRequestId: Partial<ProblemDetails> = brokerRejection();
    delete withoutRequestId.requestId;
    const withoutCode: Partial<ProblemDetails> = brokerRejection();
    delete withoutCode.code;

    expect(isProblemDetails(withoutRequestId)).toBe(false);
    expect(isProblemDetails(withoutCode)).toBe(false);
    expect(isProblemDetails({ ...brokerRejection(), code: "" })).toBe(false);
    expect(isProblemDetails({ ...brokerRejection(), status: 200 })).toBe(false);
    expect(isProblemDetails({ ...brokerRejection(), errors: [{ path: "qty" }] })).toBe(false);
  });
});

describe("isKnownErrorCode", () => {
  it("recognises every code of this build and nothing else", () => {
    for (const code of ERROR_CODES) expect(isKnownErrorCode(code), code).toBe(true);
    for (const code of ["STEP_UP_REQUIRED", "kill_switch", "", "INTERNAL "]) {
      expect(isKnownErrorCode(code), code).toBe(false);
    }
  });

  it("narrows a received code to ErrorCode", () => {
    // Compiles only because the guard narrows string to ErrorCode.
    const knownOrUndefined = (code: string): ErrorCode | undefined => (isKnownErrorCode(code) ? code : undefined);

    expect(knownOrUndefined("KILL_SWITCH")).toBe("KILL_SWITCH");
    expect(knownOrUndefined("STEP_UP_REQUIRED")).toBeUndefined();
  });
});

describe("isRetryableErrorCode", () => {
  it("treats only RATE_LIMITED, BROKER_UNAVAILABLE and SERVICE_UNAVAILABLE as retryable", () => {
    const retryable = ERROR_CODES.filter((code) => isRetryableErrorCode(code));

    expect(retryable).toEqual(["RATE_LIMITED", "BROKER_UNAVAILABLE", "SERVICE_UNAVAILABLE"]);
    expect([...RETRYABLE_ERROR_CODES]).toEqual(retryable);
  });

  it("treats SERVICE_UNAVAILABLE as retryable", () => {
    expect(isRetryableErrorCode("SERVICE_UNAVAILABLE")).toBe(true);
    // The other two new codes need a different request before a retry can succeed.
    expect(isRetryableErrorCode("PAYLOAD_TOO_LARGE")).toBe(false);
    expect(isRetryableErrorCode("UNSUPPORTED_MEDIA_TYPE")).toBe(false);
  });

  it("narrows the code to the retryable ones", () => {
    // Compiles only because the guard narrows ErrorCode to RetryableErrorCode.
    const retryableOrUndefined = (code: ErrorCode): RetryableErrorCode | undefined =>
      isRetryableErrorCode(code) ? code : undefined;

    expect(retryableOrUndefined("BROKER_UNAVAILABLE")).toBe("BROKER_UNAVAILABLE");
    expect(retryableOrUndefined("KILL_SWITCH")).toBeUndefined();
  });

  it("never retries a code this build does not know", () => {
    expect(isRetryableErrorCode("STEP_UP_REQUIRED")).toBe(false);
  });
});
