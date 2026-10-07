/**
 * Structural recognition of the errors the api's dependencies throw (plan D4, D14): by `name` and `code`, never with
 * `instanceof`. The api, @finlytics/database's two builds and test code can each hold their own copy of a class, and
 * Nest wraps some errors on the way. Shared by toProblem() and the log serializers.
 */

/** A non-null object, for reading properties off an unknown value. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** An Error, or anything shaped like one (a `message` string), from any realm or package copy. */
export interface ErrorLike {
  readonly name?: unknown;
  readonly message: string;
  readonly stack?: unknown;
  readonly [key: string]: unknown;
}

export function isErrorLike(value: unknown): value is ErrorLike {
  return isRecord(value) && typeof value["message"] === "string";
}

/** `value[key]` when `value` is an object, else undefined. */
export function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  const found = property(value, key);
  return typeof found === "string" ? found : undefined;
}

// ── Prisma ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Prisma error classes, by name. Their messages can contain query arguments, so they are never logged. */
const PRISMA_ERROR_NAMES: ReadonlySet<string> = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
]);

const PRISMA_CODE = /^P\d{4}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** What may be said about a Prisma error: its class name, its code, the PostgreSQL SQLSTATE and the model. */
export interface PrismaErrorInfo {
  readonly name: string;
  /** `P2002` etc. (`errorCode` on initialization errors). */
  readonly code: string | undefined;
  /** The PostgreSQL SQLSTATE behind a driver-adapter error, e.g. `57014` for a statement timeout. */
  readonly sqlState: string | undefined;
  /** `meta.modelName`, when Prisma reports it. */
  readonly model: string | undefined;
}

/** The facts of a Prisma error, or `undefined` when `error` isn't one. */
export function prismaErrorInfo(error: unknown): PrismaErrorInfo | undefined {
  const name = stringProperty(error, "name");
  if (name === undefined || !PRISMA_ERROR_NAMES.has(name)) return undefined;
  const code = stringProperty(error, "code") ?? stringProperty(error, "errorCode");
  const meta = property(error, "meta");
  // @prisma/adapter-pg puts the PostgreSQL error in meta.driverAdapterError.cause.originalCode.
  const sqlState = stringProperty(property(property(meta, "driverAdapterError"), "cause"), "originalCode");
  const model = stringProperty(meta, "modelName");
  return {
    name,
    code: code !== undefined && PRISMA_CODE.test(code) ? code : undefined,
    sqlState: sqlState !== undefined && SQLSTATE.test(sqlState) ? sqlState : undefined,
    model: model !== undefined && /^[A-Za-z]\w{0,63}$/.test(model) ? model : undefined,
  };
}

/**
 * Plain `Error`s from `pg` that mean "the database is unavailable" (verified on PostgreSQL 16.15 and Prisma 7.10): a
 * pool acquire timeout (DB_CONNECT_TIMEOUT_MS), and a session the server killed (idle_in_transaction_session_timeout).
 */
const PG_UNAVAILABLE_MESSAGES: ReadonlySet<string> = new Set([
  "timeout exceeded when trying to connect",
  "Client has encountered a connection error and is not queryable",
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
]);

export function isPgUnavailableError(error: unknown): boolean {
  return isErrorLike(error) && PG_UNAVAILABLE_MESSAGES.has(error.message);
}

// ── Fastify ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The `FST_ERR_*` code of a Fastify error, or `undefined`. */
export function fastifyErrorCode(error: unknown): string | undefined {
  const code = stringProperty(error, "code");
  return stringProperty(error, "name") === "FastifyError" && code?.startsWith("FST_") === true ? code : undefined;
}

// ── Nest ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A Nest HttpException (any subclass): `getStatus()` and `getResponse()`. Its message and response may echo the request
 * (the router's NotFoundException says "Cannot GET <url>", query string included), so neither is ever sent or logged.
 */
export interface HttpExceptionLike {
  getStatus(): number;
  getResponse(): unknown;
}

export function isHttpException(error: unknown): error is HttpExceptionLike {
  return isRecord(error) && typeof error["getStatus"] === "function" && typeof error["getResponse"] === "function";
}

/** A Zod error's issues, by shape (`name === "ZodError"`): the shared package's zod may be another module instance. */
export interface ZodIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[];
}

export function zodIssues(error: unknown): readonly ZodIssueLike[] | undefined {
  if (stringProperty(error, "name") !== "ZodError") return undefined;
  const issues = property(error, "issues");
  if (!Array.isArray(issues)) return undefined;
  return issues.filter(
    (issue): issue is ZodIssueLike =>
      isRecord(issue) &&
      typeof issue["code"] === "string" &&
      Array.isArray(issue["path"]) &&
      typeof issue["message"] === "string",
  );
}

/**
 * The Zod error behind a nestjs-zod `ZodValidationException` or `ZodSerializationException` (`getZodError()`), with
 * the HTTP status of the wrapper: 400 for request validation, 500 for a response that failed its schema.
 */
export function nestjsZodError(error: unknown): { status: number; issues: readonly ZodIssueLike[] } | undefined {
  if (!isHttpException(error) || !isRecord(error) || typeof error["getZodError"] !== "function") return undefined;
  const zodError: unknown = (error["getZodError"] as () => unknown).call(error);
  return { status: error.getStatus(), issues: zodIssues(zodError) ?? [] };
}

// ── ioredis ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ioredis errors that mean "Redis is unavailable": no offline queue while disconnected, a command timeout, a closed
 * connection, retries exhausted, and server replies that say the server can't serve right now.
 */
const REDIS_UNAVAILABLE_MESSAGES: ReadonlySet<string> = new Set([
  "Stream isn't writeable and enableOfflineQueue options is false",
  "Command timed out",
  "Connection is closed.",
]);
const REDIS_UNAVAILABLE_REPLY = /^(?:LOADING|READONLY|MASTERDOWN|BUSY|CLUSTERDOWN|TRYAGAIN|NOAUTH|WRONGPASS)\b/;

export function isRedisUnavailableError(error: unknown): boolean {
  if (!isErrorLike(error)) return false;
  const name = stringProperty(error, "name");
  if (name === "MaxRetriesPerRequestError") return true;
  if (name === "ReplyError") return REDIS_UNAVAILABLE_REPLY.test(error.message);
  return REDIS_UNAVAILABLE_MESSAGES.has(error.message);
}

// ── Node ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Socket error codes: a dependency (database, Redis) can't be reached. */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

export function isNetworkError(error: unknown): boolean {
  const code = stringProperty(error, "code");
  return isErrorLike(error) && code !== undefined && NETWORK_ERROR_CODES.has(code);
}
