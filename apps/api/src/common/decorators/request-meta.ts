/**
 * `@RequestMeta()`: what an audit row records about the request (AuditLog.requestId, ip, userAgent), bounded and on
 * one line.
 *
 * - `requestId`: Fastify's `request.id`, which the api always generates itself (bootstrap/request-id.ts), never a
 *   client's `x-request-id`: an audit row's id can't be chosen, reused or forged by the caller. It equals the response's
 *   `x-request-id` and the request's log lines' `requestId`; a caller's own id is in the access log as
 *   `clientRequestId`.
 * - `ip`: Fastify's `request.ip`, which honours `trustProxy` only for the configured proxies; null when it isn't an IP
 *   address (only possible behind a misconfigured proxy), so the column never holds arbitrary text.
 * - `userAgent`: single line, at most 512 characters.
 */
import { isIP } from "node:net";

import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { singleLine } from "../problem-json/text";

/** The longest User-Agent kept. */
const MAX_USER_AGENT = 512;

export interface RequestMetadata {
  /** The server-generated request id. */
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | undefined;
}

/** The metadata of a request. */
export function requestMetadata(request: Pick<FastifyRequest, "id" | "ip" | "headers">): RequestMetadata {
  const userAgent = request.headers["user-agent"];
  return {
    requestId: request.id,
    ip: isIP(request.ip) !== 0 ? request.ip : null,
    userAgent: typeof userAgent === "string" ? singleLine(userAgent, MAX_USER_AGENT) : undefined,
  };
}

export const RequestMeta = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  requestMetadata(context.switchToHttp().getRequest<FastifyRequest>()),
);
