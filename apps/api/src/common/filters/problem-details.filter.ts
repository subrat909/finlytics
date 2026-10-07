/**
 * The one global exception filter (plan D4): everything thrown anywhere (guards, pipes, handlers, interceptors, the
 * router's not-found handler, Fastify's body parsing and handler timeout) leaves as `application/problem+json`.
 *
 * Registered with `app.useGlobalFilters(app.get(ProblemDetailsFilter))` before `init()`, so Nest also routes the
 * errors from Fastify's error and not-found handlers through it.
 */
import { randomUUID } from "node:crypto";

import { Catch, Injectable } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { HEADERS, PROBLEM_JSON_MEDIA_TYPE, ProblemDetailsSchema, REQUEST_ID_PATTERN } from "@finlytics/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { fallbackProblem, toProblem } from "../problem-json/to-problem";
import type { ProblemLogLevel } from "../problem-json/to-problem";

import { sourceError } from "./fastify-errors";

/** The media type of every problem response, with its charset. */
export const PROBLEM_CONTENT_TYPE = `${PROBLEM_JSON_MEDIA_TYPE}; charset=utf-8`;

/** What sendProblem logs through: a PinoLogger, or anything with the same four methods. */
export type ProblemLogger = Pick<PinoLogger, ProblemLogLevel>;

/** The minimal request and reply surface sendProblem uses (FastifyRequest and FastifyReply provide it). */
type ProblemRequest = Pick<FastifyRequest, "id" | "url">;
type ProblemReply = Pick<FastifyReply, "sent" | "status" | "headers" | "removeHeader" | "send">;

/**
 * Maps `error` to its problem, logs it, validates it against ProblemDetailsSchema (falling back to a minimal INTERNAL
 * problem, with the failing paths logged) and sends it, unless a response was already sent (a handler that finished
 * after its timeout, for example). Never throws.
 */
export function sendProblem(logger: ProblemLogger, request: ProblemRequest, reply: ProblemReply, error: unknown): void {
  const requestId = REQUEST_ID_PATTERN.test(request.id) ? request.id : randomUUID();
  const { problem, headers, log } = toProblem(error, { requestId, url: request.url });
  logger[log.level](log.fields, log.message);

  const parsed = ProblemDetailsSchema.safeParse(problem);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: issue.code })) },
      "problem failed its schema; sending INTERNAL",
    );
  }
  if (reply.sent) {
    logger.debug({ code: problem.code }, "response already sent; problem dropped");
    return;
  }
  const body = parsed.success ? parsed.data : fallbackProblem(requestId);
  reply.removeHeader("content-length");
  reply
    .status(body.status)
    .headers({
      "content-type": PROBLEM_CONTENT_TYPE,
      "cache-control": "no-store",
      [HEADERS.requestId]: requestId,
      ...(parsed.success ? headers : {}),
    })
    .send(body);
}

@Catch()
@Injectable()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    try {
      sendProblem(this.logger, request, reply, sourceError(request, exception));
    } catch (error: unknown) {
      // Last resort: never let a failure here fall back to Nest's own (non-problem) error body.
      this.logger.error({ err: error }, "exception filter failed");
      if (!reply.sent) {
        reply
          .status(500)
          .headers({ "content-type": PROBLEM_CONTENT_TYPE, "cache-control": "no-store" })
          .send(fallbackProblem(REQUEST_ID_PATTERN.test(request.id) ? request.id : randomUUID()));
      }
    }
  }
}
