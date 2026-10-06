/**
 * Typed broker errors (plan B4). Each maps to one stable error code from @finlytics/shared, so the api's problem+json
 * filter can turn it into a response without knowing brokers: `code` → status, title and type; `brokerError` → the
 * problem's `broker` member; `retryAfterMs` → `Retry-After`.
 *
 * Messages are ours and curated. A broker's own text goes in `brokerError.message`, and the gateway redacts both
 * (./redact.ts) before an error leaves it. No `cause` is kept from adapters: a raw HTTP error can carry headers.
 *
 * Detection is structural ({@link isBrokerError}), not `instanceof`: the ESM and CJS builds can both be loaded.
 */
import { isRetryableErrorCode } from "@finlytics/shared";
import type { BrokerCode, ErrorCode } from "@finlytics/shared";

import type { BrokerMethod } from "./adapter";

const BRAND = Symbol.for("finlytics.broker-sdk.BrokerError");

/** The codes broker errors use. */
export type BrokerErrorCode = Extract<
  ErrorCode,
  | "BROKER_REJECTED"
  | "BROKER_UNAVAILABLE"
  | "NEEDS_RELOGIN"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INTERNAL"
  | "SERVICE_UNAVAILABLE"
>;

/** The broker's own error, as the problem's `broker` member: `code` 1–64 characters, `message` 1–500. */
export interface BrokerErrorDetail {
  readonly code: string;
  readonly message?: string | undefined;
}

export interface BrokerErrorOptions {
  readonly broker?: BrokerCode | undefined;
  readonly operation?: BrokerMethod | undefined;
  readonly brokerError?: BrokerErrorDetail | undefined;
  /** Milliseconds to wait before retrying (RATE_LIMITED, BROKER_UNAVAILABLE). */
  readonly retryAfterMs?: number | undefined;
  /**
   * A state-changing call failed without a definitive answer (timeout, connection lost): it may have happened at the
   * broker. Reconcile through the order book; never retry blindly.
   */
  readonly outcomeUnknown?: boolean | undefined;
}

export abstract class BrokerError extends Error {
  abstract readonly code: BrokerErrorCode;
  readonly broker: BrokerCode | undefined;
  readonly operation: BrokerMethod | undefined;
  readonly brokerError: BrokerErrorDetail | undefined;
  readonly retryAfterMs: number | undefined;
  readonly outcomeUnknown: boolean;

  constructor(message: string, options: BrokerErrorOptions = {}) {
    super(message);
    Object.defineProperty(this, BRAND, { value: true });
    this.broker = options.broker;
    this.operation = options.operation;
    this.brokerError = options.brokerError;
    this.retryAfterMs = options.retryAfterMs;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }

  /** Whether sending the same request again later can succeed (RATE_LIMITED, BROKER_UNAVAILABLE, SERVICE_UNAVAILABLE). */
  get retryable(): boolean {
    return isRetryableErrorCode(this.code) && !this.outcomeUnknown;
  }

  /** The options this error was built with, for {@link BrokerError.with}. */
  get options(): BrokerErrorOptions {
    return {
      broker: this.broker,
      operation: this.operation,
      brokerError: this.brokerError,
      retryAfterMs: this.retryAfterMs,
      outcomeUnknown: this.outcomeUnknown,
    };
  }

  /** A copy of the same class with a new message and/or options (the gateway adds context and redacts). */
  with(patch: { readonly message?: string } & BrokerErrorOptions): this {
    const { message = this.message, ...options } = patch;
    const ctor = this.constructor as new (message: string, options: BrokerErrorOptions) => this;
    return new ctor(message, { ...this.options, ...withoutUndefined(options) });
  }

  /** Logs and JSON never include a stack or cause. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      broker: this.broker,
      operation: this.operation,
      brokerError: this.brokerError,
      retryAfterMs: this.retryAfterMs,
      outcomeUnknown: this.outcomeUnknown,
    };
  }
}

function withoutUndefined(options: BrokerErrorOptions): BrokerErrorOptions {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

/** The broker refused the request (margin, RMS, invalid order, order not open). Not retryable as is. */
export class BrokerRejectedError extends BrokerError {
  readonly code = "BROKER_REJECTED";
  override readonly name = "BrokerRejectedError";
}

/** The broker is down, slow or answered garbage. Retryable unless `outcomeUnknown`. */
export class BrokerUnavailableError extends BrokerError {
  readonly code = "BROKER_UNAVAILABLE";
  override readonly name: string = "BrokerUnavailableError";
}

/** The call ran out of time ({@link withTimeout}); on a mutating call the outcome is unknown. */
export class BrokerTimeoutError extends BrokerUnavailableError {
  override readonly name = "BrokerTimeoutError";
}

/** The circuit breaker is open for this broker and account: the call was not sent (fail closed). */
export class CircuitOpenError extends BrokerUnavailableError {
  override readonly name = "CircuitOpenError";
}

/** The broker session expired or was revoked: the user must log in to the broker again (409, never 401). */
export class NeedsReloginError extends BrokerError {
  readonly code = "NEEDS_RELOGIN";
  override readonly name = "NeedsReloginError";
}

/** Our limiter or the broker refused for rate. `retryAfterMs` says when to try again. */
export class RateLimitedError extends BrokerError {
  readonly code = "RATE_LIMITED";
  override readonly name = "RateLimitedError";
}

/** The broker doesn't know the order (or other entity) the call names. */
export class BrokerNotFoundError extends BrokerError {
  readonly code = "NOT_FOUND";
  override readonly name = "BrokerNotFoundError";
}

/** The input failed validation before reaching the broker. */
export class BrokerInputError extends BrokerError {
  readonly code = "VALIDATION";
  override readonly name = "BrokerInputError";
}

/** A bug: the adapter threw something untyped or returned data that fails the models. */
export class BrokerInternalError extends BrokerError {
  readonly code = "INTERNAL";
  override readonly name = "BrokerInternalError";
}

/** One of our own dependencies (Redis for the rate limiter) failed; calls fail closed. */
export class DependencyUnavailableError extends BrokerError {
  readonly code = "SERVICE_UNAVAILABLE";
  override readonly name = "DependencyUnavailableError";
}

/** Whether `value` is a BrokerError from any copy of this package. */
export function isBrokerError(value: unknown): value is BrokerError {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
}

/** Whether an error says the broker (or adapter) is unhealthy: what the circuit breaker counts (plan B8). */
export function isBrokerFailure(error: unknown): boolean {
  if (!isBrokerError(error)) return true;
  return error.code === "BROKER_UNAVAILABLE" || error.code === "INTERNAL";
}
