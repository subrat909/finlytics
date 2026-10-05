/**
 * The error contract for every API response (plan D15, docs/04 §6): RFC 9457 problem details (which replaces RFC 7807)
 * with a stable machine-readable `code`. Servers derive `status`, `title` and `type` from the code; clients branch on
 * `code` and never parse `title` or `detail`.
 */
import { z } from "zod";

/**
 * Stable error codes, grouped by HTTP status. Adding a code is a contract change: give it a status, a title and a row
 * in docs/04 §6. Never rename or remove one.
 */
export const ERROR_CODES = Object.freeze([
  "VALIDATION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENT_REPLAY",
  "NEEDS_RELOGIN",
  "BROKER_REJECTED",
  "RISK_LIMIT",
  "INSUFFICIENT_FUNDS",
  "MARKET_CLOSED",
  "KILL_SWITCH",
  "RATE_LIMITED",
  "INTERNAL",
  "BROKER_UNAVAILABLE",
] as const);
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * The HTTP status for each code; the problem's `status` member always equals the response status.
 *
 * - `NEEDS_RELOGIN` is 409, never 401: the user's Finlytics session is fine, only the broker session expired. A 401
 *   would make the web app sign the user out instead of prompting a one-click broker re-login.
 * - `INSUFFICIENT_FUNDS` is only for our own pre-trade check. A margin rejection from the broker is `BROKER_REJECTED`,
 *   with the broker's own code in `broker.code`.
 * - `KILL_SWITCH` is 423 (Locked): trading is locked for the user or globally until the switch is released.
 */
export const ERROR_HTTP_STATUS = Object.freeze({
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENT_REPLAY: 409,
  NEEDS_RELOGIN: 409,
  BROKER_REJECTED: 422,
  RISK_LIMIT: 422,
  INSUFFICIENT_FUNDS: 422,
  MARKET_CLOSED: 422,
  KILL_SWITCH: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  BROKER_UNAVAILABLE: 503,
} as const satisfies Record<ErrorCode, number>);

/** The problem `title` for each code: a short summary that is the same for every occurrence (RFC 9457 §3.1.4). */
export const ERROR_TITLES = Object.freeze({
  VALIDATION: "Validation failed",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not found",
  CONFLICT: "Conflict",
  IDEMPOTENT_REPLAY: "Duplicate request",
  NEEDS_RELOGIN: "Broker login required",
  BROKER_REJECTED: "Broker rejected the request",
  RISK_LIMIT: "Risk limit reached",
  INSUFFICIENT_FUNDS: "Insufficient funds",
  MARKET_CLOSED: "Market closed",
  KILL_SWITCH: "Kill switch engaged",
  RATE_LIMITED: "Too many requests",
  INTERNAL: "Internal error",
  BROKER_UNAVAILABLE: "Broker unavailable",
} as const satisfies Record<ErrorCode, string>);

/** Media type of every error response body (RFC 9457 §3). */
export const PROBLEM_JSON_MEDIA_TYPE = "application/problem+json";

const PROBLEM_TYPE_BASE_URL = "https://finlytics.app/errors/";

/** What {@link problemTypeUrl} produces: the base URL plus the code in kebab case. Keep in sync with the base URL. */
const PROBLEM_TYPE_URL_PATTERN = /^https:\/\/finlytics\.app\/errors\/[a-z]+(?:-[a-z]+)*$/;

/** `"BROKER_REJECTED"` → `"broker-rejected"`, at the type level. */
type KebabCase<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Lowercase<Head>}-${KebabCase<Tail>}`
  : Lowercase<S>;

/** The problem `type` URL of a code, e.g. `"https://finlytics.app/errors/kill-switch"` for `"KILL_SWITCH"`. */
export type ProblemTypeUrl<C extends ErrorCode = ErrorCode> = `${typeof PROBLEM_TYPE_BASE_URL}${KebabCase<C>}`;

/** The problem `type` URL for a code: `https://finlytics.app/errors/<kebab-code>`, e.g. `.../errors/broker-rejected`. */
export function problemTypeUrl<C extends ErrorCode>(code: C): ProblemTypeUrl<C> {
  return `${PROBLEM_TYPE_BASE_URL}${code.toLowerCase().replaceAll("_", "-")}` as ProblemTypeUrl<C>;
}

/** The most field errors one problem carries. Servers truncate to this many (the first ones win). */
export const MAX_FIELD_ERRORS = 100;

/**
 * One field-level validation error, shaped for forms.
 *
 * - `path`: dot path of the field in the request body, as react-hook-form names fields (`"legs.0.strike"`). Array
 *   indices are plain numbers. `""` means the body as a whole.
 * - `message`: human-readable, safe to show next to the field.
 * - `code`: optional machine-readable reason, e.g. a Zod issue code (`"too_small"`).
 */
export const FieldErrorSchema = z.strictObject({
  path: z.string(),
  message: z.string().min(1),
  code: z.string().min(1).optional(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

/**
 * RFC 9457 problem details, as sent by the API with media type `application/problem+json`. This is the server-side
 * contract: the API validates every problem it sends against it (exception filter, API tests). Clients receiving a
 * problem use {@link isProblemDetails} instead, which tolerates a newer server.
 *
 * Strict at every level: an unknown member (a stack trace, an SQL message, a raw broker payload) fails validation, so
 * nothing internal can ride along. Extension members beyond RFC 9457's five:
 * - `code` (required): the stable {@link ErrorCode}. Clients branch on this.
 * - `requestId` (required): the `x-request-id` correlation id, to quote in support requests and find the logs.
 * - `errors`: field-level validation errors, at most {@link MAX_FIELD_ERRORS}.
 * - `broker`: the broker's own error code and message, for `BROKER_REJECTED` and `BROKER_UNAVAILABLE`.
 * - `retryAfterSec`: whole seconds to wait before retrying; mirrors the `Retry-After` header.
 */
export const ProblemDetailsSchema = z.strictObject({
  type: z.string().regex(PROBLEM_TYPE_URL_PATTERN, "Expected a Finlytics problem type URL"),
  title: z.string().min(1),
  status: z.int().min(400).max(599),
  code: ErrorCodeSchema,
  detail: z.string().min(1).optional(),
  instance: z.string().min(1).optional(),
  requestId: z.string().min(1),
  errors: z.array(FieldErrorSchema).max(MAX_FIELD_ERRORS).optional(),
  broker: z
    .strictObject({
      code: z.string().min(1),
      message: z.string().min(1).optional(),
    })
    .optional(),
  retryAfterSec: z.int().min(0).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * Problem details as a client receives them. A bundle in an open tab can be older than the server, so this follows
 * RFC 9457 §3.2 (clients must ignore extension members they don't recognise): unknown members are allowed at every
 * level, and `code` may be one this build doesn't know yet. The members a client acts on are still required.
 */
const ReceivedProblemDetailsSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  code: z.string().min(1),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().min(1),
  errors: z.array(z.looseObject({ path: z.string(), message: z.string(), code: z.string().optional() })).optional(),
  broker: z.looseObject({ code: z.string(), message: z.string().optional() }).optional(),
  retryAfterSec: z.number().min(0).optional(),
});
export type ReceivedProblemDetails = z.infer<typeof ReceivedProblemDetailsSchema>;

/**
 * Client-side type guard for a parsed response body. Tolerant (see {@link ReceivedProblemDetails}): a problem from a
 * newer server, with a new code or new extension members, is still recognised, so the client keeps its `requestId`,
 * `errors[]` and `retryAfterSec`. Narrow `code` with {@link isKnownErrorCode} before switching over {@link ErrorCode}.
 *
 * Structural: never uses `instanceof`, so it works across realms and across the ESM and CJS copies of zod.
 */
export function isProblemDetails(value: unknown): value is ReceivedProblemDetails {
  return ReceivedProblemDetailsSchema.safeParse(value).success;
}

/** Whether a received `code` is one this build knows; a newer server can send codes an open tab has never seen. */
export function isKnownErrorCode(code: string): code is ErrorCode {
  const known: readonly string[] = ERROR_CODES;
  return known.includes(code);
}

/** Codes a client may retry automatically, after `retryAfterSec` (or a backoff). */
export const RETRYABLE_ERROR_CODES = Object.freeze([
  "RATE_LIMITED",
  "BROKER_UNAVAILABLE",
] as const satisfies readonly ErrorCode[]);
export type RetryableErrorCode = (typeof RETRYABLE_ERROR_CODES)[number];

/**
 * Whether a client may retry automatically. Only `RATE_LIMITED` and `BROKER_UNAVAILABLE`: every other code needs a
 * change before a retry can succeed. Order placement retries must reuse the same `Idempotency-Key`.
 */
export function isRetryableErrorCode(code: string): code is RetryableErrorCode {
  const retryable: readonly string[] = RETRYABLE_ERROR_CODES;
  return retryable.includes(code);
}
