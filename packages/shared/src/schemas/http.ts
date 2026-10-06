/**
 * HTTP conventions shared by apps/web and apps/api (plan D7, D8, D11; docs/04 §7): header names, idempotency keys and
 * request ids.
 */
import { z } from "zod";

import { REQUEST_ID_PATTERN } from "./errors";

/**
 * Header names, lowercase: HTTP header names are case-insensitive, HTTP/2 sends them lowercase, and Node exposes them
 * lowercase on `request.headers`.
 *
 * - `requestId`: the correlation id, in both directions (see {@link RequestIdSchema}).
 * - `idempotencyKey`: required on `@Idempotent()` routes (see {@link IdempotencyKeySchema}).
 * - `idempotentReplayed`: `true` on a response replayed for a retried idempotency key.
 * - `retryAfter`: whole seconds, on 429 and 503; equal to the problem's `retryAfterSec`.
 * - `rateLimit`, `rateLimitPolicy`: the rate-limit header fields of draft-ietf-httpapi-ratelimit-headers-11.
 */
export const HEADERS = Object.freeze({
  requestId: "x-request-id",
  idempotencyKey: "idempotency-key",
  idempotentReplayed: "idempotent-replayed",
  retryAfter: "retry-after",
  rateLimit: "ratelimit",
  rateLimitPolicy: "ratelimit-policy",
} as const);
export type HeaderName = (typeof HEADERS)[keyof typeof HEADERS];

/**
 * The `Idempotency-Key` request header: 16–128 characters from `[A-Za-z0-9_-]`. `crypto.randomUUID()` fits. Never `:`,
 * which separates the segments of the server's key `idem:<userId>:<key>`. A trading client generates one key per
 * intended action and reuses it on every retry of that action.
 */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, "Expected 16–128 letters, digits, '-' or '_'");
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** A correlation id as the `x-request-id` header carries it and a problem's `requestId` repeats it. */
export const RequestIdSchema = z
  .string()
  .regex(REQUEST_ID_PATTERN, "Expected a request id matching REQUEST_ID_PATTERN");
export type RequestId = z.infer<typeof RequestIdSchema>;
