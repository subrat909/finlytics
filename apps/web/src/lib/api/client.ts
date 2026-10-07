/**
 * The browser's api client (plan W7): same-origin `/v1/...` requests (the dev rewrite or the ingress routes them to the
 * api), the session cookie sent automatically, responses validated with the shared Zod schemas, failures as `ApiError`
 * carrying the problem's stable `code` (docs/04 §7). Status handling (api plan §10.1):
 * - 401 `UNAUTHENTICATED` → signed out: the query layer sends the user to /login.
 * - 503 `SERVICE_UNAVAILABLE`, 429 `RATE_LIMITED` → retry with backoff, never sign out.
 * - 409 `NEEDS_RELOGIN` → the broker banner (1.5).
 */
import { isProblemDetails, isRetryableErrorCode } from "@finlytics/shared";
import type { ReceivedProblemDetails } from "@finlytics/shared";
import type { z } from "zod";

export type ApiPath = `/v1/${string}`;

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  /** The problem's `code`; `NETWORK` when no response arrived, `BAD_RESPONSE` when it wasn't what we expected. */
  readonly code: string;
  /** For support (ErrorState's "Reference"). */
  readonly requestId: string | undefined;
  readonly retryAfterSec: number | undefined;
  /** The problem's `detail`: safe to show (the api writes it for users, e.g. which plan limit was reached). */
  readonly detail: string | undefined;
  /** Field-level validation errors (`errors[]`), keyed the way react-hook-form names fields. */
  readonly fieldErrors: readonly { path: string; message: string }[];

  constructor(status: number, code: string, problem?: ReceivedProblemDetails) {
    super(problem?.title ?? code);
    this.status = status;
    this.code = code;
    this.requestId = problem?.requestId;
    this.retryAfterSec = problem?.retryAfterSec;
    this.detail = problem?.detail;
    this.fieldErrors = problem?.errors ?? [];
  }

  /** Signed out: the session is gone or was never valid. */
  get unauthenticated(): boolean {
    return this.status === 401;
  }

  /** Worth retrying automatically: a network failure or a retryable problem code. Never a 401. */
  get retryable(): boolean {
    return this.code === "NETWORK" || isRetryableErrorCode(this.code);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Serialised as JSON with `content-type: application/json`. */
  json?: unknown;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string>;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(path: ApiPath, schema: z.ZodType<T>, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", json, signal, headers = {} } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json, application/problem+json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    // An abort is the caller's decision (unmount, a newer query); let it through untouched.
    if (signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK");
  }

  const body = await readJson(response);
  if (!response.ok) {
    if (isProblemDetails(body)) throw new ApiError(response.status, body.code, body);
    throw new ApiError(response.status, response.status === 401 ? "UNAUTHENTICATED" : "BAD_RESPONSE");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(response.status, "BAD_RESPONSE");
  return parsed.data;
}

/** TanStack Query's retry policy: up to 3 tries for retryable failures, none for anything else. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < 3 && isApiError(error) && error.retryable;
}
