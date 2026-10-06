import { z } from "zod";

/** Default size of the pg pool behind each Prisma client. */
export const DEFAULT_DB_POOL_MAX = 10;

/** Default longest wait for a connection, pooled or new, before a query fails (pg `connectionTimeoutMillis`). */
export const DEFAULT_DB_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Default server-side `statement_timeout`: PostgreSQL cancels a statement that runs longer, and the work stops there.
 * It stays below the 12 s interactive-transaction timeout (createPrismaClient's default and the api's), so PostgreSQL
 * cancels a slow statement before Prisma gives up on its transaction, and so below the api's 15 s request timeout too.
 */
export const DEFAULT_DB_STATEMENT_TIMEOUT_MS = 10_000;

/** The `NODE_ENV` values the apps run under. */
const NODE_ENVS = ["development", "test", "production"] as const;

const NOT_A_DATABASE_URL = "must be a postgres:// or postgresql:// URL";

/**
 * Query parameters a database URL must not carry, with the reason. `pg` merges every URL parameter over the options a
 * pool is created with, so these would silently replace the startup parameters createPrismaClient sends on every
 * connection (its timeouts and application name) or, through `options`, add settings of their own.
 */
const OVERRIDING_URL_PARAMETERS: Readonly<Record<string, string>> = Object.freeze({
  query_timeout:
    "must not set query_timeout: a client-side timeout leaves the query running in PostgreSQL; DB_STATEMENT_TIMEOUT_MS cancels it there",
  statement_timeout: "must not set statement_timeout: use DB_STATEMENT_TIMEOUT_MS",
  idle_in_transaction_session_timeout:
    "must not set idle_in_transaction_session_timeout: createPrismaClient sets it on every connection",
  application_name:
    "must not set application_name: it would replace the name createPrismaClient sets (its applicationName option)",
  options:
    "must not set options: it would add server settings (any -c, e.g. search_path or lock_timeout) to every connection, outside the ones createPrismaClient sets",
});

/**
 * Why `url` can't be a Finlytics database URL, or `undefined` when it can: it must be a `postgres:` or `postgresql:`
 * URL without a parameter that would override the configured startup parameters ({@link OVERRIDING_URL_PARAMETERS}).
 * The reason never contains the URL, which carries a password. Internal: shared by the env schema and
 * createPrismaClient, which pass it the trimmed URL.
 */
export function databaseUrlProblem(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NOT_A_DATABASE_URL;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return NOT_A_DATABASE_URL;
  for (const [name, reason] of Object.entries(OVERRIDING_URL_PARAMETERS)) {
    if (parsed.searchParams.has(name)) return reason;
  }
  return undefined;
}

/** An unset variable and an empty one (`DB_POOL_MAX=` in a .env file) both mean "use the default". */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

/**
 * An integer variable from `min` to `max`, `fallback` when unset or empty. Plain decimal digits only: `Number()` would
 * also read `"1e3"`, `"0x10"` and `" "`.
 */
function integerVariable(min: number, max: number, fallback: number) {
  const reason = `must be an integer from ${String(min)} to ${String(max)}`;
  return z.preprocess(
    emptyToUndefined,
    z
      .string({ error: reason })
      .trim()
      .regex(/^\d+$/, reason)
      .transform(Number)
      .pipe(z.int({ error: reason }).min(min, reason).max(max, reason))
      .default(fallback),
  );
}

/**
 * The variables the database environment reads, as a Zod shape, so the api's env schema can spread it into its own
 * (`z.object({ ...databaseEnvShape, ...apiShape })`) and add {@link checkDatabaseEnv} to its refinement. Messages are
 * reasons only: an issue reads `VARIABLE: reason` ({@link formatEnvIssues}), never with the value.
 *
 * - `NODE_ENV`: `development` (default), `test` or `production`.
 * - `DATABASE_URL`: required; see {@link databaseUrlProblem}.
 * - `DB_POOL_MAX`: 1–100, default 10.
 * - `DB_CONNECT_TIMEOUT_MS`: 100–60 000, default 5000: the longest wait for a pooled or new connection.
 * - `DB_STATEMENT_TIMEOUT_MS`: 100–11 000, default 10 000: the server-side `statement_timeout`. Capped below the 12 s
 *   interactive-transaction timeout, which createPrismaClient requires to be the larger of the two.
 * - `DEBUG`: any value, but empty in production ({@link checkDatabaseEnv}).
 */
export const databaseEnvShape = {
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(NODE_ENVS, { error: "must be development, test or production" }).default("development"),
  ),
  DATABASE_URL: z
    .string({ error: "is required" })
    .trim()
    .min(1, "must not be empty")
    .superRefine((url, ctx) => {
      // An empty URL already has its issue.
      const problem = url === "" ? undefined : databaseUrlProblem(url);
      if (problem !== undefined) ctx.addIssue({ code: "custom", message: problem });
    }),
  DB_POOL_MAX: integerVariable(1, 100, DEFAULT_DB_POOL_MAX),
  DB_CONNECT_TIMEOUT_MS: integerVariable(100, 60_000, DEFAULT_DB_CONNECT_TIMEOUT_MS),
  DB_STATEMENT_TIMEOUT_MS: integerVariable(100, 11_000, DEFAULT_DB_STATEMENT_TIMEOUT_MS),
  DEBUG: z.string().optional(),
};

/** What {@link checkDatabaseEnv} reads: possibly unparsed values, since it also runs when another variable failed. */
export interface DatabaseEnvRuleInput {
  readonly NODE_ENV?: unknown;
  readonly DEBUG?: unknown;
}

/**
 * The rules that span variables (security review F6): `DEBUG` must be empty when `NODE_ENV` is `production`, because
 * the debug output of Prisma and ioredis includes query parameters and command arguments.
 *
 * For a `superRefine` on any schema that spreads {@link databaseEnvShape}. It reads only `NODE_ENV` and `DEBUG` and
 * tolerates unparsed values (even a missing object), so it can run with `{ when: () => true }` and report its problem
 * together with every other variable's.
 */
export function checkDatabaseEnv(env: DatabaseEnvRuleInput | null | undefined, ctx: z.RefinementCtx): void {
  const debug = env?.DEBUG;
  if (env?.NODE_ENV === "production" && typeof debug === "string" && debug.trim() !== "") {
    ctx.addIssue({
      code: "custom",
      path: ["DEBUG"],
      message: "must be empty in production: Prisma and ioredis debug output includes query parameters",
    });
  }
}

/** Environment variables read by `getPrisma()`. Error messages never include the values (the URL holds a password). */
export const DatabaseEnvSchema = z.object(databaseEnvShape).superRefine(checkDatabaseEnv, { when: () => true });

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;

/**
 * One `VARIABLE: reason` line per issue, in schema order, e.g. `DB_POOL_MAX: must be an integer from 1 to 100`. Built
 * from each issue's path and message only, never from its input, so no value can reach a terminal or a log.
 */
export function formatEnvIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const variable = issue.path.length === 0 ? "(environment)" : issue.path.map(String).join(".");
    return `${variable}: ${issue.message}`;
  });
}

/** Thrown when the database environment is missing or invalid. Lists variable names and reasons, never values. */
export class DatabaseEnvError extends Error {
  override readonly name = "DatabaseEnvError";

  /** One `VARIABLE: reason` line per problem, e.g. `DATABASE_URL: is required`. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid database environment: ${issues.join("; ")}`);
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * The database the Prisma CLI works on, for migrations and `prisma db seed` alike: `DATABASE_DIRECT_URL`, else
 * `DATABASE_URL`. Migrations need a direct connection, and in production DATABASE_URL may point at a pooler. Sharing
 * this between prisma.config.ts and the seed means a seed always writes to the database that was just migrated.
 *
 * Unset and blank values count as missing. Returns "" when neither is set rather than throwing, because
 * `prisma generate` loads the same config and must work without a database (plan D7).
 */
export function resolveCliDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  for (const name of ["DATABASE_DIRECT_URL", "DATABASE_URL"] as const) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

/** `host:port/database`, to say which database a command works on. Never the whole URL: it carries the password. */
export function describeDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "an unparsable database URL";
  }
  return `${parsed.hostname}${parsed.port === "" ? "" : `:${parsed.port}`}${parsed.pathname}`;
}

/**
 * Validates the database environment. Pure: reads only the object it is given (`process.env` by default) and has no
 * side effects, so tests can pass a plain object.
 *
 * @throws {DatabaseEnvError} listing every invalid variable as `VARIABLE: reason`.
 */
export function loadDatabaseEnv(env: Readonly<Record<string, string | undefined>> = process.env): DatabaseEnv {
  const result = DatabaseEnvSchema.safeParse(env);
  if (!result.success) throw new DatabaseEnvError(formatEnvIssues(result.error));
  return result.data;
}
