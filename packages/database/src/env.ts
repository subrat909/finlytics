import { z } from "zod";

/** Default size of the pg pool behind each Prisma client. */
export const DEFAULT_DB_POOL_MAX = 10;

/** An unset variable and an empty one (`DB_POOL_MAX=` in a .env file) both mean "use the default". */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

/** Environment variables read by `getPrisma()`. Error messages never include the values (the URL holds a password). */
export const DatabaseEnvSchema = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).trim().min(1, "DATABASE_URL must not be empty"),
  DB_POOL_MAX: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int("DB_POOL_MAX must be an integer")
      .min(1, "DB_POOL_MAX must be between 1 and 100")
      .max(100, "DB_POOL_MAX must be between 1 and 100")
      .default(DEFAULT_DB_POOL_MAX),
  ),
});

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;

/** Thrown when the database environment is missing or invalid. Lists variable names only, never values. */
export class DatabaseEnvError extends Error {
  override readonly name = "DatabaseEnvError";
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
 * @throws {DatabaseEnvError} when `DATABASE_URL` is missing or empty, or `DB_POOL_MAX` is not an integer in 1–100.
 */
export function loadDatabaseEnv(env: Readonly<Record<string, string | undefined>> = process.env): DatabaseEnv {
  const result = DatabaseEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => issue.message).join("; ");
    throw new DatabaseEnvError(`Invalid database environment: ${problems}`);
  }
  return result.data;
}
