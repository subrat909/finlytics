/**
 * Allowlisting log serializers (plan D5): the main control against secrets in logs. Each emits named fields only;
 * redaction (./redact-paths.ts) is the backup.
 *
 * - `req`: id, method, client IP and the path WITHOUT its query string (an OAuth callback's `?code=` must never be
 *   logged). Never headers or the body.
 * - `res`: the status code. Never headers (set-cookie).
 * - `err`: Prisma errors as `{ type, code }` only (their messages can contain query arguments); Nest HttpExceptions
 *   as `{ type, status }` (their messages echo the request URL); Zod errors as issue codes and paths; ioredis errors
 *   without `command.args`. Anything else in pino's standard shape (type, message, stack, own fields), with each
 *   `cause` serialized by these same rules: pino's own serializer would fold a cause's message into the outer one.
 */
import {
  isErrorLike,
  isHttpException,
  isRecord,
  prismaErrorInfo,
  property,
  zodIssues,
} from "../problem-json/known-errors";

/** Longest path a log line carries; longer ones are cut (a path is client input). */
const MAX_LOGGED_PATH = 512;

/** How deep `cause` chains (and nested errors) are followed. */
const MAX_ERROR_DEPTH = 3;

/** The path of a request target, without query string or fragment, cut to {@link MAX_LOGGED_PATH}. */
export function pathWithoutQuery(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return path.length > MAX_LOGGED_PATH ? `${path.slice(0, MAX_LOGGED_PATH)}…` : path;
}

/**
 * The raw request (IncomingMessage) as pino-http hands it over (`wrapSerializers: false`). @fastify/middie copies
 * Fastify's `id` (the validated request id) and `ip` (the client IP under `trustProxy`) onto it.
 */
export function serializeRequest(req: unknown): unknown {
  if (!isRecord(req)) return req;
  const ip = property(req, "ip") ?? property(property(req, "socket"), "remoteAddress");
  return {
    id: req["id"],
    method: req["method"],
    path: pathWithoutQuery(req["originalUrl"] ?? req["url"]),
    ip,
  };
}

/** The raw response (ServerResponse): its status code only. */
export function serializeResponse(res: unknown): unknown {
  return isRecord(res) ? { statusCode: res["statusCode"] } : res;
}

/** pino's `type`: the constructor's name, else `name`. */
function typeOf(error: Record<string, unknown>): unknown {
  const ctor = property(error, "constructor");
  return typeof ctor === "function" && ctor.name !== "" && ctor.name !== "Object" ? ctor.name : error["name"];
}

function serializeErrorAt(error: unknown, depth: number): unknown {
  if (!isErrorLike(error)) return error;
  if (depth > MAX_ERROR_DEPTH) return { type: typeOf(error) };

  const prisma = prismaErrorInfo(error);
  if (prisma !== undefined)
    return prisma.code === undefined ? { type: prisma.name } : { type: prisma.name, code: prisma.code };

  const issues = zodIssues(error);
  if (issues !== undefined) {
    return { type: "ZodError", issues: issues.map(({ code, path }) => ({ code, path: path.map(String).join(".") })) };
  }

  if (isHttpException(error)) return { type: typeOf(error), status: error.getStatus() };

  const serialized: Record<string, unknown> = { type: typeOf(error), message: error.message, stack: error.stack };
  for (const key of Object.keys(error)) {
    if (key in serialized || key === "cause" || key === "errors") continue;
    const value = error[key];
    if (key === "command") {
      // ioredis attaches { name, args }; the arguments are keys and values.
      serialized[key] = { name: property(value, "name") };
    } else {
      serialized[key] = isErrorLike(value) ? serializeErrorAt(value, depth + 1) : value;
    }
  }
  const errors = error["errors"];
  if (Array.isArray(errors)) serialized["aggregateErrors"] = errors.map((inner) => serializeErrorAt(inner, depth + 1));
  const cause = property(error, "cause");
  if (cause !== undefined) serialized["cause"] = serializeErrorAt(cause, depth + 1);
  return serialized;
}

/** The `err` serializer. */
export function serializeError(error: unknown): unknown {
  return serializeErrorAt(error, 0);
}
