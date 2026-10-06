import { ProblemDetailsSchema } from "@finlytics/shared";
import type { ArgumentsHost } from "@nestjs/common";
import { HttpException, NotFoundException } from "@nestjs/common";
import { errorCodes } from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "../../problem-json/domain-errors";
import { rememberFastifyError, sourceError } from "../fastify-errors";
import { PROBLEM_CONTENT_TYPE, ProblemDetailsFilter, sendProblem } from "../problem-details.filter";

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
}

function fakeReply(sent = false) {
  const reply = {
    sent,
    statusCode: 0,
    sentHeaders: {} as Record<string, string>,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      reply.statusCode = code;
      return reply;
    }),
    headers: vi.fn((values: Record<string, string>) => {
      Object.assign(reply.sentHeaders, values);
      return reply;
    }),
    removeHeader: vi.fn(() => reply),
    send: vi.fn((body: unknown) => {
      reply.body = body;
      return reply;
    }),
  };
  return reply;
}

const request = (url = "/v1/me?code=abc", id = "req-12345678") => ({ id, url }) as FastifyRequest;

describe("sendProblem", () => {
  it("sends the problem as application/problem+json with no-store, x-request-id and Retry-After", () => {
    const logger = fakeLogger();
    const reply = fakeReply();

    sendProblem(
      logger,
      request(),
      reply as unknown as FastifyReply,
      new errorCodes.FST_ERR_HANDLER_TIMEOUT(15_000, "/v1/me"),
    );

    expect(reply.statusCode).toBe(503);
    expect(reply.sentHeaders).toEqual({
      "content-type": PROBLEM_CONTENT_TYPE,
      "cache-control": "no-store",
      "x-request-id": "req-12345678",
      "retry-after": "5",
    });
    expect(ProblemDetailsSchema.parse(reply.body)).toMatchObject({ code: "SERVICE_UNAVAILABLE", instance: "/v1/me" });
    expect(logger.warn).toHaveBeenCalledWith({ code: "SERVICE_UNAVAILABLE" }, "FST_ERR_HANDLER_TIMEOUT");
    expect(reply.removeHeader).toHaveBeenCalledWith("content-length");
  });

  it("replaces a request id that doesn't match the pattern", () => {
    const reply = fakeReply();

    sendProblem(
      fakeLogger(),
      request("/v1/me", "bad id"),
      reply as unknown as FastifyReply,
      new UnauthenticatedError(),
    );

    const problem = ProblemDetailsSchema.parse(reply.body);
    expect(problem.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reply.sentHeaders["x-request-id"]).toBe(problem.requestId);
  });

  it("logs but sends nothing when the response was already sent", () => {
    const logger = fakeLogger();
    const reply = fakeReply(true);

    sendProblem(logger, request(), reply as unknown as FastifyReply, new Error("late"));

    expect(reply.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith({ code: "INTERNAL" }, "response already sent; problem dropped");
  });
});

describe("ProblemDetailsFilter", () => {
  const host = (req: FastifyRequest, reply: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => reply }) }) as unknown as ArgumentsHost;

  it("maps anything thrown to a problem through the request's logger", () => {
    const logger = fakeLogger();
    const filter = new ProblemDetailsFilter(logger as unknown as PinoLogger);
    const reply = fakeReply();

    filter.catch(new NotFoundException("Cannot GET /v1/x?token=abc"), host(request("/v1/x?token=abc"), reply));

    expect(logger.setContext).toHaveBeenCalledWith("ProblemDetailsFilter");
    expect(reply.statusCode).toBe(404);
    expect(JSON.stringify(reply.body)).not.toContain("token");
  });

  it("recovers the Fastify error behind Nest's HttpException rewrap", () => {
    const req = request("/v1/__test__/echo");
    const original = new errorCodes.FST_ERR_CTP_INVALID_JSON_BODY();
    rememberFastifyError(req, original);
    const rewrapped = new HttpException(original.message, 400);
    const reply = fakeReply();

    new ProblemDetailsFilter(fakeLogger() as unknown as PinoLogger).catch(rewrapped, host(req, reply));

    expect(ProblemDetailsSchema.parse(reply.body)).toMatchObject({
      code: "VALIDATION",
      detail: "The request body is not valid JSON.",
    });
    // A different exception for the same request (another status) is mapped as itself.
    expect(sourceError(req, new HttpException("x", 401))).toBeInstanceOf(HttpException);
    expect(sourceError(request(), rewrapped)).toBe(rewrapped);
  });

  it("falls back to a raw INTERNAL problem when mapping itself fails", () => {
    const logger = fakeLogger();
    const reply = fakeReply();
    const brokenLogger = {
      ...logger,
      info: vi.fn(() => {
        throw new Error("logger down");
      }),
    };

    new ProblemDetailsFilter(brokenLogger as unknown as PinoLogger).catch(
      new UnauthenticatedError(),
      host(request(), reply),
    );

    expect(reply.statusCode).toBe(500);
    expect(ProblemDetailsSchema.parse(reply.body).code).toBe("INTERNAL");
    expect(brokenLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) as unknown }),
      "exception filter failed",
    );
  });
});
