/**
 * Logging (plan D5): nestjs-pino 5 (pino 10, pino-http 11) is the Nest logger. Fastify's own logger stays off.
 *
 * - Correlation: pino-http runs as middleware (through @fastify/middie, which copies Fastify's validated request id
 *   to the raw request) and binds a child logger carrying only `requestId` (`quietReqLogger`) into AsyncLocalStorage,
 *   so every line logged during a request, by any PinoLogger, carries it.
 * - Access log: one line per request (`request completed`), except health probes; 5xx at warn (the exception filter
 *   logs the cause at error). It also carries `clientRequestId`, a caller's own well-formed `x-request-id`, which links
 *   the server-generated `requestId` to the caller's logs (bootstrap/request-id.ts).
 * - Output: JSON to stdout, or pino-pretty (a devDependency, in a worker thread) with API_LOG_FORMAT=pretty, which
 *   production rejects.
 *
 * nestjs-pino keeps ONE pino-http instance per process, built from the first app's options: a process builds one app
 * (main.ts); the integration harness builds every app of a test file with the same options.
 */
import type { IncomingMessage } from "node:http";

import type { DynamicModule } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { stdTimeFunctions } from "pino";
import type { DestinationStream, LevelWithSilent } from "pino";
import type { Options } from "pino-http";

import { clientRequestId } from "../../bootstrap/request-id";
import type { Env } from "../../config/env.schema";

import { REDACT_CENSOR, REDACT_PATHS } from "./redact-paths";
import { pathWithoutQuery, serializeError, serializeRequest, serializeResponse } from "./serializers";

/** The key every request-scoped log line carries the request id under. */
export const REQUEST_ID_LOG_KEY = "requestId";

/** The key the access-log line carries a caller's own correlation id under. */
export const CLIENT_REQUEST_ID_LOG_KEY = "clientRequestId";

/** The access line's extra fields: the caller's well-formed `x-request-id`, if it sent one. */
export function accessLogProps(req: Pick<IncomingMessage, "headers">): Record<string, string> {
  const id = clientRequestId(req);
  return id === undefined ? {} : { [CLIENT_REQUEST_ID_LOG_KEY]: id };
}

/** Health probes run every few seconds per pod; their access log would drown everything else (D13). */
export function isHealthPath(url: unknown): boolean {
  const path = pathWithoutQuery(url);
  return path !== undefined && (path === "/health" || path.startsWith("/health/"));
}

/** The access log level: 5xx at warn, everything else at info. */
export function accessLogLevel(statusCode: number, error?: Error): LevelWithSilent {
  return error !== undefined || statusCode >= 500 ? "warn" : "info";
}

/** pino-pretty as a transport (a worker thread), resolved from this package: never loaded in production. */
function prettyTransport(): NonNullable<Options["transport"]> {
  return {
    target: require.resolve("pino-pretty"),
    options: { singleLine: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
  };
}

/** The pino-http options for an environment. */
export function pinoHttpOptions(env: Env): Options {
  return {
    level: env.API_LOG_LEVEL,
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    // Our serializers receive the raw objects: pino-http's wrappers would hand them headers and the full URL.
    wrapSerializers: false,
    serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
    customAttributeKeys: { reqId: REQUEST_ID_LOG_KEY },
    quietReqLogger: true,
    // With quietReqLogger, these reach the access line only, never the request-scoped lines.
    customProps: (req) => accessLogProps(req),
    // middie strips the middleware's mount path from req.url; originalUrl is the request target as received.
    autoLogging: { ignore: (req) => isHealthPath((req as { originalUrl?: string }).originalUrl ?? req.url) },
    customLogLevel: (_req, res, error) => accessLogLevel(res.statusCode, error),
    customSuccessMessage: () => "request completed",
    customErrorMessage: () => "request failed",
    // pino-http invents an Error ("failed with status code 500") for 5xx responses; the filter logs the real one.
    customErrorObject: (_req, _res, _error, value: Record<string, unknown>) => ({
      res: value["res"],
      responseTime: value["responseTime"],
    }),
    ...(env.API_LOG_FORMAT === "pretty" ? { transport: prettyTransport() } : {}),
  };
}

/**
 * The logger module for an environment. `destination` replaces stdout (tests capture lines with it); it can't be
 * combined with the pretty transport.
 */
export function loggerModule(env: Env, destination?: DestinationStream): DynamicModule {
  const options = pinoHttpOptions(env);
  if (destination !== undefined && options.transport !== undefined) {
    throw new TypeError("loggerModule: a log destination can't be combined with API_LOG_FORMAT=pretty");
  }
  return LoggerModule.forRoot({ pinoHttp: destination === undefined ? options : [options, destination] });
}
