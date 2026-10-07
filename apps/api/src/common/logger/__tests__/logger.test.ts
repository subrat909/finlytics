import { Prisma } from "@finlytics/database";
import { HttpException, NotFoundException } from "@nestjs/common";
import { pino } from "pino";
import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadEnv } from "../../../config/env";
import { accessLogLevel, accessLogProps, isHealthPath, loggerModule, pinoHttpOptions } from "../logger.module";
import { REDACT_PATHS } from "../redact-paths";
import { pathWithoutQuery, serializeError, serializeRequest, serializeResponse } from "../serializers";

const REQUIRED = { DATABASE_URL: "postgresql://u:p@localhost:5433/db", REDIS_URL: "redis://localhost:6380" };
const env = loadEnv({ ...REQUIRED, NODE_ENV: "test", API_LOG_LEVEL: "debug" });

/** A pino logger with the api's options (level, redaction, serializers), writing JSON lines to memory. */
function captureLogger() {
  const lines: string[] = [];
  const stream: DestinationStream = { write: (line: string) => void lines.push(line) };
  const { level, redact, serializers, formatters } = pinoHttpOptions(env);
  const logger = pino({ level, redact, serializers, formatters } as pino.LoggerOptions, stream);
  return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe("log redaction", () => {
  it("never logs authorization, cookie or set-cookie", () => {
    const { logger, lines } = captureLogger();

    logger.info({
      req: { headers: { authorization: "Bearer t0ken", cookie: "authjs.session-token=s3ss10n" } },
      res: { headers: { "set-cookie": "a=b" } },
      headers: { "set-cookie": "e=f" },
      err: { headers: { authorization: "Bearer t1ken", cookie: "c=d", "set-cookie": "g=h" } },
      authorization: "Basic xyz",
      cookie: "i=j",
    });

    expect(lines.join("")).not.toMatch(/t0ken|t1ken|s3ss10n|a=b|c=d|e=f|g=h|i=j|Basic xyz/);
  });

  it("redacts token, secret, password and email fields at the top level and inside logged errors", () => {
    const { logger, parsed } = captureLogger();

    logger.info({
      token: "t0",
      email: "a@b.c",
      err: {
        type: "Error",
        password: "p1",
        config: { accessToken: "t2", ok: "kept" },
        cause: { type: "Error", clientSecret: "cs", refresh_token: "rt" },
        credentials: { apiKey: "k" },
      },
      policy: "public",
    });

    expect(parsed()[0]).toMatchObject({
      token: "[REDACTED]",
      email: "[REDACTED]",
      err: {
        password: "[REDACTED]",
        config: { accessToken: "[REDACTED]", ok: "kept" },
        cause: { clientSecret: "[REDACTED]", refresh_token: "[REDACTED]" },
        credentials: "[REDACTED]",
      },
      policy: "public",
    });
  });

  it("scopes wildcards to the keys log lines use, never the root", () => {
    expect(REDACT_PATHS).toEqual(expect.arrayContaining(["password", "err.password", "err.*.password"]));
    expect(REDACT_PATHS.filter((path) => path.startsWith("*"))).toEqual([]);
    expect(REDACT_PATHS.filter((path) => path.includes("*")).every((path) => path.startsWith("err."))).toBe(true);
  });
});

describe("serializers", () => {
  it("logs the request path without its query string", () => {
    const raw = {
      id: "req-12345678",
      method: "GET",
      url: "/",
      originalUrl: "/v1/callback?code=oauth-c0de&state=x",
      ip: "203.0.113.7",
      headers: { cookie: "s=1", authorization: "Bearer x" },
    };

    expect(serializeRequest(raw)).toEqual({
      id: "req-12345678",
      method: "GET",
      path: "/v1/callback",
      ip: "203.0.113.7",
    });
    expect(serializeRequest({ url: "/a#frag", socket: { remoteAddress: "10.0.0.1" } })).toMatchObject({
      path: "/a",
      ip: "10.0.0.1",
    });
    expect(pathWithoutQuery(`/${"a".repeat(600)}`)).toHaveLength(513);
    expect(pathWithoutQuery(42)).toBeUndefined();
    expect(serializeRequest("not a request")).toBe("not a request");
    expect(serializeResponse({ statusCode: 201, getHeaders: () => ({ "set-cookie": "x" }) })).toEqual({
      statusCode: 201,
    });
    expect(serializeResponse(undefined)).toBeUndefined();
  });

  it("logs Prisma errors as type and code only", () => {
    const known = new Prisma.PrismaClientKnownRequestError("SELECT * FROM \"User\" WHERE email = 'a@b.c'", {
      code: "P2002",
      clientVersion: "7.10.0",
      meta: { target: ["email"] },
    });
    const validation = new Prisma.PrismaClientValidationError("Argument email: a@b.c", { clientVersion: "7.10.0" });

    expect(serializeError(known)).toEqual({ type: "PrismaClientKnownRequestError", code: "P2002" });
    expect(serializeError(validation)).toEqual({ type: "PrismaClientValidationError" });
    // Also when wrapped as the cause of another error: pino's own serializer would fold the cause's message in.
    const wrapped = serializeError(new Error("lookup failed", { cause: validation })) as Record<string, unknown>;
    expect(wrapped["cause"]).toEqual({ type: "PrismaClientValidationError" });
    expect(JSON.stringify(wrapped)).not.toContain("a@b.c");
  });

  it("drops ioredis command arguments from logged errors", () => {
    const error = Object.assign(new Error("Command timed out"), {
      command: { name: "set", args: ["idem:user:key", '{"secret":true}'] },
    });

    expect(serializeError(error)).toMatchObject({
      type: "Error",
      message: "Command timed out",
      command: { name: "set" },
    });
    expect(JSON.stringify(serializeError(error))).not.toContain("idem:user:key");
  });

  it("keeps Nest exceptions and Zod errors to their status and issue paths", () => {
    expect(serializeError(new NotFoundException("Cannot GET /v1/x?token=abc"))).toEqual({
      type: "NotFoundException",
      status: 404,
    });
    expect(serializeError(new HttpException({ message: "secret" }, 400))).toEqual({
      type: "HttpException",
      status: 400,
    });
    const result = z.strictObject({ a: z.string() }).safeParse({ a: 1, "evil\nkey": 2 });
    expect(serializeError(result.error)).toEqual({
      type: "ZodError",
      issues: [
        { code: "invalid_type", path: "a" },
        { code: "unrecognized_keys", path: "" },
      ],
    });
  });

  it("serializes other errors in pino's shape, with nested and aggregate errors, to a bounded depth", () => {
    const inner = Object.assign(new Error("inner"), { code: "E_INNER" });
    const error = Object.assign(
      new Error("outer", {
        cause: new Error("c1", { cause: new Error("c2", { cause: new Error("c3", { cause: new Error("c4") }) }) }),
      }),
      {
        detail: inner,
        count: 3,
      },
    );
    const serialized = serializeError(error) as Record<string, unknown>;

    expect(serialized).toMatchObject({
      type: "Error",
      message: "outer",
      count: 3,
      detail: { type: "Error", message: "inner", code: "E_INNER" },
    });
    expect(JSON.stringify(serialized)).toContain('"c3"');
    expect(JSON.stringify(serialized)).not.toContain('"c4"');
    expect(serializeError(new AggregateError([new Error("a")], "many"))).toMatchObject({
      type: "AggregateError",
      aggregateErrors: [{ message: "a" }],
    });
    expect(serializeError("plain string")).toBe("plain string");
  });
});

describe("logger options", () => {
  it("skips health probes in the access log and logs 5xx at warn", () => {
    expect(isHealthPath("/health/live")).toBe(true);
    expect(isHealthPath("/health/ready?x=1")).toBe(true);
    expect(isHealthPath("/healthz")).toBe(false);
    expect(isHealthPath("/v1/me")).toBe(false);
    expect(accessLogLevel(200)).toBe("info");
    expect(accessLogLevel(404)).toBe("info");
    expect(accessLogLevel(503)).toBe("warn");
    expect(accessLogLevel(200, new Error("aborted"))).toBe("warn");
  });

  it("binds the request id as requestId and loads pino-pretty only for the pretty format", () => {
    const json = pinoHttpOptions(env);
    expect(json).toMatchObject({
      level: "debug",
      quietReqLogger: true,
      wrapSerializers: false,
      customAttributeKeys: { reqId: "requestId" },
    });
    expect(json.transport).toBeUndefined();
    expect(json.customProps).toEqual(expect.any(Function));

    const pretty = pinoHttpOptions(loadEnv({ ...REQUIRED, NODE_ENV: "development" }));
    expect(pretty.transport).toMatchObject({ target: expect.stringMatching(/pino-pretty/) as string });
    expect(() => loggerModule(loadEnv({ ...REQUIRED, NODE_ENV: "development" }), { write: () => undefined })).toThrow(
      /can't be combined/,
    );
  });

  it("adds a caller's well-formed x-request-id to the access line as clientRequestId", () => {
    expect(accessLogProps({ headers: { "x-request-id": "web-req-00000001" } })).toEqual({
      clientRequestId: "web-req-00000001",
    });
    expect(accessLogProps({ headers: { "x-request-id": "bad id\nwith newline" } })).toEqual({});
    expect(accessLogProps({ headers: {} })).toEqual({});
  });

  it("drops pino-http's invented error from the access log of a 5xx", () => {
    const { customErrorObject, customSuccessMessage, customErrorMessage } = pinoHttpOptions(env);
    const value = { res: { statusCode: 500 }, err: new Error("failed with status code 500"), responseTime: 3 };

    expect(customErrorObject?.({} as never, {} as never, value.err, value)).toEqual({
      res: { statusCode: 500 },
      responseTime: 3,
    });
    expect(customSuccessMessage?.({} as never, {} as never, 1)).toBe("request completed");
    expect(customErrorMessage?.({} as never, {} as never, value.err)).toBe("request failed");
  });
});
