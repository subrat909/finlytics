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
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "BROKER_REJECTED",
  "RISK_LIMIT",
  "INSUFFICIENT_FUNDS",
  "MARKET_CLOSED",
  "KILL_SWITCH",
  "RATE_LIMITED",
  "INTERNAL",
  "BROKER_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
] as const);
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * The HTTP status for each code; the problem's `status` member always equals the response status.
 *
 * - `NEEDS_RELOGIN` is 409, never 401: the user's Finlytics session is fine, only the broker session expired. A 401
 *   would make the web app sign the user out instead of prompting a one-click broker re-login.
 * - `PAYLOAD_TOO_LARGE` (413) and `UNSUPPORTED_MEDIA_TYPE` (415) keep HTTP semantics for proxies and `fetch`: the body
 *   is over the size limit, or isn't `application/json`.
 * - `INSUFFICIENT_FUNDS` is only for our own pre-trade check. A margin rejection from the broker is `BROKER_REJECTED`,
 *   with the broker's own code in `broker.code`.
 * - `KILL_SWITCH` is 423 (Locked): trading is locked for the user or globally until the switch is released.
 * - `SERVICE_UNAVAILABLE` is 503 for our own dependencies (database, Redis, a request that ran out of time, a server
 *   that is shutting down). It is retryable, never `BROKER_UNAVAILABLE` (which shows the broker banner) and never 401:
 *   a database outage must not sign anyone out.
 */
export const ERROR_HTTP_STATUS = Object.freeze({
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENT_REPLAY: 409,
  NEEDS_RELOGIN: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BROKER_REJECTED: 422,
  RISK_LIMIT: 422,
  INSUFFICIENT_FUNDS: 422,
  MARKET_CLOSED: 422,
  KILL_SWITCH: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  BROKER_UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
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
  PAYLOAD_TOO_LARGE: "Payload too large",
  UNSUPPORTED_MEDIA_TYPE: "Unsupported media type",
  BROKER_REJECTED: "Broker rejected the request",
  RISK_LIMIT: "Risk limit reached",
  INSUFFICIENT_FUNDS: "Insufficient funds",
  MARKET_CLOSED: "Market closed",
  KILL_SWITCH: "Kill switch engaged",
  RATE_LIMITED: "Too many requests",
  INTERNAL: "Internal error",
  BROKER_UNAVAILABLE: "Broker unavailable",
  SERVICE_UNAVAILABLE: "Service unavailable",
} as const satisfies Record<ErrorCode, string>);

/** The members {@link checkProblemConsistency} ties together. */
interface ProblemConsistencyInput {
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly type: string;
}

/**
 * The refinement that ties `status`, `title` and `type` to `code`, one issue per member that differs. It checks `code`
 * itself first and adds nothing for a code this build doesn't know (the enum reports that), so it stays safe whether or
 * not Zod still runs refinements after a member failed: today it skips them, but nothing here depends on that.
 *
 * Exported for its unit test only; not part of the package entry.
 */
export function checkProblemConsistency(problem: ProblemConsistencyInput, ctx: z.RefinementCtx): void {
  const { code } = problem;
  if (!isKnownErrorCode(code)) return;
  if (problem.status !== ERROR_HTTP_STATUS[code]) {
    ctx.addIssue({ code: "custom", path: ["status"], message: `Expected the status of ${code}` });
  }
  if (problem.title !== ERROR_TITLES[code]) {
    ctx.addIssue({ code: "custom", path: ["title"], message: `Expected the title of ${code}` });
  }
  if (problem.type !== problemTypeUrl(code)) {
    ctx.addIssue({ code: "custom", path: ["type"], message: `Expected the type URL of ${code}` });
  }
}

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

/**
 * A correlation id: what the API generates for every request, returns in the `x-request-id` header and sends as
 * `requestId`. 8–128 characters from `[A-Za-z0-9._-]`, starting with a letter or digit; a UUID matches. The API never
 * adopts an inbound `x-request-id`: a well-formed one is only logged as `clientRequestId`, so the id in logs, problems
 * and audit rows can't be forged.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

/** The most field errors one problem carries. Servers truncate to this many (the first ones win). */
export const MAX_FIELD_ERRORS = 100;

/**
 * Upper bounds for the text members of a problem, in UTF-16 code units (`string.length`, so an emoji counts twice),
 * plus `retryAfterSec` in seconds (one day). A problem is small whatever went wrong: servers shorten or drop text that
 * doesn't fit.
 */
export const PROBLEM_LIMITS = Object.freeze({
  detail: 500,
  instance: 512,
  fieldPath: 256,
  fieldMessage: 300,
  fieldCode: 64,
  brokerCode: 64,
  brokerMessage: 500,
  retryAfterSec: 86_400,
} as const);

/**
 * Characters no text member of a problem may contain:
 * - control characters (`\p{Cc}`: C0, DEL and C1, so no CR, LF, tab or NEL) and the Unicode line and paragraph
 *   separators (`\p{Zl}`, `\p{Zp}`), which would forge a log line or a header;
 * - the bidirectional embedding, override and isolate controls (U+202A–U+202E, U+2066–U+2069), which reorder how the
 *   text around them is displayed (Trojan Source, CVE-2021-42574), in a log viewer as much as in the UI;
 * - U+FEFF (byte order mark, zero-width no-break space), invisible;
 * - lone surrogates (`\p{Cs}`, with the `u` flag: a well-formed pair is one astral code point and stays allowed), which
 *   aren't text and become U+FFFD, or an error, in any UTF-8 encoder.
 *
 * Written as escapes, never as the invisible characters themselves.
 */
const FORBIDDEN_IN_TEXT = String.raw`\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u202A-\u202E\u2066-\u2069\uFEFF`;

/** One line of text without {@link FORBIDDEN_IN_TEXT}: a problem's text can never forge a log line or a header. */
const SINGLE_LINE = new RegExp(`^[^${FORBIDDEN_IN_TEXT}]*$`, "u");
const SINGLE_LINE_MESSAGE = "Expected one line of text, without control or invisible formatting characters";

/**
 * A string of at most `max` UTF-16 code units (`string.length`): the unit of {@link PROBLEM_LIMITS} and of the server's
 * truncation. Zod's `.max()` counts Unicode code points (an astral character such as an emoji is one point but two
 * units), so on its own it would let text through at up to twice the limit. It stays for the `maxLength` that JSON
 * Schema and OpenAPI show (JSON Schema counts code points too, so that bound is never the tighter one); the refinement
 * enforces the documented one.
 */
function boundedText(max: number) {
  return z
    .string()
    .max(max)
    .refine((text) => text.length <= max, {
      message: `Too long: expected at most ${String(max)} UTF-16 code units`,
      // Only when `.max()` passed: a string over the limit in code points is over it in code units too, and one
      // issue is enough.
      when: (payload) => payload.issues.length === 0,
    });
}

/** Non-empty single-line text of at most `max` code units. */
function singleLine(max: number) {
  return boundedText(max).min(1).regex(SINGLE_LINE, SINGLE_LINE_MESSAGE);
}

/**
 * `instance` is a path, never a full URL: exactly one leading `/`, then no whitespace, `\`, `?`, `#` or
 * {@link FORBIDDEN_IN_TEXT} character. So it carries no scheme, no host (neither `//evil.example` nor
 * `/\evil.example`, which browsers read as one), no query string, no fragment and nothing that reorders or hides text.
 */
const INSTANCE_PATH = new RegExp(String.raw`^\/(?!\/)[^\s\\?#${FORBIDDEN_IN_TEXT}]*$`, "u");

/** A machine-readable reason: lowercase snake case, starting with a letter, like Zod's issue codes (`"too_small"`). */
const FIELD_ERROR_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * One field-level validation error, shaped for forms.
 *
 * - `path`: dot path of the field in the request body, as react-hook-form names fields (`"legs.0.strike"`). Array
 *   indices are plain numbers. `""` means the body as a whole. At most 256 code units, one line.
 * - `message`: human-readable, safe to show next to the field. 1–300 code units, one line.
 * - `code`: optional machine-readable reason, e.g. a Zod issue code (`"too_small"`): lowercase snake case, at most 64
 *   characters.
 */
export const FieldErrorSchema = z.strictObject({
  path: boundedText(PROBLEM_LIMITS.fieldPath).regex(SINGLE_LINE, SINGLE_LINE_MESSAGE),
  message: singleLine(PROBLEM_LIMITS.fieldMessage),
  code: z
    .string()
    .max(PROBLEM_LIMITS.fieldCode)
    .regex(FIELD_ERROR_CODE, "Expected lowercase snake case, starting with a letter")
    .optional(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

/**
 * RFC 9457 problem details, as sent by the API with media type `application/problem+json`. This is the server-side
 * contract: the API validates every problem it sends against it (exception filter, API tests). Clients receiving a
 * problem use {@link isProblemDetails} instead, which tolerates a newer server.
 *
 * - **Strict at every level**: an unknown member (a stack trace, an SQL message, a raw broker payload) fails
 *   validation, so nothing internal can ride along.
 * - **Bounded**: every text member has a maximum length ({@link PROBLEM_LIMITS}) and is a single line.
 * - **Consistent**: `status`, `title` and `type` must be the ones {@link ERROR_HTTP_STATUS}, {@link ERROR_TITLES} and
 *   {@link problemTypeUrl} give for `code`.
 *
 * Extension members beyond RFC 9457's five:
 * - `code` (required): the stable {@link ErrorCode}. Clients branch on this.
 * - `requestId` (required): the `x-request-id` correlation id ({@link REQUEST_ID_PATTERN}), to quote in support requests
 *   and find the logs.
 * - `errors`: field-level validation errors, at most {@link MAX_FIELD_ERRORS}.
 * - `broker`: the broker's own error code and message, for `BROKER_REJECTED` and `BROKER_UNAVAILABLE`.
 * - `retryAfterSec`: whole seconds to wait before retrying (at most a day); mirrors the `Retry-After` header.
 */
export const ProblemDetailsSchema = z
  .strictObject({
    type: z.string().regex(PROBLEM_TYPE_URL_PATTERN, "Expected a Finlytics problem type URL"),
    title: z.string().min(1),
    status: z.int().min(400).max(599),
    code: ErrorCodeSchema,
    detail: singleLine(PROBLEM_LIMITS.detail).optional(),
    instance: boundedText(PROBLEM_LIMITS.instance)
      .regex(INSTANCE_PATH, "Expected a request path without query string or fragment")
      .optional(),
    requestId: z.string().regex(REQUEST_ID_PATTERN, "Expected a request id matching REQUEST_ID_PATTERN"),
    errors: z.array(FieldErrorSchema).max(MAX_FIELD_ERRORS).optional(),
    broker: z
      .strictObject({
        code: singleLine(PROBLEM_LIMITS.brokerCode),
        message: singleLine(PROBLEM_LIMITS.brokerMessage).optional(),
      })
      .optional(),
    retryAfterSec: z.int().min(0).max(PROBLEM_LIMITS.retryAfterSec).optional(),
  })
  .superRefine(checkProblemConsistency);
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
  "SERVICE_UNAVAILABLE",
] as const satisfies readonly ErrorCode[]);
export type RetryableErrorCode = (typeof RETRYABLE_ERROR_CODES)[number];

/**
 * Whether a client may retry automatically: only `RATE_LIMITED`, `BROKER_UNAVAILABLE` and `SERVICE_UNAVAILABLE`. Every
 * other code needs a change before a retry can succeed. Order placement retries must reuse the same `Idempotency-Key`.
 */
export function isRetryableErrorCode(code: string): code is RetryableErrorCode {
  const retryable: readonly string[] = RETRYABLE_ERROR_CODES;
  return retryable.includes(code);
}
