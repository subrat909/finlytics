import { describe, expect, it } from "vitest";

import {
  DatabaseEnvError,
  DEFAULT_DB_POOL_MAX,
  describeDatabaseUrl,
  loadDatabaseEnv,
  resolveCliDatabaseUrl,
} from "../env";

const URL_WITH_PASSWORD = "postgresql://finlytics:s3cret-password@localhost:5433/finlytics";

describe("loadDatabaseEnv", () => {
  it.each([undefined, ""])("defaults DB_POOL_MAX to 10 when it is %j", (poolMax) => {
    const env = loadDatabaseEnv({ DATABASE_URL: URL_WITH_PASSWORD, DB_POOL_MAX: poolMax });

    expect(env).toEqual({ DATABASE_URL: URL_WITH_PASSWORD, DB_POOL_MAX: DEFAULT_DB_POOL_MAX });
  });

  it("parses DB_POOL_MAX as an integer", () => {
    expect(loadDatabaseEnv({ DATABASE_URL: URL_WITH_PASSWORD, DB_POOL_MAX: "25" }).DB_POOL_MAX).toBe(25);
  });

  it.each(["0", "101", "2.5", "ten"])("rejects DB_POOL_MAX=%j", (poolMax) => {
    expect(() => loadDatabaseEnv({ DATABASE_URL: URL_WITH_PASSWORD, DB_POOL_MAX: poolMax })).toThrow(DatabaseEnvError);
  });

  it.each([undefined, "", "  "])("rejects a missing or empty DATABASE_URL (%j)", (databaseUrl) => {
    expect(() => loadDatabaseEnv({ DATABASE_URL: databaseUrl })).toThrow(/DATABASE_URL/);
  });

  it("never includes the connection string in validation errors", () => {
    let message = "";
    try {
      loadDatabaseEnv({ DATABASE_URL: URL_WITH_PASSWORD, DB_POOL_MAX: "500" });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/DB_POOL_MAX/);
    expect(message).not.toContain("s3cret-password");
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
