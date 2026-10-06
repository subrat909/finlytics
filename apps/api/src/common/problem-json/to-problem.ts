/**
 * The one mapping from anything thrown to an RFC 9457 problem (plan D4, docs/04 §6). Pure: no I/O, no logging. It
 * returns the problem, the extra response headers and what to log; the exception filter validates the problem against
 * ProblemDetailsSchema and sends it.
 *
 * - Every failure gets exactly one stable `code`. `detail` is curated text from this file or a DomainError, never a
 *   library's message: those carry SQL, stack traces, query arguments or the request URL.
 * - A database or Redis outage is SERVICE_UNAVAILABLE (503, retryable), never UNAUTHENTICATED: the web app signs the
 *   user out on 401.
 * - Errors are recognised structurally (known-errors.ts): Prisma by name and P-code, Fastify by FST_ code.
 */
import {
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  MAX_FIELD_ERRORS,
  PROBLEM_LIMITS,
  ProblemDetailsSchema,
  problemTypeUrl,
} from "@finlytics/shared";
import type { ErrorCode, FieldError, ProblemDetails } from "@finlytics/shared";

import { DomainError, SERVICE_UNAVAILABLE_RETRY_AFTER_SEC, ValidationError } from "./domain-errors";
import { fieldError, fieldErrorsFromZod } from "./field-errors";
import {
  fastifyErrorCode,
  isHttpException,
  isNetworkError,
  isPgUnavailableError,
  isRedisUnavailableError,
  nestjsZodError,
  prismaErrorInfo,
  property,
  zodIssues,
} from "./known-errors";
import type { PrismaErrorInfo, ZodIssueLike } from "./known-errors";
import { singleLine } from "./text";

export type ProblemLogLevel = "debug" | "info" | "warn" | "error";

/** What the filter logs for a problem. `fields` never hold request data beyond the path. */
export interface ProblemLog {
  readonly level: ProblemLogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface ProblemContext {
  /** The request id: Fastify's `request.id`, which always matches REQUEST_ID_PATTERN (genReqId). */
  readonly requestId: string;
  /** The request target (path and query string). The problem's `instance` is its path. */
  readonly url?: string | undefined;
}

export interface ProblemResult {
  readonly problem: ProblemDetails;
  /** Extra response headers: `Retry-After` whenever `retryAfterSec` is set. */
  readonly headers: Readonly<Record<string, string>>;
  readonly log: ProblemLog;
}

/** The `Retry-After` for a write conflict or deadlock (P2034): retrying soon usually succeeds. */
const WRITE_CONFLICT_RETRY_AFTER_SEC = 1;

/** Prisma codes that mean the database is unreachable, overloaded or too slow. */
const PRISMA_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"]);

/**
 * SQLSTATEs that mean the same: 57014 statement timeout (query_canceled), 53300 too many connections, 57P01–57P03 the
 * server is shutting down or starting, and class 08 (connection exceptions).
 */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set(["57014", "53300", "57P01", "57P02", "57P03"]);

/** Curated details. */
const DETAILS = Object.freeze({
  validation: "The request is invalid.",
  bodyTooLarge: "The request body exceeds 1 MiB.",
  mediaType: "Send request bodies as application/json.",
  invalidJson: "The request body is not valid JSON.",
  contentLength: "The request body does not match its Content-Length.",
  badUrl: "The request URL is not valid.",
  timeout: "The request took too long.",
  duplicate: "A record with these values already exists.",
  referenced: "This record is still referenced.",
} as const);

/** What a classified error turns into, before the problem is assembled. */
interface Classified {
  readonly code: ErrorCode;
  readonly detail?: string | undefined;
  readonly errors?: readonly FieldError[] | undefined;
  readonly retryAfterSec?: number | undefined;
  readonly log: ProblemLog;
}

const log = (level: ProblemLogLevel, message: string, fields: Record<string, unknown> = {}): ProblemLog => ({
  level,
  message,
  fields,
});

/** The level a code is logged at when nothing more specific applies: 4xx info, 5xx error. */
function levelFor(code: ErrorCode): ProblemLogLevel {
  return ERROR_HTTP_STATUS[code] >= 500 ? "error" : "info";
}

/** Issue paths and codes only: never messages (unknown keys) or inputs. */
function issueSummary(issues: readonly ZodIssueLike[]): { path: string; code: string }[] {
  return issues.slice(0, 20).map(({ path, code }) => ({ path: path.map(String).join("."), code }));
}

function classifyDomainError(error: DomainError): Classified {
  const errors = error instanceof ValidationError ? error.fieldErrors : undefined;
  const level = error.logLevel ?? levelFor(error.code);
  return {
    code: error.code,
    detail: error.detail,
    errors,
    retryAfterSec: error.retryAfterSec,
    // 5xx: the error with its cause chain (the err serializer keeps Prisma causes to type and code). 4xx: the code.
    log: level === "error" ? log(level, error.code, { err: error }) : log(level, error.code),
  };
}

function classifyFastifyError(code: string, error: unknown): Classified | undefined {
  switch (code) {
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return { code: "PAYLOAD_TOO_LARGE", detail: DETAILS.bodyTooLarge, log: log("info", code) };
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return { code: "UNSUPPORTED_MEDIA_TYPE", detail: DETAILS.mediaType, log: log("info", code) };
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return { code: "VALIDATION", detail: DETAILS.invalidJson, log: log("info", code) };
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return { code: "VALIDATION", detail: DETAILS.contentLength, log: log("info", code) };
    case "FST_ERR_BAD_URL":
      return { code: "VALIDATION", detail: DETAILS.badUrl, log: log("info", code) };
    case "FST_ERR_HANDLER_TIMEOUT":
      return {
        code: "SERVICE_UNAVAILABLE",
        detail: DETAILS.timeout,
        retryAfterSec: SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
        log: log("warn", code),
      };
    default: {
      const status = property(error, "statusCode");
      return typeof status === "number" ? classifyStatus(status, code) : undefined;
    }
  }
}

function prismaLogFields(info: PrismaErrorInfo): Record<string, unknown> {
  return {
    prisma: {
      name: info.name,
      ...(info.code === undefined ? {} : { code: info.code }),
      ...(info.sqlState === undefined ? {} : { sqlState: info.sqlState }),
      ...(info.model === undefined ? {} : { model: info.model }),
    },
  };
}

function classifyPrismaError(info: PrismaErrorInfo): Classified {
  const fields = prismaLogFields(info);
  if (info.name === "PrismaClientValidationError") {
    // Its message lists the query's arguments: logged by name only.
    return { code: "INTERNAL", log: log("error", "prisma validation error", { prisma: { name: info.name } }) };
  }
  const unavailable =
    info.name === "PrismaClientInitializationError" ||
    (info.code !== undefined && PRISMA_UNAVAILABLE_CODES.has(info.code)) ||
    (info.sqlState !== undefined && (UNAVAILABLE_SQLSTATES.has(info.sqlState) || info.sqlState.startsWith("08")));
  if (unavailable) {
    return {
      code: "SERVICE_UNAVAILABLE",
      retryAfterSec: SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
      log: log("error", "database unavailable", fields),
    };
  }
  switch (info.code) {
    case "P2002":
      return { code: "CONFLICT", detail: DETAILS.duplicate, log: log("info", "unique constraint", fields) };
    case "P2025":
      return { code: "NOT_FOUND", log: log("info", "record not found", fields) };
    case "P2003":
      return { code: "CONFLICT", detail: DETAILS.referenced, log: log("info", "foreign key constraint", fields) };
    case "P2034":
      return {
        code: "SERVICE_UNAVAILABLE",
        retryAfterSec: WRITE_CONFLICT_RETRY_AFTER_SEC,
        log: log("warn", "write conflict or deadlock", fields),
      };
    default:
      return { code: "INTERNAL", log: log("error", "database error", fields) };
  }
}

/** A Nest HttpException (or a Fastify error) by status. Its message is never used: it may echo the URL. */
function classifyStatus(status: number, name: string): Classified {
  const fields = { exception: name, status };
  switch (status) {
    case 400:
      return { code: "VALIDATION", log: log("info", name, fields) };
    case 401:
      return { code: "UNAUTHENTICATED", log: log("info", name, fields) };
    case 403:
      return { code: "FORBIDDEN", log: log("info", name, fields) };
    case 404:
      // Mostly unknown routes (Nest's router): its message is "Cannot GET <url>", query string included.
      return { code: "NOT_FOUND", log: log("debug", name, fields) };
    case 409:
      return { code: "CONFLICT", log: log("info", name, fields) };
    case 413:
      return { code: "PAYLOAD_TOO_LARGE", detail: DETAILS.bodyTooLarge, log: log("info", name, fields) };
    case 415:
      return { code: "UNSUPPORTED_MEDIA_TYPE", detail: DETAILS.mediaType, log: log("info", name, fields) };
    case 429:
      // Floods are expected and loud: debug, like RateLimitedError.
      return { code: "RATE_LIMITED", log: log("debug", name, fields) };
    case 503:
      return {
        code: "SERVICE_UNAVAILABLE",
        retryAfterSec: SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
        log: log("warn", name, fields),
      };
    default:
      return status >= 400 && status < 500
        ? { code: "VALIDATION", log: log("info", name, fields) }
        : { code: "INTERNAL", log: log("error", name, fields) };
  }
}

function nameOf(error: unknown): string {
  const name = property(error, "name");
  return typeof name === "string" && name !== "" ? name : "Error";
}

/** Sorts an error into its code, detail, field errors, retry hint and log entry. */
function classify(error: unknown): Classified {
  if (error instanceof DomainError) return classifyDomainError(error);

  if (nameOf(error) === "TenancyViolationError") {
    return {
      code: "INTERNAL",
      log: log("error", "tenancy violation", {
        model: property(error, "model"),
        operation: property(error, "operation"),
      }),
    };
  }

  const nestjsZod = nestjsZodError(error);
  if (nestjsZod !== undefined) {
    if (nestjsZod.status === 400) {
      return {
        code: "VALIDATION",
        detail: DETAILS.validation,
        errors: fieldErrorsFromZod(nestjsZod.issues),
        log: log("info", "request validation failed", { issues: issueSummary(nestjsZod.issues) }),
      };
    }
    // A response that failed its own schema: a bug. Issue paths only (reportInput stays off).
    return {
      code: "INTERNAL",
      log: log("error", "response failed its schema", { issues: issueSummary(nestjsZod.issues) }),
    };
  }

  const issues = zodIssues(error);
  if (issues !== undefined) {
    // A bare ZodError from server code (request bodies are validated by the pipe): a bug.
    return { code: "INTERNAL", log: log("error", "unexpected ZodError", { issues: issueSummary(issues) }) };
  }

  const fastifyCode = fastifyErrorCode(error);
  if (fastifyCode !== undefined) {
    const classified = classifyFastifyError(fastifyCode, error);
    if (classified !== undefined) return classified;
  }

  const prisma = prismaErrorInfo(error);
  if (prisma !== undefined) return classifyPrismaError(prisma);

  if (isPgUnavailableError(error) || isNetworkError(error)) {
    return {
      code: "SERVICE_UNAVAILABLE",
      retryAfterSec: SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
      log: log("error", "dependency unavailable", { err: error }),
    };
  }

  if (isRedisUnavailableError(error)) {
    return {
      code: "SERVICE_UNAVAILABLE",
      retryAfterSec: SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
      // Name only: never command.args.
      log: log("warn", "redis unavailable", { redisError: nameOf(error) }),
    };
  }

  if (isHttpException(error)) return classifyStatus(error.getStatus(), nameOf(error));

  return { code: "INTERNAL", log: log("error", "unhandled error", { err: error }) };
}

/** The problem's `instance`: the request path, when it passes the schema (no query, fragment, host or control). */
export function instanceFor(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return ProblemDetailsSchema.shape.instance.safeParse(path).success ? path : undefined;
}

/** Whole seconds within the contract (0 to a day), or undefined for anything that isn't a finite number. */
function boundedRetryAfter(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  return Math.min(PROBLEM_LIMITS.retryAfterSec, Math.max(0, Math.ceil(seconds)));
}

/**
 * A problem with the members `code` decides, plus the optional ones that are set, each brought within the contract's
 * bounds (a DomainError built by hand could carry anything).
 */
export function buildProblem(
  code: ErrorCode,
  context: ProblemContext,
  extras: Pick<Classified, "detail" | "errors" | "retryAfterSec"> = {},
): ProblemDetails {
  const detail = extras.detail === undefined ? undefined : singleLine(extras.detail, PROBLEM_LIMITS.detail);
  const instance = instanceFor(context.url);
  const errors = extras.errors
    ?.slice(0, MAX_FIELD_ERRORS)
    .map((error) => fieldError(error.path, error.message, error.code));
  const retryAfterSec = boundedRetryAfter(extras.retryAfterSec);
  return {
    type: problemTypeUrl(code),
    title: ERROR_TITLES[code],
    status: ERROR_HTTP_STATUS[code],
    code,
    ...(detail === undefined ? {} : { detail }),
    ...(instance === undefined ? {} : { instance }),
    requestId: context.requestId,
    ...(errors === undefined || errors.length === 0 ? {} : { errors: [...errors] }),
    ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
  };
}

/** The minimal problem sent when a built one fails ProblemDetailsSchema. It always validates. */
export function fallbackProblem(requestId: string): ProblemDetails {
  return {
    type: problemTypeUrl("INTERNAL"),
    title: ERROR_TITLES.INTERNAL,
    status: ERROR_HTTP_STATUS.INTERNAL,
    code: "INTERNAL",
    requestId,
  };
}

/** Maps anything thrown to its problem, its extra headers and its log entry. */
export function toProblem(error: unknown, context: ProblemContext): ProblemResult {
  const classified = classify(error);
  const problem = buildProblem(classified.code, context, classified);
  const headers: Record<string, string> =
    problem.retryAfterSec === undefined ? {} : { "retry-after": String(problem.retryAfterSec) };
  return { problem, headers, log: { ...classified.log, fields: { code: problem.code, ...classified.log.fields } } };
}
