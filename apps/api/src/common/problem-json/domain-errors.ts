/**
 * Typed domain errors (plan D4, backend.md "Error handling"): one thin subclass per code the api uses in 0.5. The
 * exception filter maps each to its problem: the code decides status, title and type; `detail` is the error's own
 * curated text, never a message from a library.
 */
import type { ErrorCode, FieldError } from "@finlytics/shared";

/** The `Retry-After` for an outage of one of our dependencies. */
export const SERVICE_UNAVAILABLE_RETRY_AFTER_SEC = 5;

/** The level a problem is logged at. */
export type DomainErrorLogLevel = "debug" | "info" | "warn" | "error";

export interface DomainErrorOptions {
  /** The underlying error, for the logs only: it never reaches a response. */
  readonly cause?: unknown;
  /** Whole seconds a client should wait before retrying; sent as `Retry-After` and `retryAfterSec`. */
  readonly retryAfterSec?: number;
  /** Overrides the default log level (4xx info, 5xx error with the error), for expected, high-volume outcomes. */
  readonly logLevel?: DomainErrorLogLevel;
}

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  /** The problem's `detail`: curated, one line, safe to show. */
  readonly detail: string | undefined;
  readonly retryAfterSec: number | undefined;
  readonly logLevel: DomainErrorLogLevel | undefined;

  constructor(detail?: string, options: DomainErrorOptions = {}) {
    super(detail ?? new.target.name, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.detail = detail;
    this.retryAfterSec = options.retryAfterSec;
    this.logLevel = options.logLevel;
  }
}

/** 400: the request is invalid. `fieldErrors` become the problem's `errors[]`. */
export class ValidationError extends DomainError {
  readonly code = "VALIDATION";
  readonly fieldErrors: readonly FieldError[];

  constructor(
    detail = "The request is invalid.",
    fieldErrors: readonly FieldError[] = [],
    options?: DomainErrorOptions,
  ) {
    super(detail, options);
    this.fieldErrors = fieldErrors;
  }
}

/** 401: no valid session. The web app signs the user out on it, so it never stands for an outage. */
export class UnauthenticatedError extends DomainError {
  readonly code = "UNAUTHENTICATED";
}

/** 403: authenticated, but not allowed (also a CSRF rejection). */
export class ForbiddenError extends DomainError {
  readonly code = "FORBIDDEN";
}

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";
}

export class ConflictError extends DomainError {
  readonly code = "CONFLICT";
}

/** 409: the same Idempotency-Key is still being processed. */
export class IdempotentReplayError extends DomainError {
  readonly code = "IDEMPOTENT_REPLAY";
}

export class PayloadTooLargeError extends DomainError {
  readonly code = "PAYLOAD_TOO_LARGE";
}

export class UnsupportedMediaTypeError extends DomainError {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
}

/** 429, with the wait until the next request would be admitted. Logged at debug: a flood must not flood the logs. */
export class RateLimitedError extends DomainError {
  readonly code = "RATE_LIMITED";

  constructor(retryAfterSec: number, detail = "Too many requests. Retry after the time in Retry-After.") {
    super(detail, { retryAfterSec, logLevel: "debug" });
  }
}

/** 503: one of our own dependencies failed or was too slow, or the server is draining. Retryable; never a 401. */
export class ServiceUnavailableError extends DomainError {
  readonly code = "SERVICE_UNAVAILABLE";

  constructor(detail?: string, options: DomainErrorOptions = {}) {
    super(detail, { retryAfterSec: SERVICE_UNAVAILABLE_RETRY_AFTER_SEC, ...options });
  }
}

/**
 * 503: the request ended before its handler started: it ran out of time (its 503 has already been sent) or the client
 * went away. Thrown instead of running the handler (common/idempotency/idempotency.interceptor.ts); logged at info.
 */
export class RequestEndedError extends ServiceUnavailableError {
  constructor(readonly reason: "timeout" | "client-closed") {
    super(reason === "timeout" ? "The request took too long." : "The client closed the connection.", {
      logLevel: "info",
    });
  }
}

/** 500: a bug. Logged in full; the response says nothing about it. */
export class InternalError extends DomainError {
  readonly code = "INTERNAL";
}
