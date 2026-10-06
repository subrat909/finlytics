/**
 * Broker failures as api problems (docs/04 §6). @finlytics/broker-sdk throws typed, redacted BrokerErrors; this maps
 * each code to a DomainError with our own curated `detail` (never the broker's text, which the problem can't vouch
 * for), and gives the short `lastError` text stored on an account.
 */
import { isBrokerError } from "@finlytics/broker-sdk";
import type { ErrorCode } from "@finlytics/shared";

import {
  DomainError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  ValidationError,
} from "../../common/problem-json/domain-errors";
import type { DomainErrorOptions } from "../../common/problem-json/domain-errors";

/** A problem whose code is chosen at runtime (BROKER_REJECTED, BROKER_UNAVAILABLE, NEEDS_RELOGIN). */
export class BrokerDomainError extends DomainError {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, detail: string, options?: DomainErrorOptions) {
    super(detail, options);
    this.code = code;
  }
}

/** Seconds to wait after a broker outage. */
const BROKER_RETRY_AFTER_SEC = 5;

/** Where the call happened: connecting (credentials being checked) or using a connected account. */
export type BrokerCallStage = "connect" | "call";

/** The DomainError for anything a gateway call threw. */
export function brokerProblem(error: unknown, stage: BrokerCallStage): DomainError {
  if (error instanceof DomainError) return error;
  if (!isBrokerError(error)) return new InternalError("Broker call failed.", { cause: error });
  switch (error.code) {
    case "NEEDS_RELOGIN":
      return stage === "connect"
        ? new BrokerDomainError("BROKER_REJECTED", "The broker did not accept these credentials.")
        : new BrokerDomainError("NEEDS_RELOGIN", "Log in to your broker again to continue.");
    case "BROKER_REJECTED":
      return new BrokerDomainError("BROKER_REJECTED", "The broker rejected the request.");
    case "RATE_LIMITED":
      return new RateLimitedError(
        Math.max(1, Math.ceil((error.retryAfterMs ?? 1_000) / 1_000)),
        "The broker's request budget is used up. Retry after the time in Retry-After.",
      );
    case "BROKER_UNAVAILABLE":
      return new BrokerDomainError("BROKER_UNAVAILABLE", "The broker is not responding. Try again shortly.", {
        retryAfterSec: BROKER_RETRY_AFTER_SEC,
        cause: error,
      });
    case "SERVICE_UNAVAILABLE":
      return new ServiceUnavailableError("A service the broker connection needs is unavailable.", { cause: error });
    case "NOT_FOUND":
      return new NotFoundError("The broker does not know this item.");
    case "VALIDATION":
      return new ValidationError("The broker request is invalid.");
    case "INTERNAL":
      return new InternalError("Broker integration error.", { cause: error });
  }
}

/** The account's `lastError` for a failed connection or call: our own words, at most 300 characters. */
export function lastErrorFor(problem: DomainError): string {
  switch (problem.code) {
    case "BROKER_REJECTED":
      return "The broker did not accept the login. Connect the account again.";
    case "NEEDS_RELOGIN":
      return "The broker session has ended. Log in again.";
    case "BROKER_UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
    case "RATE_LIMITED":
      return "The broker could not be reached. Try again shortly.";
    default:
      return "The broker connection failed.";
  }
}
