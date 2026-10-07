import { DEFAULT_DB_STATEMENT_TIMEOUT_MS } from "@finlytics/database";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { EnvError, loadEnv } from "../env";
import { checkApiEnv, HTTP_LIMITS, TRANSACTION_LIMITS } from "../env.schema";

/** The two variables the schema requires, with secrets in them. */
const REQUIRED = Object.freeze({
  DATABASE_URL: "postgresql://finlytics:db-s3cret@localhost:5433/finlytics",
  REDIS_URL: "redis://:redis-s3cret@localhost:6380",
});

const PRODUCTION = Object.freeze({
  ...REQUIRED,
  NODE_ENV: "production",
  API_ALLOWED_ORIGINS: "https://app.finlytics.in",
  API_TRUST_PROXY: "10.0.0.0/8",
  MASTER_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  API_PUBLIC_URL: "https://app.finlytics.in",
});

/** The `VARIABLE: reason` lines loadEnv throws for `source`. */
function issuesOf(source: Record<string, string | undefined>): readonly string[] {
  try {
    loadEnv(source);
  } catch (error: unknown) {
    if (error instanceof EnvError) return error.issues;
    throw error;
  }
  throw new Error("expected loadEnv to throw");
}

describe("loadEnv", () => {
  it("defaults to the security.md limits", () => {
    const env = loadEnv(REQUIRED);

    expect(env).toMatchObject({
      NODE_ENV: "development",
      APP_ROLE: ["http"],
      API_HOST: "127.0.0.1",
      API_PORT: 4000,
      API_LOG_LEVEL: "info",
      API_LOG_FORMAT: "pretty",
      API_TRUST_PROXY: false,
      API_ALLOWED_ORIGINS: ["http://localhost:3000"],
      API_DOCS_ENABLED: true,
      API_SHUTDOWN_DRAIN_MS: 0,
      API_RATE_LIMIT_PUBLIC_PER_MIN: 100,
      API_RATE_LIMIT_USER_PER_MIN: 600,
      DB_POOL_MAX: 10,
      DB_CONNECT_TIMEOUT_MS: 5_000,
      DB_STATEMENT_TIMEOUT_MS: 10_000,
    });
    expect(Object.isFrozen(env)).toBe(true);
    expect(HTTP_LIMITS).toEqual({
      bodyLimitBytes: 1_048_576,
      handlerTimeoutMs: 15_000,
      requestTimeoutMs: 15_000,
      keepAliveTimeoutMs: 72_000,
    });
  });

  it("applies NODE_ENV-dependent defaults: silent logs in test, JSON outside development, a production drain", () => {
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "test" })).toMatchObject({
      API_LOG_LEVEL: "silent",
      API_LOG_FORMAT: "json",
    });
    expect(loadEnv(PRODUCTION)).toMatchObject({
      API_LOG_LEVEL: "info",
      API_LOG_FORMAT: "json",
      API_DOCS_ENABLED: false,
      API_SHUTDOWN_DRAIN_MS: 5_000,
      API_TRUST_PROXY: ["10.0.0.0/8"],
      API_ALLOWED_ORIGINS: ["https://app.finlytics.in"],
    });
  });

  it("treats empty variables as unset", () => {
    expect(loadEnv({ ...REQUIRED, API_PORT: "", API_LOG_LEVEL: "", API_DOCS_ENABLED: "" })).toMatchObject({
      API_PORT: 4000,
      API_LOG_LEVEL: "info",
      API_DOCS_ENABLED: true,
    });
  });

  it("lists every invalid variable by name without echoing values", () => {
    const issues = issuesOf({
      DATABASE_URL: "mysql://root:db-s3cret@db/x",
      REDIS_URL: "http://user:redis-s3cret@cache",
      API_PORT: "80abc",
      API_HOST: "bad host!",
      API_LOG_LEVEL: "verbose",
      API_RATE_LIMIT_USER_PER_MIN: "0",
    });

    expect(issues).toEqual([
      "DATABASE_URL: must be a postgres:// or postgresql:// URL",
      "API_HOST: must be an IP address or a host name",
      "API_PORT: must be an integer from 0 to 65535",
      "REDIS_URL: must be a redis:// or rediss:// URL",
      "API_LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent",
      "API_RATE_LIMIT_USER_PER_MIN: must be an integer from 1 to 100000",
    ]);
    const text = issues.join("\n");
    for (const value of ["db-s3cret", "redis-s3cret", "80abc", "bad host!", "verbose"])
      expect(text).not.toContain(value);
  });

  it("requires REDIS_URL and DATABASE_URL", () => {
    expect(issuesOf({})).toEqual(["DATABASE_URL: is required", "REDIS_URL: is required"]);
  });

  it("accepts only true and false for boolean variables", () => {
    expect(loadEnv({ ...REQUIRED, API_DOCS_ENABLED: "false" }).API_DOCS_ENABLED).toBe(false);
    expect(loadEnv({ ...REQUIRED, API_DOCS_ENABLED: "true" }).API_DOCS_ENABLED).toBe(true);
    for (const value of ["1", "yes", "TRUE", "False", "on"]) {
      expect(issuesOf({ ...REQUIRED, API_DOCS_ENABLED: value }), value).toEqual([
        "API_DOCS_ENABLED: must be true or false",
      ]);
    }
  });

  it("requires explicit https origins and a trusted-proxy setting in production", () => {
    expect(issuesOf({ ...REQUIRED, NODE_ENV: "production" })).toEqual([
      "API_TRUST_PROXY: must be set explicitly in production: false or the proxies' IPs/CIDRs",
      "API_ALLOWED_ORIGINS: is required in production",
      "MASTER_KEY: is required in production",
      "API_PUBLIC_URL: is required in production",
    ]);
    expect(
      issuesOf({ ...PRODUCTION, API_ALLOWED_ORIGINS: "https://app.finlytics.in,http://app.finlytics.in" }),
    ).toEqual(["API_ALLOWED_ORIGINS: must list https:// origins only in production"]);
    expect(loadEnv({ ...PRODUCTION, API_TRUST_PROXY: "false" }).API_TRUST_PROXY).toBe(false);
  });

  it("rejects '*' origins and API_TRUST_PROXY=true", () => {
    expect(issuesOf({ ...REQUIRED, API_ALLOWED_ORIGINS: "*" })).toEqual([
      "API_ALLOWED_ORIGINS: must list exact origins: a wildcard would allow any site",
    ]);
    expect(issuesOf({ ...REQUIRED, API_ALLOWED_ORIGINS: "https://*.finlytics.in" })).toHaveLength(1);
    expect(issuesOf({ ...REQUIRED, API_TRUST_PROXY: "true" })).toEqual([
      "API_TRUST_PROXY: must not be true: any client could then set its own IP through X-Forwarded-For",
    ]);
  });

  it("rejects origins with a path, credentials, a trailing slash or another scheme", () => {
    for (const origin of [
      "http://localhost:3000/",
      "https://app.finlytics.in/v1",
      "https://user:pw@app.finlytics.in",
      "ftp://app.finlytics.in",
      "app.finlytics.in",
      "https://APP.finlytics.in",
      "https://app.finlytics.in:443",
    ]) {
      expect(issuesOf({ ...REQUIRED, API_ALLOWED_ORIGINS: origin }), origin).toEqual([
        "API_ALLOWED_ORIGINS: must be comma-separated origins (scheme://host[:port], no path, no wildcard)",
      ]);
    }
    expect(
      loadEnv({
        ...REQUIRED,
        API_ALLOWED_ORIGINS: " http://localhost:3000 , http://127.0.0.1:3000,http://localhost:3000",
      }).API_ALLOWED_ORIGINS,
    ).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  it("takes trusted proxies as IPs and CIDRs, never a hop count", () => {
    expect(loadEnv({ ...REQUIRED, API_TRUST_PROXY: "10.0.0.0/8, 192.168.1.10,fd00::/8, ::1" }).API_TRUST_PROXY).toEqual(
      ["10.0.0.0/8", "192.168.1.10", "fd00::/8", "::1"],
    );
    expect(issuesOf({ ...REQUIRED, API_TRUST_PROXY: "2" })).toEqual([
      "API_TRUST_PROXY: must list the proxies' IPs/CIDRs, not a hop count: a hop count can't verify the immediate peer, and Fastify >= 5.12.2 ignores it",
    ]);
    for (const value of ["10.0.0.0/33", "fd00::/129", "10.0.0.0/8/1", "proxy.internal", "10.0.0.0/x", "10.0.0.1,"]) {
      expect(issuesOf({ ...REQUIRED, API_TRUST_PROXY: value }), value).toEqual([
        "API_TRUST_PROXY: must be false or the proxies' comma-separated IPs/CIDRs",
      ]);
    }
  });

  it("rejects pretty logs, docs and DEBUG in production", () => {
    expect(
      issuesOf({
        ...PRODUCTION,
        API_LOG_FORMAT: "pretty",
        API_DOCS_ENABLED: "true",
        API_LOG_LEVEL: "trace",
        DEBUG: "prisma:*",
        API_PORT: "0",
      }),
    ).toEqual([
      "DEBUG: must be empty in production: Prisma and ioredis debug output includes query parameters",
      "API_LOG_FORMAT: must be json in production",
      "API_LOG_LEVEL: must not be trace or silent in production",
      "API_DOCS_ENABLED: must be false in production",
      "API_PORT: must be from 1 to 65535 in production",
    ]);
    expect(issuesOf({ ...PRODUCTION, API_LOG_LEVEL: "silent" })).toEqual([
      "API_LOG_LEVEL: must not be trace or silent in production",
    ]);
  });

  it("reports an invalid explicit production setting once, not also as missing", () => {
    expect(issuesOf({ ...PRODUCTION, API_TRUST_PROXY: "true" })).toEqual([
      "API_TRUST_PROXY: must not be true: any client could then set its own IP through X-Forwarded-For",
    ]);
    expect(issuesOf({ ...PRODUCTION, API_ALLOWED_ORIGINS: "*" })).toEqual([
      "API_ALLOWED_ORIGINS: must list exact origins: a wildcard would allow any site",
    ]);
  });

  it("reports production rules together with other variables' problems", () => {
    expect(issuesOf({ ...PRODUCTION, API_PORT: "x", API_LOG_FORMAT: "pretty" })).toEqual([
      "API_PORT: must be an integer from 0 to 65535",
      "API_LOG_FORMAT: must be json in production",
    ]);
  });

  it("keeps transactions inside the request budget and DB_STATEMENT_TIMEOUT_MS below the transaction timeout", () => {
    expect(TRANSACTION_LIMITS.maxWaitMs + TRANSACTION_LIMITS.timeoutMs).toBeLessThan(HTTP_LIMITS.handlerTimeoutMs);
    expect(DEFAULT_DB_STATEMENT_TIMEOUT_MS).toBeLessThan(TRANSACTION_LIMITS.timeoutMs);
    expect(loadEnv({ ...REQUIRED, DB_STATEMENT_TIMEOUT_MS: "11000" }).DB_STATEMENT_TIMEOUT_MS).toBe(11_000);
    // Refused by @finlytics/database's range (100–11000) or, should that range ever widen, by the api's own rule.
    for (const value of [String(TRANSACTION_LIMITS.timeoutMs), String(HTTP_LIMITS.handlerTimeoutMs)]) {
      const issues = issuesOf({ ...REQUIRED, DB_STATEMENT_TIMEOUT_MS: value });
      expect(issues, value).toHaveLength(1);
      expect(issues[0], value).toMatch(/^DB_STATEMENT_TIMEOUT_MS: /);
    }
  });

  it("refuses a statement timeout at or above the transaction timeout, whatever range the database allows", () => {
    const issuesFor = (env: Record<string, unknown>, existing: { path: string[] }[] = []) => {
      const issues: unknown[] = [...existing];
      const ctx = { issues, addIssue: (issue: unknown) => void issues.push(issue) } as unknown as z.RefinementCtx;
      checkApiEnv(env, ctx);
      return issues.slice(existing.length);
    };

    expect(issuesFor({ DB_STATEMENT_TIMEOUT_MS: TRANSACTION_LIMITS.timeoutMs })).toEqual([
      expect.objectContaining({
        path: ["DB_STATEMENT_TIMEOUT_MS"],
        message: "must be below the 12000 ms transaction timeout",
      }),
    ]);
    expect(issuesFor({ DB_STATEMENT_TIMEOUT_MS: TRANSACTION_LIMITS.timeoutMs - 1 })).toEqual([]);
    // Reported once: a value that already failed its own range check isn't reported again.
    expect(issuesFor({ DB_STATEMENT_TIMEOUT_MS: 14_000 }, [{ path: ["DB_STATEMENT_TIMEOUT_MS"] }])).toEqual([]);
  });

  it("requires an explicit NODE_ENV when API_HOST is not loopback", () => {
    const reason =
      "NODE_ENV: must be set when API_HOST is not 127.0.0.1, ::1 or localhost: unset, it defaults to development, " +
      "which turns the production rules off";
    for (const host of ["0.0.0.0", "::", "10.1.2.3", "api.internal"]) {
      expect(issuesOf({ ...REQUIRED, API_HOST: host }), host).toEqual([reason]);
      expect(issuesOf({ ...REQUIRED, API_HOST: host, NODE_ENV: "" }), host).toEqual([reason]);
      expect(loadEnv({ ...REQUIRED, API_HOST: host, NODE_ENV: "development" }).API_HOST, host).toBe(host);
    }
    for (const host of [undefined, "", "127.0.0.1", "::1", "localhost", " localhost "]) {
      expect(loadEnv({ ...REQUIRED, API_HOST: host }).NODE_ENV, String(host)).toBe("development");
    }
    // Reported first, together with the other variables' problems; an invalid host keeps its own issue only.
    expect(issuesOf({ ...REQUIRED, API_HOST: "0.0.0.0", API_PORT: "x" })).toEqual([
      reason,
      "API_PORT: must be an integer from 0 to 65535",
    ]);
    expect(issuesOf({ ...REQUIRED, API_HOST: "bad host!" })).toEqual([
      "API_HOST: must be an IP address or a host name",
    ]);
  });

  it("accepts host names and IPv6 hosts, and only http as the role", () => {
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "test", API_HOST: "0.0.0.0" }).API_HOST).toBe("0.0.0.0");
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "test", API_HOST: "::" }).API_HOST).toBe("::");
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "test", API_HOST: "api.internal" }).API_HOST).toBe("api.internal");
    expect(issuesOf({ ...REQUIRED, APP_ROLE: "web" })).toEqual([
      "APP_ROLE: must be a comma-separated list of http, gateway, feed, worker",
    ]);
  });

  it("reads APP_ROLE as a comma list of roles, each once, in a fixed order", () => {
    expect(loadEnv({ ...REQUIRED, APP_ROLE: "worker, http,gateway,feed,http" }).APP_ROLE).toEqual([
      "http",
      "gateway",
      "feed",
      "worker",
    ]);
    expect(loadEnv({ ...REQUIRED, APP_ROLE: "gateway" }).APP_ROLE).toEqual(["gateway"]);
    expect(issuesOf({ ...REQUIRED, APP_ROLE: "http,," })).toEqual([
      "APP_ROLE: must be a comma-separated list of http, gateway, feed, worker",
    ]);
  });

  it("defaults the market feed to auto with an always-on simulator outside production", () => {
    const env = loadEnv(REQUIRED);
    expect(env).toMatchObject({
      MARKET_FEED_SOURCE: "auto",
      MARKET_FEED_ALWAYS_ON: true,
      MARKET_FEED_PAPER_SEED: 1,
      MARKET_FEED_PAPER_TICK_MS: 250,
      RT_UNSUB_GRACE_MS: 30_000,
    });
    expect(env.MARKET_FEED_ACCOUNT_ID).toBeUndefined();
    expect(loadEnv({ ...REQUIRED, MARKET_FEED_SOURCE: "paper" }).MARKET_FEED_SOURCE).toBe("paper");
  });

  it("keeps one role per process and an explicit broker feed source in production", () => {
    expect(issuesOf({ ...PRODUCTION, APP_ROLE: "http,gateway", MARKET_FEED_SOURCE: "upstox" })).toEqual([
      "APP_ROLE: must name one role per process in production",
    ]);
    expect(issuesOf({ ...PRODUCTION, APP_ROLE: "gateway" })).toEqual([
      "MARKET_FEED_SOURCE: must be set in production when APP_ROLE is feed or gateway",
    ]);
    for (const source of ["auto", "paper"]) {
      expect(issuesOf({ ...PRODUCTION, APP_ROLE: "gateway", MARKET_FEED_SOURCE: source })).toEqual([
        "MARKET_FEED_SOURCE: must be upstox or dhan in production: never simulated or picked from user accounts",
      ]);
    }
    const env = loadEnv({
      ...PRODUCTION,
      APP_ROLE: "feed",
      MARKET_FEED_SOURCE: "dhan",
      MARKET_FEED_ACCOUNT_ID: "cmabc",
    });
    expect(env.MARKET_FEED_ALWAYS_ON).toBe(false);
    expect(loadEnv(PRODUCTION).APP_ROLE).toEqual(["http"]);
  });

  it("requires the feed account for a broker feed", () => {
    expect(issuesOf({ ...REQUIRED, APP_ROLE: "feed", MARKET_FEED_SOURCE: "upstox" })).toEqual([
      "MARKET_FEED_ACCOUNT_ID: is required when MARKET_FEED_SOURCE is upstox and APP_ROLE includes feed",
    ]);
    expect(issuesOf({ ...REQUIRED, APP_ROLE: "feed", MARKET_FEED_SOURCE: "dhan" })).toEqual([
      "MARKET_FEED_ACCOUNT_ID: is required when MARKET_FEED_SOURCE is dhan and APP_ROLE includes feed",
    ]);
    expect(
      loadEnv({ ...REQUIRED, APP_ROLE: "feed", MARKET_FEED_SOURCE: "upstox", MARKET_FEED_ACCOUNT_ID: "cmabc123" })
        .MARKET_FEED_ACCOUNT_ID,
    ).toBe("cmabc123");
    expect(loadEnv({ ...REQUIRED, APP_ROLE: "feed", MARKET_FEED_SOURCE: "auto" }).MARKET_FEED_SOURCE).toBe("auto");
    expect(issuesOf({ ...REQUIRED, MARKET_FEED_SOURCE: "zerodha" })).toEqual([
      "MARKET_FEED_SOURCE: must be auto, paper, upstox or dhan",
    ]);
  });

  it("names the problem when a value isn't a string", () => {
    const issues = issuesOf({
      ...REQUIRED,
      API_TRUST_PROXY: 5 as unknown as string,
      API_ALLOWED_ORIGINS: [] as unknown as string,
    });

    expect(issues).toEqual([
      "API_TRUST_PROXY: must be false or the proxies' comma-separated IPs/CIDRs",
      "API_ALLOWED_ORIGINS: must be comma-separated origins (scheme://host[:port], no path, no wildcard)",
    ]);
  });
});

describe("vault and public URL variables", () => {
  it("accepts a 32-byte base64 master key and an origin, defaulting the public URL in development", () => {
    const env = loadEnv({ ...REQUIRED, MASTER_KEY: PRODUCTION.MASTER_KEY, API_PUBLIC_URL: "http://localhost:3000/" });

    expect(env.MASTER_KEY).toBe(PRODUCTION.MASTER_KEY);
    expect(env.API_PUBLIC_URL).toBe("http://localhost:3000");
    expect(loadEnv(REQUIRED).MASTER_KEY).toBeUndefined();
    expect(loadEnv(REQUIRED).API_PUBLIC_URL).toBe("http://localhost:3000");
  });

  it("rejects a master key that isn't 32 bytes of base64, and a public URL with a path, never echoing values", () => {
    const issues = issuesOf({
      ...REQUIRED,
      MASTER_KEY: "c2hvcnQta2V5",
      API_PUBLIC_URL: "https://app.finlytics.in/app",
    });

    expect(issues).toEqual([
      "MASTER_KEY: must be 32 bytes, base64-encoded (openssl rand -base64 32)",
      "API_PUBLIC_URL: must be an http(s) origin (scheme://host[:port], no path)",
    ]);
    expect(issues.join(" ")).not.toContain("c2hvcnQta2V5");
  });

  it("requires an https public URL in production", () => {
    expect(issuesOf({ ...PRODUCTION, API_PUBLIC_URL: "http://app.finlytics.in" })).toEqual([
      "API_PUBLIC_URL: must use https:// in production",
    ]);
    expect(issuesOf({ ...PRODUCTION, MASTER_KEY: "bad" })).toEqual([
      "MASTER_KEY: must be 32 bytes, base64-encoded (openssl rand -base64 32)",
    ]);
  });
});
