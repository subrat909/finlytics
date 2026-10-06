/**
 * Fastify server options (plan D11), shared by main.ts and the tests so both run the production configuration.
 *
 * | Control | Setting |
 * |---|---|
 * | Body | 1 MiB `bodyLimit`; JSON-only parsers (http-hardening.ts) |
 * | Timeouts | a 15 s deadline over the whole lifecycle (request-deadline.ts, not Fastify's `handlerTimeout`, which never fires once a body has been read); `requestTimeout` 15 s to receive the request; `keepAliveTimeout` 72 s |
 * | Proxy | `trustProxy` from API_TRUST_PROXY: false or the proxies' IPs/CIDRs, never `true` or a hop count |
 * | Request id | `requestIdHeader: false`; `genReqId` keeps a well-formed inbound `x-request-id`, else a UUID |
 * | Router | `maxParamLength` 512, case-sensitive, no trailing-slash or duplicate-slash folding |
 * | JSON safety | `__proto__` and `constructor.prototype` in a body are errors |
 * | Logging | Fastify's own logger is off; nestjs-pino logs (common/logger) |
 * | Closing | idle keep-alive sockets are closed; a request that still arrives gets a 503 problem with `Connection: close` (http-hardening.ts; Fastify's `return503OnClosing` is off, its body isn't a problem) |
 * | Bad URLs | a malformed URL is a VALIDATION problem (Fastify's default body echoes the URL) |
 */
import type { FastifyServerOptions } from "fastify";

import { HTTP_LIMITS } from "../config/env.schema";
import type { Env } from "../config/env.schema";
import { sendProblem } from "../common/filters/problem-details.filter";
import type { ProblemLogger } from "../common/filters/problem-details.filter";

import { genReqId } from "./request-id";

export interface FastifyOptionsOverrides {
  /** Test-only: a shorter request deadline (request-deadline.ts), to prove the 503 without waiting 15 s. */
  readonly handlerTimeoutMs?: number;
}

/** URL-encoded instrument keys are at most 128 characters before encoding. */
const MAX_PARAM_LENGTH = 512;

/** Problems sent outside Nest (malformed URLs) aren't logged: there is no request logger yet, and it's client noise. */
const silentLogger: ProblemLogger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

/** The request deadline in milliseconds: 15 s, or a test's shorter override. */
export function requestDeadlineMs(overrides: FastifyOptionsOverrides = {}): number {
  return overrides.handlerTimeoutMs ?? HTTP_LIMITS.handlerTimeoutMs;
}

export function fastifyOptions(env: Env): FastifyServerOptions {
  return {
    bodyLimit: HTTP_LIMITS.bodyLimitBytes,
    // No `handlerTimeout`: request-deadline.ts enforces the 15 s budget (see there for why).
    requestTimeout: HTTP_LIMITS.requestTimeoutMs,
    keepAliveTimeout: HTTP_LIMITS.keepAliveTimeoutMs,
    trustProxy: env.API_TRUST_PROXY === false ? false : [...env.API_TRUST_PROXY],
    requestIdHeader: false,
    genReqId,
    routerOptions: {
      maxParamLength: MAX_PARAM_LENGTH,
      caseSensitive: true,
      ignoreTrailingSlash: false,
      ignoreDuplicateSlashes: false,
    },
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error",
    logger: false,
    return503OnClosing: false,
    forceCloseConnections: "idle",
    frameworkErrors: (error, request, reply) => {
      sendProblem(silentLogger, request, reply, error);
    },
  };
}
