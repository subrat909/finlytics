import { Prisma } from "@finlytics/database";
import { ERROR_HTTP_STATUS, ERROR_TITLES, ProblemDetailsSchema, problemTypeUrl } from "@finlytics/shared";
import type { ErrorCode } from "@finlytics/shared";
import { BadRequestException, ConflictException, HttpException, NotFoundException } from "@nestjs/common";
import { errorCodes } from "fastify";
import { ZodSerializationException, ZodValidationException } from "nestjs-zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TenancyViolationError } from "../../../infra/prisma/tenancy.extension";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  IdempotentReplayError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  RequestEndedError,
  ServiceUnavailableError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../domain-errors";
import { buildProblem, fallbackProblem, instanceFor, toProblem } from "../to-problem";

const CONTEXT = Object.freeze({ requestId: "req-12345678", url: "/v1/orders?token=abc#frag" });
const CLIENT_VERSION = "7.10.0";

function knownRequestError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Invalid query: SELECT * FROM "User" WHERE email = 'a@b.c'`, {
    code,
    clientVersion: CLIENT_VERSION,
    ...(meta === undefined ? {} : { meta }),
  });
}

/** A Prisma error whose SQLSTATE comes from the pg driver adapter. */
function driverError(sqlState: string): Prisma.PrismaClientKnownRequestError {
  return knownRequestError("P2010", {
    driverAdapterError: { cause: { originalCode: sqlState, originalMessage: "x" } },
  });
}

function zodError(): z.ZodError {
  const result = z
    .strictObject({ name: z.string().min(2), legs: z.array(z.object({ strike: z.number() })) })
    .safeParse({
      name: "a",
      legs: [{ strike: "x" }],
      "bad\nkey": 1,
    });
  if (result.success) throw new Error("expected a ZodError");
  return result.error;
}

/** Everything a problem says, as text: what a client (or a log scraper) could see. */
const text = (value: unknown): string => JSON.stringify(value);

describe("toProblem", () => {
  it("maps each domain error to its code, status, title and type", () => {
    const errors: [DomainError, ErrorCode][] = [
      [new ValidationError(), "VALIDATION"],
      [new UnauthenticatedError("Sign in to continue."), "UNAUTHENTICATED"],
      [new ForbiddenError(), "FORBIDDEN"],
      [new NotFoundError(), "NOT_FOUND"],
      [new ConflictError("Already exists."), "CONFLICT"],
      [new IdempotentReplayError(), "IDEMPOTENT_REPLAY"],
      [new PayloadTooLargeError(), "PAYLOAD_TOO_LARGE"],
      [new UnsupportedMediaTypeError(), "UNSUPPORTED_MEDIA_TYPE"],
      [new RateLimitedError(12), "RATE_LIMITED"],
      [new InternalError(), "INTERNAL"],
      [new ServiceUnavailableError(), "SERVICE_UNAVAILABLE"],
    ];
    for (const [error, code] of errors) {
      const { problem } = toProblem(error, CONTEXT);

      expect(problem, code).toMatchObject({
        type: problemTypeUrl(code),
        title: ERROR_TITLES[code],
        status: ERROR_HTTP_STATUS[code],
        code,
        requestId: CONTEXT.requestId,
      });
      expect(ProblemDetailsSchema.safeParse(problem).success, code).toBe(true);
    }
  });

  it("uses a domain error's curated detail and retry hint, and logs 5xx with the error, 4xx with the code only", () => {
    const limited = toProblem(new RateLimitedError(12, "Slow down."), CONTEXT);
    expect(limited.problem).toMatchObject({ detail: "Slow down.", retryAfterSec: 12 });
    expect(limited.headers).toEqual({ "retry-after": "12" });
    expect(toProblem(new ConflictError("Taken."), CONTEXT).log).toEqual({
      level: "info",
      message: "CONFLICT",
      fields: { code: "CONFLICT" },
    });

    const cause = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    const unavailable = toProblem(new ServiceUnavailableError("Try again shortly.", { cause }), CONTEXT);
    expect(unavailable.problem).toMatchObject({ code: "SERVICE_UNAVAILABLE", retryAfterSec: 5 });
    expect(unavailable.log.level).toBe("error");
    expect(unavailable.log.fields["err"]).toBeInstanceOf(ServiceUnavailableError);
    expect(text(unavailable.problem)).not.toContain("ECONNREFUSED");
  });

  it("logs RATE_LIMITED at debug, so a flood doesn't flood the logs", () => {
    expect(toProblem(new RateLimitedError(12), CONTEXT).log).toEqual({
      level: "debug",
      message: "RATE_LIMITED",
      fields: { code: "RATE_LIMITED" },
    });
    expect(toProblem(new HttpException("Too Many Requests", 429), CONTEXT).log.level).toBe("debug");
  });

  it("maps a request that ended before its handler to SERVICE_UNAVAILABLE, logged at info", () => {
    const { problem, log } = toProblem(new RequestEndedError("timeout"), CONTEXT);

    expect(problem).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      detail: "The request took too long.",
      retryAfterSec: 5,
    });
    expect(log.level).toBe("info");
    expect(toProblem(new RequestEndedError("client-closed"), CONTEXT).problem.detail).toBe(
      "The client closed the connection.",
    );
  });

  it("maps Zod issues to dot-path field errors, capped at 100", () => {
    const { problem, log } = toProblem(new ZodValidationException(zodError()), CONTEXT);

    expect(problem).toMatchObject({ code: "VALIDATION", status: 400, detail: "The request is invalid." });
    expect(problem.errors).toEqual([
      { path: "name", message: expect.any(String) as string, code: "too_small" },
      { path: "legs.0.strike", message: expect.any(String) as string, code: "invalid_type" },
      { path: "bad�key", message: "Unknown field.", code: "unrecognized_keys" },
    ]);
    expect(log.fields["issues"]).toEqual([
      { path: "name", code: "too_small" },
      { path: "legs.0.strike", code: "invalid_type" },
      { path: "", code: "unrecognized_keys" },
    ]);

    const many = z.array(z.string()).safeParse(Array.from({ length: 150 }, (_, index) => index));
    if (many.success) throw new Error("expected issues");
    const capped = toProblem(new ValidationError(undefined, []), CONTEXT);
    expect(capped.problem).not.toHaveProperty("errors");
    expect(toProblem(new ZodValidationException(many.error), CONTEXT).problem.errors).toHaveLength(100);
  });

  it("keeps a validation problem a 400 when unknown keys carry bidi controls, a BOM or a lone surrogate", () => {
    // The shared schema forbids these in problem text; unstripped, a client's own JSON keys would turn its 400 into
    // a 500 INTERNAL fallback.
    const schema = z.strictObject({ value: z.string() });
    const body: unknown = JSON.parse('{"value":"x","\\u202Eevil":1,"a\\uFEFFb":2,"\\ud800c":3,"\\u2066iso":4}');
    const parsed = schema.safeParse(body);
    if (parsed.success) throw new Error("expected unknown keys to fail");

    const { problem } = toProblem(new ZodValidationException(parsed.error), CONTEXT);

    expect(problem.code).toBe("VALIDATION");
    expect(problem.status).toBe(400);
    expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
  });

  it("maps body-limit, media-type and malformed-JSON errors to 413, 415 and 400", () => {
    const cases: [Error, number, string][] = [
      [new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE(), 413, "The request body exceeds 1 MiB."],
      [new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE(), 415, "Send request bodies as application/json."],
      [new errorCodes.FST_ERR_CTP_INVALID_JSON_BODY(), 400, "The request body is not valid JSON."],
      [new errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY(), 400, "The request body is not valid JSON."],
      [new errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH(), 400, "The request body does not match its Content-Length."],
      [new errorCodes.FST_ERR_BAD_URL("/%"), 400, "The request URL is not valid."],
    ];
    for (const [error, status, detail] of cases) {
      expect(toProblem(error, CONTEXT).problem, detail).toMatchObject({ status, detail });
    }
    // An unknown FST_ code falls back to its status; a 5xx one is INTERNAL.
    expect(toProblem(new errorCodes.FST_ERR_CTP_INVALID_TYPE(), CONTEXT).problem.code).toBe("INTERNAL");
  });

  it("maps a handler timeout to SERVICE_UNAVAILABLE with Retry-After", () => {
    const { problem, headers, log } = toProblem(new errorCodes.FST_ERR_HANDLER_TIMEOUT(15_000, "/v1/me"), CONTEXT);

    expect(problem).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      detail: "The request took too long.",
      retryAfterSec: 5,
    });
    expect(headers).toEqual({ "retry-after": "5" });
    expect(log.level).toBe("warn");
  });

  it("maps unknown routes to NOT_FOUND without echoing the URL", () => {
    const { problem, log } = toProblem(new NotFoundException("Cannot GET /v1/x?token=abc"), CONTEXT);

    expect(problem).toEqual({
      type: problemTypeUrl("NOT_FOUND"),
      title: ERROR_TITLES.NOT_FOUND,
      status: 404,
      code: "NOT_FOUND",
      instance: "/v1/orders",
      requestId: CONTEXT.requestId,
    });
    expect(log.level).toBe("debug");
    expect(text(log)).not.toContain("token=abc");
  });

  it("maps other HttpExceptions by status, never by message", () => {
    const statuses: [number, ErrorCode][] = [
      [400, "VALIDATION"],
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [409, "CONFLICT"],
      [413, "PAYLOAD_TOO_LARGE"],
      [415, "UNSUPPORTED_MEDIA_TYPE"],
      [418, "VALIDATION"],
      [429, "RATE_LIMITED"],
      [501, "INTERNAL"],
      [503, "SERVICE_UNAVAILABLE"],
    ];
    for (const [status, code] of statuses) {
      const { problem } = toProblem(new HttpException(`secret ${String(status)} message`, status), CONTEXT);
      expect(problem.code, String(status)).toBe(code);
      expect(text(problem)).not.toContain("secret");
    }
    expect(toProblem(new BadRequestException({ message: ["secret"] }), CONTEXT).problem).not.toHaveProperty("detail");
    expect(toProblem(new ConflictException(), CONTEXT).problem.code).toBe("CONFLICT");
  });

  it("maps P2002 to CONFLICT and P2025 to NOT_FOUND", () => {
    const duplicate = toProblem(knownRequestError("P2002", { modelName: "User", target: ["email"] }), CONTEXT);
    expect(duplicate.problem).toMatchObject({ code: "CONFLICT", detail: "A record with these values already exists." });
    expect(duplicate.log.fields["prisma"]).toEqual({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      model: "User",
    });

    expect(toProblem(knownRequestError("P2025"), CONTEXT).problem.code).toBe("NOT_FOUND");
    expect(toProblem(knownRequestError("P2003"), CONTEXT).problem).toMatchObject({
      code: "CONFLICT",
      detail: "This record is still referenced.",
    });
    const conflict = toProblem(knownRequestError("P2034"), CONTEXT);
    expect(conflict.problem).toMatchObject({ code: "SERVICE_UNAVAILABLE", retryAfterSec: 1 });
    expect(toProblem(knownRequestError("P2000"), CONTEXT).problem.code).toBe("INTERNAL");
    for (const result of [duplicate, conflict]) expect(text(result)).not.toMatch(/SELECT|a@b\.c/);
  });

  it("maps PrismaClientValidationError to INTERNAL without its message", () => {
    const error = new Prisma.PrismaClientValidationError("Argument `email`: alice@example.com is invalid", {
      clientVersion: CLIENT_VERSION,
    });

    const { problem, log } = toProblem(error, CONTEXT);

    expect(problem.code).toBe("INTERNAL");
    expect(log).toEqual({
      level: "error",
      message: "prisma validation error",
      fields: { code: "INTERNAL", prisma: { name: "PrismaClientValidationError" } },
    });
    expect(text({ problem, log })).not.toContain("alice@example.com");
  });

  it("maps pool timeouts, P1001, statement timeouts and Redis outages to SERVICE_UNAVAILABLE with Retry-After", () => {
    const outages: unknown[] = [
      new Error("timeout exceeded when trying to connect"),
      new Error("Client has encountered a connection error and is not queryable"),
      knownRequestError("P1001"),
      knownRequestError("P2024"),
      knownRequestError("P2028"),
      new Prisma.PrismaClientInitializationError("Can't reach database server at db:5432", CLIENT_VERSION, "P1001"),
      driverError("57014"),
      driverError("53300"),
      driverError("57P01"),
      driverError("08006"),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), { code: "ECONNREFUSED" }),
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      new Error("Command timed out"),
      new Error("Connection is closed."),
      Object.assign(new Error("Reached the max retries per request limit"), { name: "MaxRetriesPerRequestError" }),
      Object.assign(new Error("READONLY You can't write against a read only replica."), { name: "ReplyError" }),
    ];
    for (const error of outages) {
      const { problem, headers } = toProblem(error, CONTEXT);

      expect(problem.code, String(error)).toBe("SERVICE_UNAVAILABLE");
      expect(problem.retryAfterSec).toBe(5);
      expect(headers).toEqual({ "retry-after": "5" });
      expect(text(problem)).not.toMatch(/ECONNREFUSED|db:5432|127\.0\.0\.1/);
    }
  });

  it("logs Redis outages by error name only, never command arguments", () => {
    const error = Object.assign(new Error("Command timed out"), {
      command: { name: "set", args: ["idem:u1:k", "{}"] },
    });

    expect(toProblem(error, CONTEXT).log).toEqual({
      level: "warn",
      message: "redis unavailable",
      fields: { code: "SERVICE_UNAVAILABLE", redisError: "Error" },
    });
    expect(
      toProblem(Object.assign(new Error("ERR unknown command"), { name: "ReplyError" }), CONTEXT).problem.code,
    ).toBe("INTERNAL");
  });

  it("maps a response that failed its schema and a stray ZodError to INTERNAL", () => {
    const serialization = toProblem(new ZodSerializationException(zodError()), CONTEXT);
    expect(serialization.problem.code).toBe("INTERNAL");
    expect(serialization.log.fields["issues"]).toEqual(expect.arrayContaining([{ path: "name", code: "too_small" }]));
    expect(toProblem(zodError(), CONTEXT).problem.code).toBe("INTERNAL");
  });

  it("maps a tenancy violation to INTERNAL and logs the model and operation", () => {
    const { problem, log } = toProblem(new TenancyViolationError("Order", "findMany"), CONTEXT);

    expect(problem.code).toBe("INTERNAL");
    expect(log.fields).toMatchObject({ model: "Order", operation: "findMany" });
  });

  it("maps anything else to INTERNAL without stack or message", () => {
    for (const thrown of [
      new TypeError("x is undefined at /app/src/secret.ts:12"),
      "a string",
      42,
      null,
      undefined,
      {},
    ]) {
      const { problem, log } = toProblem(thrown, CONTEXT);

      expect(problem).toEqual(fallbackProblemWithInstance());
      expect(log.level).toBe("error");
      expect(text(problem)).not.toMatch(/secret|undefined at/);
    }
  });

  it("strips the query string from instance", () => {
    expect(instanceFor("/v1/orders?token=abc")).toBe("/v1/orders");
    expect(instanceFor("/v1/orders#x")).toBe("/v1/orders");
    expect(instanceFor("//evil.example/path")).toBeUndefined();
    expect(instanceFor("/a\\b")).toBeUndefined();
    expect(instanceFor(`/${"a".repeat(600)}`)).toBeUndefined();
    expect(instanceFor(undefined)).toBeUndefined();
  });

  it("bounds what a hand-made domain error carries", () => {
    class Weird extends DomainError {
      readonly code = "RATE_LIMITED";
    }
    const problem = buildProblem("VALIDATION", CONTEXT, {
      detail: `line one\nline two ${"x".repeat(600)}`,
      errors: [{ path: "a\nb", message: "", code: "Not Snake" }],
      retryAfterSec: 1e9,
    });

    expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
    expect(problem.detail).toMatch(/^line one line two x+…$/);
    expect(problem.errors).toEqual([{ path: "a�b", message: "Invalid value." }]);
    expect(problem.retryAfterSec).toBe(86_400);
    expect(toProblem(new Weird(undefined, { retryAfterSec: Number.NaN }), CONTEXT).problem).not.toHaveProperty(
      "retryAfterSec",
    );
    expect(toProblem(new Weird(undefined, { retryAfterSec: 1.2 }), CONTEXT).problem.retryAfterSec).toBe(2);
  });
});

describe("fallbackProblem", () => {
  it("is a minimal INTERNAL problem that always validates", () => {
    expect(ProblemDetailsSchema.parse(fallbackProblem("req-12345678"))).toEqual({
      type: problemTypeUrl("INTERNAL"),
      title: ERROR_TITLES.INTERNAL,
      status: 500,
      code: "INTERNAL",
      requestId: "req-12345678",
    });
  });
});

function fallbackProblemWithInstance() {
  return { ...fallbackProblem(CONTEXT.requestId), instance: "/v1/orders" };
}
