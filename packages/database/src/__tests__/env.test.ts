import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  checkDatabaseEnv,
  databaseEnvShape,
  DatabaseEnvError,
  DEFAULT_DB_CONNECT_TIMEOUT_MS,
  DEFAULT_DB_POOL_MAX,
  DEFAULT_DB_STATEMENT_TIMEOUT_MS,
  describeDatabaseUrl,
  formatEnvIssues,
  loadDatabaseEnv,
  resolveCliDatabaseUrl,
} from "../env";

const URL_WITH_PASSWORD = "postgresql://finlytics:s3cret-password@localhost:5433/finlytics";

/** The `VARIABLE: reason` lines loadDatabaseEnv throws for `env`, or [] when it accepts it. */
function issuesOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadDatabaseEnv(env);
  } catch (error: unknown) {
    if (error instanceof DatabaseEnvError) return error.issues;
    throw error;
  }
  return [];
}

/** The variables the issues name, in order. */
function variablesOf(issues: readonly string[]): string[] {
  return issues.map((issue) => issue.slice(0, issue.indexOf(":")));
}

describe("loadDatabaseEnv", () => {
  it("applies the defaults: development, a pool of 10, a 5 s connect timeout and a 10 s statement timeout", () => {
    expect(loadDatabaseEnv({ DATABASE_URL: URL_WITH_PASSWORD })).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: URL_WITH_PASSWORD,
      DB_POOL_MAX: DEFAULT_DB_POOL_MAX,
      DB_CONNECT_TIMEOUT_MS: DEFAULT_DB_CONNECT_TIMEOUT_MS,
      DB_STATEMENT_TIMEOUT_MS: DEFAULT_DB_STATEMENT_TIMEOUT_MS,
    });
    expect([DEFAULT_DB_POOL_MAX, DEFAULT_DB_CONNECT_TIMEOUT_MS, DEFAULT_DB_STATEMENT_TIMEOUT_MS]).toEqual([
      10, 5_000, 10_000,
    ]);
  });

  it.each([undefined, ""])("uses the defaults when the numeric variables are %j", (value) => {
    const env = loadDatabaseEnv({
      DATABASE_URL: URL_WITH_PASSWORD,
      DB_POOL_MAX: value,
      DB_CONNECT_TIMEOUT_MS: value,
      DB_STATEMENT_TIMEOUT_MS: value,
      NODE_ENV: value,
    });

    expect(env).toMatchObject({ NODE_ENV: "development", DB_POOL_MAX: 10, DB_STATEMENT_TIMEOUT_MS: 10_000 });
  });

  it("parses the numeric variables as integers", () => {
    expect(
      loadDatabaseEnv({
        DATABASE_URL: URL_WITH_PASSWORD,
        DB_POOL_MAX: "25",
        DB_CONNECT_TIMEOUT_MS: " 2000 ",
        DB_STATEMENT_TIMEOUT_MS: "11000",
      }),
    ).toMatchObject({ DB_POOL_MAX: 25, DB_CONNECT_TIMEOUT_MS: 2_000, DB_STATEMENT_TIMEOUT_MS: 11_000 });
  });

  it.each(["0", "101", "2.5", "ten", "1e1", "0x10", "-1", " "])("rejects DB_POOL_MAX=%j", (poolMax) => {
    expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, DB_POOL_MAX: poolMax })).toEqual([
      "DB_POOL_MAX: must be an integer from 1 to 100",
    ]);
  });

  it("bounds the connect timeout to 100–60 000 ms and the statement timeout to 100–11 000 ms", () => {
    const accepts = (variable: string, value: string) =>
      issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, [variable]: value }).length === 0;

    expect(["99", "100", "60000", "60001"].map((value) => accepts("DB_CONNECT_TIMEOUT_MS", value))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    // Below the 12 s transaction timeout (and so the api's 15 s request timeout): PostgreSQL cancels a slow statement
    // before Prisma gives up on its transaction.
    expect(["99", "100", "11000", "11001"].map((value) => accepts("DB_STATEMENT_TIMEOUT_MS", value))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, DB_STATEMENT_TIMEOUT_MS: "12000" })).toEqual([
      "DB_STATEMENT_TIMEOUT_MS: must be an integer from 100 to 11000",
    ]);
  });

  it.each([undefined, "", "  "])("rejects a missing or empty DATABASE_URL (%j)", (databaseUrl) => {
    expect(variablesOf(issuesOf({ DATABASE_URL: databaseUrl }))).toEqual(["DATABASE_URL"]);
  });

  it("rejects non-postgres DATABASE_URL schemes and parameters that would override the startup parameters", () => {
    for (const databaseUrl of [
      "mysql://finlytics:s3cret-password@localhost:3306/finlytics",
      "http://localhost:5433/finlytics",
      "localhost:5433/finlytics",
      "finlytics",
    ]) {
      expect(issuesOf({ DATABASE_URL: databaseUrl }), databaseUrl).toEqual([
        "DATABASE_URL: must be a postgres:// or postgresql:// URL",
      ]);
    }
    expect(issuesOf({ DATABASE_URL: `${URL_WITH_PASSWORD}?query_timeout=5000` })).toEqual([
      "DATABASE_URL: must not set query_timeout: a client-side timeout leaves the query running in PostgreSQL; DB_STATEMENT_TIMEOUT_MS cancels it there",
    ]);
    // pg lets URL parameters override the pool's options, so these would silently replace the configured timeouts.
    expect(variablesOf(issuesOf({ DATABASE_URL: `${URL_WITH_PASSWORD}?statement_timeout=0` }))).toEqual([
      "DATABASE_URL",
    ]);
    expect(
      variablesOf(
        issuesOf({ DATABASE_URL: `${URL_WITH_PASSWORD}?sslmode=require&idle_in_transaction_session_timeout=0` }),
      ),
    ).toEqual(["DATABASE_URL"]);
    // The application name and the startup `options` would replace or add to what createPrismaClient sends.
    expect(issuesOf({ DATABASE_URL: `${URL_WITH_PASSWORD}?application_name=psql` })).toEqual([
      "DATABASE_URL: must not set application_name: it would replace the name createPrismaClient sets (its applicationName option)",
    ]);
    expect(issuesOf({ DATABASE_URL: `${URL_WITH_PASSWORD}?sslmode=require&options=-c%20timezone%3DUTC` })).toEqual([
      "DATABASE_URL: must not set options: it would add server settings (any -c, e.g. search_path or lock_timeout) to every connection, outside the ones createPrismaClient sets",
    ]);
    // Checked on the trimmed value, the one the pool gets.
    expect(variablesOf(issuesOf({ DATABASE_URL: ` ${URL_WITH_PASSWORD}?options=-c%20x%3D1\n` }))).toEqual([
      "DATABASE_URL",
    ]);
    // Both schemes, and parameters that leave the startup parameters alone, are fine.
    expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD.replace("postgresql:", "postgres:") })).toEqual([]);
    expect(issuesOf({ DATABASE_URL: `${URL_WITH_PASSWORD}?sslmode=require` })).toEqual([]);
  });

  it("rejects DEBUG in production", () => {
    const production = { DATABASE_URL: URL_WITH_PASSWORD, NODE_ENV: "production" };

    expect(issuesOf({ ...production, DEBUG: "prisma:*" })).toEqual([
      "DEBUG: must be empty in production: Prisma and ioredis debug output includes query parameters",
    ]);
    expect(issuesOf({ ...production, DEBUG: "ioredis:*,-ioredis:dataHandler" })).toHaveLength(1);
    expect(issuesOf({ ...production, DEBUG: "" })).toEqual([]);
    expect(issuesOf({ ...production, DEBUG: "  " })).toEqual([]);
    expect(issuesOf(production)).toEqual([]);
    // Outside production, debug output is a developer's choice.
    expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, NODE_ENV: "development", DEBUG: "prisma:*" })).toEqual([]);
  });

  it("rejects NODE_ENV values other than development, test and production", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, NODE_ENV: nodeEnv }), nodeEnv).toEqual([]);
    }
    for (const nodeEnv of ["staging", "prod", "Production"]) {
      expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, NODE_ENV: nodeEnv }), nodeEnv).toEqual([
        "NODE_ENV: must be development, test or production",
      ]);
    }
  });

  it("lists every invalid variable at once, the DEBUG rule included", () => {
    const issues = issuesOf({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://localhost/finlytics",
      DB_POOL_MAX: "0",
      DB_CONNECT_TIMEOUT_MS: "fast",
      DB_STATEMENT_TIMEOUT_MS: "15000",
      DEBUG: "*",
    });

    expect(variablesOf(issues)).toEqual([
      "DATABASE_URL",
      "DB_POOL_MAX",
      "DB_CONNECT_TIMEOUT_MS",
      "DB_STATEMENT_TIMEOUT_MS",
      "DEBUG",
    ]);
  });

  it("names the variable in every environment error and never echoes a value", () => {
    // Every variable holds a value that contains a marker; every one of them is invalid.
    const marker = "LEAKED-VALUE-7f3a";
    const env = {
      NODE_ENV: `production-${marker}`,
      DATABASE_URL: `mysql://user:${marker}@localhost/${marker}`,
      DB_POOL_MAX: marker,
      DB_CONNECT_TIMEOUT_MS: `1${marker}`,
      DB_STATEMENT_TIMEOUT_MS: `${marker}0`,
    };
    let thrown: unknown;
    try {
      loadDatabaseEnv(env);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DatabaseEnvError);
    const error = thrown as DatabaseEnvError;
    expect(variablesOf(error.issues)).toEqual(Object.keys(env));
    for (const issue of error.issues) expect(issue).toMatch(/^[A-Z][A-Z_]*: [a-z]/);
    expect(error.message).toMatch(/^Invalid database environment: NODE_ENV: /);
    expect(`${error.message}\n${error.issues.join("\n")}\n${String(error.stack)}`).not.toContain(marker);
    // A production DEBUG value is never echoed either.
    expect(issuesOf({ DATABASE_URL: URL_WITH_PASSWORD, NODE_ENV: "production", DEBUG: marker }).join()).not.toContain(
      marker,
    );
  });
});

describe("databaseEnvShape and checkDatabaseEnv", () => {
  // How apps/api builds its own env schema (plan D3): the database variables plus its own, with the database rules.
  const ApiEnvSchema = z
    .object({ ...databaseEnvShape, API_PORT: z.string().regex(/^\d+$/, "must be a port number") })
    .superRefine(checkDatabaseEnv, { when: () => true });

  it("composes into another app's env schema, defaults included", () => {
    const parsed = ApiEnvSchema.parse({ DATABASE_URL: URL_WITH_PASSWORD, API_PORT: "4000" });

    expect(parsed).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: URL_WITH_PASSWORD,
      DB_POOL_MAX: 10,
      DB_CONNECT_TIMEOUT_MS: 5_000,
      DB_STATEMENT_TIMEOUT_MS: 10_000,
      API_PORT: "4000",
    });
  });

  it("reports the DEBUG rule alongside the other app's own problems", () => {
    const result = ApiEnvSchema.safeParse({
      DATABASE_URL: URL_WITH_PASSWORD,
      API_PORT: "abc",
      NODE_ENV: "production",
      DEBUG: "*",
    });

    expect(result.success).toBe(false);
    expect(formatEnvIssues(result.error ?? new z.ZodError([]))).toEqual([
      "API_PORT: must be a port number",
      "DEBUG: must be empty in production: Prisma and ioredis debug output includes query parameters",
    ]);
  });

  it("reports a missing environment object as a problem instead of throwing", () => {
    for (const input of [null, undefined, "DATABASE_URL=postgresql://localhost/x"]) {
      const result = ApiEnvSchema.safeParse(input);

      expect(result.success, String(input)).toBe(false);
      expect(formatEnvIssues(result.error ?? new z.ZodError([]))[0], String(input)).toMatch(/^\(environment\): /);
    }
  });

  it("formats an issue without a path as an environment-wide problem", () => {
    const error = new z.ZodError([{ code: "custom", path: [], message: "set either A or B", input: undefined }]);

    expect(formatEnvIssues(error)).toEqual(["(environment): set either A or B"]);
  });
});

describe("resolveCliDatabaseUrl", () => {
  const DIRECT_URL = "postgresql://finlytics:s3cret-password@db-primary:5432/finlytics";

  it("prefers DATABASE_DIRECT_URL, the database migrations run against", () => {
    expect(resolveCliDatabaseUrl({ DATABASE_DIRECT_URL: DIRECT_URL, DATABASE_URL: URL_WITH_PASSWORD })).toBe(
      DIRECT_URL,
    );
  });

  it.each([undefined, "", "   "])("falls back to DATABASE_URL when DATABASE_DIRECT_URL is %j", (directUrl) => {
    expect(resolveCliDatabaseUrl({ DATABASE_DIRECT_URL: directUrl, DATABASE_URL: ` ${URL_WITH_PASSWORD} ` })).toBe(
      URL_WITH_PASSWORD,
    );
  });

  it("returns an empty string when neither is set, so prisma generate works without a database", () => {
    expect(resolveCliDatabaseUrl({})).toBe("");
    expect(resolveCliDatabaseUrl({ DATABASE_DIRECT_URL: "", DATABASE_URL: " " })).toBe("");
  });
});

describe("describeDatabaseUrl", () => {
  it("names host, port and database without the credentials", () => {
    const description = describeDatabaseUrl(`${URL_WITH_PASSWORD}?sslmode=require&password=also-secret`);

    expect(description).toBe("localhost:5433/finlytics");
    expect(description).not.toMatch(/s3cret|also-secret|finlytics:/);
  });

  it("never echoes a URL it cannot parse", () => {
    expect(describeDatabaseUrl("not a url with s3cret-password")).toBe("an unparsable database URL");
  });
});
