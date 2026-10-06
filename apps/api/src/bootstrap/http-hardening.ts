/**
 * HTTP hardening on the Fastify instance (plan D4, D5, D10, D11; security.md "API hardening"), applied before
 * `init()` so every route registered afterwards inherits it.
 *
 * - JSON-only bodies: Nest's parsers are off (`bodyParser: false`) and Fastify's text/plain parser is removed, so only
 *   Fastify's own application/json parser remains. Anything else is 415; a cross-origin write always needs a CORS
 *   preflight.
 * - `x-request-id` on every response; `Cache-Control: no-store` on every response that doesn't set its own.
 * - While draining, `Connection: close` on every response: Fastify closes the sockets that are idle when it starts
 *   closing, but a socket whose request was still in flight would otherwise stay open on keep-alive (72 s) and hold
 *   up `server.close()`.
 * - Once the server is closing (Fastify's `preClose`, after the drain), a request that still arrives on an open
 *   keep-alive connection, or pipelined behind one in flight, is refused first thing: 503 SERVICE_UNAVAILABLE as
 *   problem+json with `Retry-After: 1` and `Connection: close`, so the client retries on a new connection, which the
 *   load balancer sends to another pod. Fastify's own `return503OnClosing` is off: its body isn't a problem.
 * - Fastify's original errors are remembered for the exception filter (common/filters/fastify-errors.ts).
 * - The BigInt-safe reply serializer.
 * - @fastify/helmet: a strict CSP for a JSON API, no-referrer, CORP same-site, HSTS in production only.
 * - @fastify/cookie, to read the session cookie (the api never sets cookies).
 * - CORS: an exact allowlist from API_ALLOWED_ORIGINS with credentials; never `*`.
 */
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import type { FastifyHelmetOptions } from "@fastify/helmet";
import { HEADERS } from "@finlytics/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PinoLogger } from "nestjs-pino";

import { rememberFastifyError } from "../common/filters/fastify-errors";
import { sendProblem } from "../common/filters/problem-details.filter";
import { ServiceUnavailableError } from "../common/problem-json/domain-errors";
import type { Env } from "../config/env.schema";
import { ReadinessState } from "../infra/lifecycle/readiness.state";

import { serializeReply } from "./reply-serializer";
import { registerRequestDeadline } from "./request-deadline";

/** One year, with subdomains: production serves only https (plan D11). Preload is a 6.4 decision. */
const HSTS_MAX_AGE_SEC = 31_536_000;

/** How long browsers may cache a CORS preflight. */
const CORS_MAX_AGE_SEC = 600;

/** The problem a request gets once the server is closing. Expected during every rollout, so logged at info. */
export function closingProblem(): ServiceUnavailableError {
  return new ServiceUnavailableError("The server is shutting down. Retry the request.", {
    retryAfterSec: 1,
    logLevel: "info",
  });
}

/** Headers for a JSON API: nothing may load, frame, or be framed. `/docs` relaxes the CSP for itself (./openapi.ts). */
export function helmetOptions(env: Env): FastifyHelmetOptions {
  return {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity:
      env.NODE_ENV === "production" ? { maxAge: HSTS_MAX_AGE_SEC, includeSubDomains: true, preload: false } : false,
    xFrameOptions: { action: "deny" },
  };
}

/** The CORS allowlist (plan D11). */
export function corsOptions(env: Env) {
  return {
    origin: [...env.API_ALLOWED_ORIGINS],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", HEADERS.idempotencyKey, HEADERS.requestId],
    exposedHeaders: [
      HEADERS.requestId,
      HEADERS.retryAfter,
      HEADERS.rateLimit,
      HEADERS.rateLimitPolicy,
      HEADERS.idempotentReplayed,
    ],
    maxAge: CORS_MAX_AGE_SEC,
  };
}

export async function applyHttpHardening(app: NestFastifyApplication, env: Env, deadlineMs: number): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  const readiness = app.get(ReadinessState);
  const shutdownLogger = await app.resolve(PinoLogger);
  shutdownLogger.setContext("Shutdown");

  fastify.removeContentTypeParser("text/plain");
  fastify.setReplySerializer(serializeReply);
  fastify.decorateRequest("identity", null);

  fastify.addHook("preClose", (done) => {
    readiness.startClosing();
    done();
  });
  fastify.addHook("onRequest", (request, reply, done) => {
    reply.header(HEADERS.requestId, request.id);
    if (!readiness.isClosing) {
      done();
      return;
    }
    // Answered here, without `done()`: no deadline, guards or handler for a request the pod won't serve.
    reply.header("connection", "close");
    sendProblem(shutdownLogger, request, reply, closingProblem());
  });
  registerRequestDeadline(fastify, deadlineMs);
  fastify.addHook("onError", (request, _reply, error, done) => {
    rememberFastifyError(request, error);
    done();
  });
  fastify.addHook("onSend", (_request, reply, payload, done) => {
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    if (readiness.isDraining) reply.header("connection", "close");
    done(null, payload);
  });

  await app.register(fastifyHelmet, helmetOptions(env));
  await app.register(fastifyCookie);
  app.enableCors(corsOptions(env));
}
