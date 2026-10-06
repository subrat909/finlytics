/**
 * One Upstox REST call: build the request, send it with the call's AbortSignal, unwrap `{ status, data }`, validate
 * `data`, and turn every failure into a typed BrokerError (broker.md):
 *
 * | Upstox answer                                      | Error                                                   |
 * | -------------------------------------------------- | ------------------------------------------------------- |
 * | 401, `UDAPI100050` (invalid token), `UDAPI100067`  | NeedsReloginError                                       |
 * | 429, `UDAPI10005`, `UDAPI100099`                   | RateLimitedError (`Retry-After`, else 1 s)              |
 * | 5xx, network failure, unreadable success body      | BrokerUnavailableError (outcome unknown when mutating)  |
 * | `UDAPI100072`/`UDAPI100074` (service hours)        | BrokerUnavailableError                                  |
 * | 404, `UDAPI100010` (order not found)               | BrokerNotFoundError                                     |
 * | any other 4xx (order rejections, bad input)        | BrokerRejectedError                                     |
 *
 * Messages are ours; Upstox's code and message go in `brokerError` (the gateway redacts them). Tokens never appear in
 * an error.
 */
import type { z } from "zod";

import type { BrokerMethod } from "../../adapter";
import type { Secret } from "../../credentials";
import {
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerUnavailableError,
  NeedsReloginError,
  RateLimitedError,
} from "../../errors";
import type { BrokerError, BrokerErrorDetail, BrokerErrorOptions } from "../../errors";
import { abortReason } from "../../timeout";

import { UPSTOX_ERROR_CODES, UpstoxErrorBodySchema } from "./types";

/** The `fetch` the adapter uses (Node's global by default; tests inject a fake Upstox). */
export type UpstoxFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface UpstoxCallContext {
  readonly fetch: UpstoxFetch;
  readonly signal: AbortSignal;
  readonly operation: BrokerMethod;
  /** State-changing: a failure without an answer leaves the outcome unknown. */
  readonly mutating?: boolean | undefined;
}

export interface UpstoxRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly token?: Secret | undefined;
  readonly json?: unknown;
  readonly form?: Readonly<Record<string, string>> | undefined;
}

const RELOGIN_CODES: ReadonlySet<string> = new Set([
  UPSTOX_ERROR_CODES.INVALID_TOKEN,
  UPSTOX_ERROR_CODES.EXTENDED_TOKEN_NOT_PERMITTED,
]);
const RATE_CODES: ReadonlySet<string> = new Set([
  UPSTOX_ERROR_CODES.RATE_LIMITED,
  UPSTOX_ERROR_CODES.TOKEN_RATE_LIMITED,
]);
const SERVICE_HOURS_CODES: ReadonlySet<string> = new Set([
  UPSTOX_ERROR_CODES.FUNDS_SERVICE_HOURS,
  UPSTOX_ERROR_CODES.ORDER_SERVICE_HOURS,
]);
const DEFAULT_RETRY_AFTER_MS = 1_000;

function errorOptions(ctx: UpstoxCallContext, extra: BrokerErrorOptions = {}): BrokerErrorOptions {
  return { broker: "UPSTOX", operation: ctx.operation, ...extra };
}

/** Throws the signal's reason (as an Error) once it has aborted. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

/** Sends the request; network failures become BrokerUnavailableError, aborts rethrow the signal's reason. */
export async function upstoxSend(ctx: UpstoxCallContext, request: UpstoxRequest): Promise<Response> {
  throwIfAborted(ctx.signal);
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (request.token !== undefined) headers.Authorization = `Bearer ${request.token.reveal()}`;
  if (request.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(request.form).toString();
  } else if (request.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.json);
  }
  try {
    return await ctx.fetch(request.url, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: ctx.signal,
    });
  } catch {
    throwIfAborted(ctx.signal);
    throw new BrokerUnavailableError(
      "Upstox could not be reached",
      errorOptions(ctx, { brokerError: { code: "NETWORK" }, outcomeUnknown: ctx.mutating === true }),
    );
  }
}

async function readBody(ctx: UpstoxCallContext, response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throwIfAborted(ctx.signal);
    throw new BrokerUnavailableError(
      "Upstox's answer was cut off",
      errorOptions(ctx, { brokerError: { code: "NETWORK" }, outcomeUnknown: ctx.mutating === true }),
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : DEFAULT_RETRY_AFTER_MS;
}

/** Upstox's own error code and message, from the first `errors[]` entry. */
function brokerDetail(status: number, body: unknown): BrokerErrorDetail {
  const parsed = UpstoxErrorBodySchema.safeParse(body);
  const first = parsed.success ? parsed.data.errors?.[0] : undefined;
  const code = (first?.errorCode ?? first?.error_code ?? "").slice(0, 64) || `HTTP_${String(status)}`;
  const message = first?.message?.trim().slice(0, 500);
  return { code, ...(message ? { message } : {}) };
}

/** The typed error for a non-success answer. */
export function upstoxError(ctx: UpstoxCallContext, response: Response, body: unknown): BrokerError {
  const { status } = response;
  const brokerError = brokerDetail(status, body);
  const { code } = brokerError;
  const options = errorOptions(ctx, { brokerError });
  if (status === 401 || RELOGIN_CODES.has(code)) {
    return new NeedsReloginError("The Upstox session is not valid: log in to Upstox again", options);
  }
  if (status === 429 || RATE_CODES.has(code)) {
    return new RateLimitedError("Upstox's rate limit was reached", {
      ...options,
      retryAfterMs: retryAfterMs(response),
    });
  }
  if (status >= 500) {
    return new BrokerUnavailableError("Upstox is unavailable", {
      ...options,
      outcomeUnknown: ctx.mutating === true,
      retryAfterMs: retryAfterMs(response),
    });
  }
  if (SERVICE_HOURS_CODES.has(code)) {
    return new BrokerUnavailableError("This Upstox service is closed now (it runs 05:30–24:00 IST)", options);
  }
  if (status === 404 || code === UPSTOX_ERROR_CODES.ORDER_NOT_FOUND) {
    return new BrokerNotFoundError("Upstox does not know this order", options);
  }
  return new BrokerRejectedError("Upstox rejected the request", options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Calls Upstox and returns the validated `data` (or the whole body when Upstox sends no envelope, as Get Token does).
 *
 * @throws {BrokerError} as tabled above; the signal's reason when it aborts.
 */
export async function upstoxCall<S extends z.ZodType>(
  ctx: UpstoxCallContext,
  request: UpstoxRequest,
  schema: S,
): Promise<z.infer<S>> {
  const response = await upstoxSend(ctx, request);
  const body = await readBody(ctx, response);
  if (!response.ok || (isRecord(body) && body.status === "error")) throw upstoxError(ctx, response, body);
  const data = isRecord(body) && body.status === "success" && "data" in body ? body.data : body;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new BrokerUnavailableError(
      "Upstox sent an answer in an unexpected shape",
      errorOptions(ctx, { brokerError: { code: "UNEXPECTED_RESPONSE" }, outcomeUnknown: ctx.mutating === true }),
    );
  }
  return parsed.data;
}
