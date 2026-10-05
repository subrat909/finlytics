import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  ErrorCodeSchema,
  isKnownErrorCode,
  isProblemDetails,
  isRetryableErrorCode,
  MAX_FIELD_ERRORS,
  ProblemDetailsSchema,
  problemTypeUrl,
  RETRYABLE_ERROR_CODES,
} from "../schemas/errors";
import type { ErrorCode, FieldError, ProblemDetails, RetryableErrorCode } from "../schemas/errors";

/** The status table of plan §5 (and docs/04 §6), grouped by status. */
const STATUS_TABLE: readonly (readonly [number, readonly ErrorCode[]])[] = [
  [400, ["VALIDATION"]],
  [401, ["UNAUTHENTICATED"]],
  [403, ["FORBIDDEN"]],
  [404, ["NOT_FOUND"]],
  [409, ["CONFLICT", "IDEMPOTENT_REPLAY", "NEEDS_RELOGIN"]],
  [422, ["BROKER_REJECTED", "RISK_LIMIT", "INSUFFICIENT_FUNDS", "MARKET_CLOSED"]],
  [423, ["KILL_SWITCH"]],
  [429, ["RATE_LIMITED"]],
  [500, ["INTERNAL"]],
  [503, ["BROKER_UNAVAILABLE"]],
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
  it("covers the docs/04 codes plus INTERNAL, CONFLICT and INSUFFICIENT_FUNDS", () => {
    const docs04 = [
      "VALIDATION",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "RATE_LIMITED",
      "IDEMPOTENT_REPLAY",
      "BROKER_UNAVAILABLE",
      "BROKER_REJECTED",
      "RISK_LIMIT",
      "KILL_SWITCH",
      "MARKET_CLOSED",
      "NEEDS_RELOGIN",
    ];

    expect([...ERROR_CODES].sort()).toEqual([...docs04, "INTERNAL", "CONFLICT", "INSUFFICIENT_FUNDS"].sort());
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

  it("uses the plan's status table exactly", () => {
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
  });
});

describe("ProblemDetailsSchema", () => {
  it("accepts a complete problem", () => {
    const problem = { ...brokerRejection(), retryAfterSec: 0 };

    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it("rejects problem details without requestId", () => {
    const withoutRequestId: Partial<ProblemDetails> = brokerRejection();
    delete withoutRequestId.requestId;

    const result = ProblemDetailsSchema.safeParse(withoutRequestId);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["requestId"]]);
    expect(isStrictProblem({ ...brokerRejection(), requestId: "" })).toBe(false);
  });

  it("accepts field-level validation errors", () => {
    const errors: FieldError[] = [
      { path: "legs.0.strike", message: "Strike must be a multiple of 50", code: "NOT_ON_TICK" },
      { path: "qty", message: "Too small: expected number to be >=1", code: "too_small" },
      { path: "", message: "Request body is required" },
    ];
    const problem = { ...problemFor("VALIDATION"), errors };

    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
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
    expect(isStrictProblem({ ...brokerRejection(), status: 599 })).toBe(true);
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

  it("accepts retryAfterSec as whole, non-negative seconds", () => {
    const rateLimited = problemFor("RATE_LIMITED");

    expect(isStrictProblem({ ...rateLimited, retryAfterSec: 30 })).toBe(true);
    expect(isStrictProblem({ ...rateLimited, retryAfterSec: -1 })).toBe(false);
    expect(isStrictProblem({ ...rateLimited, retryAfterSec: 1.5 })).toBe(false);
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

  it("recognises a problem from a newer server, with an unknown code and extension members", () => {
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

    expect(isProblemDetails(fromNewerServer)).toBe(true);
    expect(isStrictProblem(fromNewerServer)).toBe(false);
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
  it("treats only RATE_LIMITED and BROKER_UNAVAILABLE as retryable", () => {
    const retryable = ERROR_CODES.filter((code) => isRetryableErrorCode(code));

    expect(retryable).toEqual(["RATE_LIMITED", "BROKER_UNAVAILABLE"]);
    expect([...RETRYABLE_ERROR_CODES]).toEqual(retryable);
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
