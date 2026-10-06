/**
 * Request ids (plan D5, D11; docs/04 §7). The api generates every request id itself: a UUID, as Fastify's `request.id`.
 * It is echoed in the `x-request-id` response header, repeated as `requestId` in every problem, bound to every log line
 * of the request and written to `AuditLog.requestId`, so it is unique and no client can choose it (a chosen id could
 * collide with, or impersonate, another request's audit rows and logs).
 *
 * An inbound `x-request-id` (a caller's own correlation id, e.g. the web app's) is never adopted. When it matches
 * REQUEST_ID_PATTERN it is logged as `clientRequestId` on the request's access-log line, which links the two; anything
 * else is dropped, so a header can't inject text into the logs.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { HEADERS, REQUEST_ID_PATTERN } from "@finlytics/shared";

/** The client's correlation id from an inbound `x-request-id` header value, or undefined (absent, repeated, malformed). */
export function clientRequestIdFrom(header: string | readonly string[] | undefined): string | undefined {
  return typeof header === "string" && REQUEST_ID_PATTERN.test(header) ? header : undefined;
}

/** The client's correlation id of a raw request, or undefined. */
export function clientRequestId(raw: Pick<IncomingMessage, "headers">): string | undefined {
  return clientRequestIdFrom(raw.headers[HEADERS.requestId]);
}

/** Fastify's `genReqId`, called for every request (`requestIdHeader: false`): always a server-generated UUID. */
export function genReqId(): string {
  return randomUUID();
}
