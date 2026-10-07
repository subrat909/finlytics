/**
 * Dhan REST transport: one `fetch` per call (injected; Node's native fetch by default), the caller's AbortSignal on
 * every request, and Dhan's errors mapped to the sdk's typed errors. Never retries: the gateway owns retries and only
 * for reads. Messages never carry the token, the URL's query or a payload; the broker's own text goes in
 * `brokerError.message`, which the gateway redacts.
 */
import type { BrokerMethod } from "../../adapter";
import { MUTATING_METHODS } from "../../adapter";
import {
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerUnavailableError,
  NeedsReloginError,
  RateLimitedError,
} from "../../errors";
import type { BrokerError, BrokerErrorOptions } from "../../errors";
import { abortReason } from "../../timeout";

/** The subset of `fetch` the adapter uses (Node's global fetch satisfies it). */
export type DhanFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface DhanRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** Absolute URL, or a path under the API base. */
  readonly url: string;
  readonly operation: BrokerMethod;
  readonly signal: AbortSignal;
  readonly token?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: unknown;
  /** A successful answer that isn't JSON is returned as its trimmed text instead of failing (RenewToken). */
  readonly allowText?: boolean | undefined;
}

const BROKER = "DHAN" as const;
const DEFAULT_RETRY_AFTER_MS = 1_000;

type ErrorClass = new (message: string, options: BrokerErrorOptions) => BrokerError;

/** Trading API codes (DH-9xx) and data API codes (8xx) → the sdk's error class. */
const ERROR_CLASSES: Readonly<Record<string, ErrorClass>> = Object.freeze({
  "DH-901": NeedsReloginError,
  "DH-902": BrokerRejectedError,
  "DH-903": BrokerRejectedError,
  "DH-904": RateLimitedError,
  "DH-905": BrokerRejectedError,
  "DH-906": BrokerRejectedError,
  "DH-907": BrokerNotFoundError,
  "DH-908": BrokerUnavailableError,
  "DH-909": BrokerUnavailableError,
  "DH-910": BrokerRejectedError,
  "800": BrokerUnavailableError,
  "804": BrokerRejectedError,
  "805": RateLimitedError,
  "806": BrokerRejectedError,
  "807": NeedsReloginError,
  "808": NeedsReloginError,
  "809": NeedsReloginError,
  "810": NeedsReloginError,
  "811": BrokerRejectedError,
  "812": BrokerRejectedError,
  "813": BrokerRejectedError,
  "814": BrokerRejectedError,
});

const MESSAGES: ReadonlyMap<ErrorClass, string> = new Map<ErrorClass, string>([
  [NeedsReloginError, "The Dhan session is invalid or expired; paste a new access token"],
  [RateLimitedError, "Dhan rate limit reached"],
  [BrokerNotFoundError, "Dhan has no such order or data"],
  [BrokerUnavailableError, "Dhan could not process the request"],
  [BrokerRejectedError, "Dhan rejected the request"],
]);

/** The annexure's error types (`Invalid_Authentication`, "Rate Limit", ...), normalised, for answers without a code. */
const ERROR_TYPE_CLASSES: Readonly<Record<string, ErrorClass>> = Object.freeze({
  INVALID_AUTHENTICATION: NeedsReloginError,
  INVALID_ACCESS: BrokerRejectedError,
  USER_ACCOUNT: BrokerRejectedError,
  RATE_LIMIT: RateLimitedError,
  INPUT_EXCEPTION: BrokerRejectedError,
  ORDER_ERROR: BrokerRejectedError,
  DATA_ERROR: BrokerNotFoundError,
  INTERNAL_SERVER_ERROR: BrokerUnavailableError,
  NETWORK_ERROR: BrokerUnavailableError,
  OTHERS: BrokerRejectedError,
});

const FAILURE_STATUSES: ReadonlySet<string> = new Set(["FAILURE", "FAILED", "ERROR"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** What Dhan said went wrong. */
export interface DhanErrorFields {
  readonly code?: string | undefined;
  readonly type?: string | undefined;
  readonly message?: string | undefined;
}

/**
 * Dhan's error fields from any of its error shapes: v2's `{ errorType, errorCode, errorMessage }`, the snake-case
 * `error_*` form, either inside `remarks`, `data` or `error`, or a bare `{ status: "failure", remarks }`. Undefined
 * when the body is not an error (arrays never are).
 */
export function dhanErrorFields(body: unknown): DhanErrorFields | undefined {
  if (!isRecord(body)) return undefined;
  for (const source of [body, body.remarks, body.data, body.error]) {
    if (!isRecord(source)) continue;
    const code = textOf(source.errorCode ?? source.error_code);
    const type = textOf(source.errorType ?? source.error_type);
    if (code === undefined && type === undefined) continue;
    const message = textOf(source.errorMessage ?? source.error_message ?? source.message);
    return { code, type, message };
  }
  const status = textOf(body.status)?.toUpperCase();
  if (status !== undefined && FAILURE_STATUSES.has(status)) {
    return { message: textOf(body.remarks) ?? textOf(body.message) ?? textOf(body.errorMessage) };
  }
  return undefined;
}

function classForType(type: string | undefined): ErrorClass | undefined {
  if (type === undefined) return undefined;
  return ERROR_TYPE_CLASSES[
    type
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
  ];
}

function classForStatus(status: number): ErrorClass {
  if (status === 401) return NeedsReloginError;
  if (status === 404) return BrokerNotFoundError;
  if (status === 429) return RateLimitedError;
  if (status >= 500) return BrokerUnavailableError;
  return BrokerRejectedError;
}

function retryAfterMs(header: string | null): number {
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_AFTER_MS;
}

/**
 * The typed error for a Dhan error answer: Dhan's code decides when there is one (DH-901 → NEEDS_RELOGIN, 807–810 →
 * NEEDS_RELOGIN, DH-904/805 → RATE_LIMITED, DH-907 → NOT_FOUND, ...), else its error type, else the HTTP status
 * (401 → NEEDS_RELOGIN). A mutating call that fails as "unavailable" may still have happened: `outcomeUnknown`.
 */
export function dhanError(
  status: number,
  body: unknown,
  operation: BrokerMethod,
  retryAfter: string | null = null,
): BrokerError {
  const fields = dhanErrorFields(body);
  const code = fields?.code?.toUpperCase();
  const ErrorType =
    (code === undefined ? undefined : ERROR_CLASSES[code]) ?? classForType(fields?.type) ?? classForStatus(status);
  const message = fields?.message;
  const options: BrokerErrorOptions = {
    broker: BROKER,
    operation,
    brokerError: {
      code: (code ?? `HTTP_${String(status)}`).slice(0, 64),
      ...(message === undefined ? {} : { message: message.slice(0, 500) }),
    },
    ...(ErrorType === RateLimitedError ? { retryAfterMs: retryAfterMs(retryAfter) } : {}),
    ...(ErrorType === BrokerUnavailableError && MUTATING_METHODS.has(operation) ? { outcomeUnknown: true } : {}),
  };
  /* v8 ignore next -- every class in the table has a message */
  return new ErrorType(MESSAGES.get(ErrorType) ?? "Dhan request failed", options);
}

/** A transport failure (no answer): unavailable, and the outcome is unknown for a mutating call. */
function transportError(operation: BrokerMethod, what: string): BrokerUnavailableError {
  return new BrokerUnavailableError(what, {
    broker: BROKER,
    operation,
    brokerError: { code: "NETWORK" },
    ...(MUTATING_METHODS.has(operation) ? { outcomeUnknown: true } : {}),
  });
}

/**
 * Sends one request and returns the parsed JSON (`undefined` for an empty body).
 *
 * @throws the signal's abort reason when it aborts; a typed BrokerError otherwise.
 */
export async function dhanRequest(fetchFn: DhanFetch, baseUrl: string, request: DhanRequest): Promise<unknown> {
  const { signal, operation } = request;
  signal.throwIfAborted();
  const headers: Record<string, string> = { Accept: "application/json", ...request.headers };
  if (request.token !== undefined) headers["access-token"] = request.token;
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  const url = /^https?:\/\//.test(request.url) ? request.url : `${baseUrl}${request.url}`;

  let response: Response;
  let text: string;
  try {
    response = await fetchFn(url, {
      method: request.method,
      headers,
      signal,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
    text = await response.text();
  } catch {
    if (signal.aborted) throw abortReason(signal);
    throw transportError(operation, "Dhan did not answer");
  }

  let body: unknown;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      if (!response.ok) throw dhanError(response.status, undefined, operation, response.headers.get("retry-after"));
      if (request.allowText === true) return text.trim();
      throw transportError(operation, "Dhan answered with something other than JSON");
    }
  }
  if (!response.ok) throw dhanError(response.status, body, operation, response.headers.get("retry-after"));
  // Some failures come back as 200 with an error body.
  if (dhanErrorFields(body) !== undefined) throw dhanError(response.status, body, operation);
  return body;
}

/** An answer that doesn't have the documented shape: unavailable (garbage), outcome unknown for mutating calls. */
export function unexpectedAnswer(operation: BrokerMethod): BrokerUnavailableError {
  return new BrokerUnavailableError("Dhan answered in an unexpected shape", {
    broker: BROKER,
    operation,
    brokerError: { code: "UNEXPECTED_RESPONSE" },
    ...(MUTATING_METHODS.has(operation) ? { outcomeUnknown: true } : {}),
  });
}
