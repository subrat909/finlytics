import type * as AdapterPg from "@prisma/adapter-pg";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPrismaClient, getPrisma, PRISMA_GLOBAL_KEY, prismaClientOptionsFromEnv } from "../client";
import { loadDatabaseEnv } from "../env";
import type { CreatePrismaClientOptions } from "../client";
import type * as GeneratedClient from "../generated/client";
import type { PrismaClient } from "../generated/client";

/** Syntactically valid but never connected to: no test here runs a query (port 1 refuses connections). */
const UNREACHABLE_URL = "postgresql://finlytics:not-a-secret@127.0.0.1:1/never";

/** What the pg pool (`new PrismaPg(config)`) and the Prisma client (`new PrismaClient(options)`) were created with. */
const created = vi.hoisted(() => ({ pools: [] as unknown[], clients: [] as unknown[] }));

/** Records the first constructor argument, then constructs the real class. */
function recording<T extends new (...args: never[]) => object>(target: T, calls: unknown[]): T {
  return new Proxy(target, {
    construct(constructor, args: readonly unknown[], newTarget) {
      calls.push(args[0]);
      return Reflect.construct(constructor, args, newTarget) as object;
    },
  });
}

vi.mock("@prisma/adapter-pg", async (importOriginal) => {
  const actual = await importOriginal<typeof AdapterPg>();
  return { ...actual, PrismaPg: recording(actual.PrismaPg, created.pools) };
});

vi.mock("../generated/client", async (importOriginal) => {
  const actual = await importOriginal<typeof GeneratedClient>();
  return { ...actual, PrismaClient: recording(actual.PrismaClient, created.clients) };
});

const globalCache = globalThis as typeof globalThis & { [PRISMA_GLOBAL_KEY]?: PrismaClient | undefined };

/** Creates a client, disconnects it, and returns what its pool and client were configured with. */
async function configurationOf(options: CreatePrismaClientOptions): Promise<{ pool: unknown; client: unknown }> {
  const client = createPrismaClient(options);
  await client.$disconnect();
  return { pool: created.pools.at(-1), client: created.clients.at(-1) };
}

describe("createPrismaClient", () => {
  it.each(["", "   "])("rejects an empty URL (%j)", (url) => {
    expect(() => createPrismaClient({ url })).toThrow(/non-empty PostgreSQL connection string/);
  });

  it.each(["mysql://finlytics:not-a-secret@localhost:3306/db", "localhost:5432/db", "not a url", "file:///tmp/db"])(
    "rejects a URL that is not a postgres:// or postgresql:// URL (%j)",
    (url) => {
      expect(() => createPrismaClient({ url })).toThrow(/url must be a postgres:\/\/ or postgresql:\/\/ URL/);
    },
  );

  it.each([
    "query_timeout=1000",
    "statement_timeout=0",
    "idle_in_transaction_session_timeout=0",
    "application_name=not-finlytics",
    "options=-c%20statement_timeout%3D0",
    "sslmode=require&options=-c%20search_path%3Devil",
  ])("rejects a URL whose %s would override the configured startup parameters", (parameter) => {
    const url = `postgresql://finlytics:s3cret-password@127.0.0.1:1/never?${parameter}`;
    const name = /([a-z_]+)=[^&]*$/.exec(parameter)?.[1] ?? "";

    expect(() => createPrismaClient({ url })).toThrow(new RegExp(`must not set ${name}`));
    expect(() => createPrismaClient({ url })).not.toThrow(/s3cret-password/);
  });

  it("hands pg the trimmed URL, so a leading space can't turn the URL and its password into the database name", async () => {
    const padded = ` \t${UNREACHABLE_URL}\n `;

    const { pool } = await configurationOf({ url: padded });

    expect(pool).toMatchObject({ connectionString: UNREACHABLE_URL });
    // What pg reads from each string: the trimmed URL names the database; the padded one names the whole URL.
    expect(new pg.Client({ connectionString: UNREACHABLE_URL }).database).toBe("never");
    expect(new pg.Client({ connectionString: padded }).database).toContain("not-a-secret");
  });

  it.each([" mysql://finlytics:not-a-secret@localhost:3306/db", `\n${UNREACHABLE_URL}?options=-c%20x%3D1 `])(
    "checks the trimmed URL (%j)",
    (url) => {
      expect(() => createPrismaClient({ url })).toThrow(TypeError);
    },
  );

  it("refuses query logging, at the type level and at runtime", () => {
    // @ts-expect-error -- "query" is deliberately not a DatabaseLogLevel: query logs would leak bound parameters.
    const enableQueryLogging = () => createPrismaClient({ url: UNREACHABLE_URL, log: ["query"] });

    expect(enableQueryLogging).toThrow(/query logging is not allowed/);
  });

  it("rejects log entries other than info, warn and error, including { level: 'query', emit: 'event' }", () => {
    const invalid: unknown[] = [
      [{ level: "query", emit: "event" }],
      [{ level: "error", emit: "stdout" }],
      ["error", { level: "warn", emit: "event" }],
      ["debug"],
      ["ERROR"],
      [null],
      "error",
      null,
    ];

    for (const log of invalid) {
      expect(() => createPrismaClient({ url: UNREACHABLE_URL, log: log as never }), JSON.stringify(log)).toThrow(
        TypeError,
      );
    }
  });

  it("accepts info, warn and error", async () => {
    const { client } = await configurationOf({ url: UNREACHABLE_URL, log: ["info", "warn", "error"] });

    expect(client).toMatchObject({ log: ["info", "warn", "error"] });
  });

  it.each([0, -1, 2.5, Number.NaN])("rejects pool size %d", (poolMax) => {
    expect(() => createPrismaClient({ url: UNREACHABLE_URL, poolMax })).toThrow(RangeError);
  });

  it("rejects timeouts that are not positive integers a timer can hold", () => {
    const options: ((value: number) => Omit<CreatePrismaClientOptions, "url">)[] = [
      (value) => ({ connectTimeoutMs: value }),
      (value) => ({ statementTimeoutMs: value }),
      (value) => ({ idleInTransactionTimeoutMs: value }),
      (value) => ({ transaction: { maxWaitMs: value } }),
      (value) => ({ transaction: { timeoutMs: value } }),
    ];

    for (const option of options) {
      for (const value of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
        const create = () => createPrismaClient({ url: UNREACHABLE_URL, ...option(value) });

        expect(create).toThrow(RangeError);
        // The option's own check, not the statement-below-transaction rule.
        expect(create).toThrow(value === 2 ** 31 ? /must be at most 2147483647$/ : /must be a positive integer$/);
      }
    }
  });

  it.each([
    [{ statementTimeoutMs: 12_000 }, "statementTimeoutMs (12000) must be below transaction.timeoutMs (12000)"],
    [{ statementTimeoutMs: 13_000 }, "statementTimeoutMs (13000) must be below transaction.timeoutMs (12000)"],
    [{ transaction: { timeoutMs: 10_000 } }, "statementTimeoutMs (10000) must be below transaction.timeoutMs (10000)"],
    [
      { statementTimeoutMs: 5_000, transaction: { maxWaitMs: 2_000, timeoutMs: 4_000 } },
      "statementTimeoutMs (5000) must be below transaction.timeoutMs (4000)",
    ],
  ] satisfies [Omit<CreatePrismaClientOptions, "url">, string][])(
    "rejects a statement timeout that isn't below the transaction timeout (%j)",
    (options, message) => {
      expect(() => createPrismaClient({ url: UNREACHABLE_URL, ...options })).toThrow(
        new RangeError(`createPrismaClient: ${message}`),
      );
    },
  );

  it("accepts the largest statement timeout the environment allows, with the default and the api's transaction limits", async () => {
    const env = loadDatabaseEnv({ DATABASE_URL: UNREACHABLE_URL, DB_STATEMENT_TIMEOUT_MS: "11000" });

    const defaults = await configurationOf(prismaClientOptionsFromEnv(env));
    const api = await configurationOf({
      ...prismaClientOptionsFromEnv(env),
      applicationName: "finlytics-api",
      transaction: { maxWaitMs: 2_000, timeoutMs: 12_000 },
    });

    expect(defaults).toMatchObject({
      pool: { statement_timeout: 11_000 },
      client: { transactionOptions: { timeout: 12_000 } },
    });
    expect(api).toMatchObject({
      pool: { statement_timeout: 11_000 },
      client: { transactionOptions: { maxWait: 2_000, timeout: 12_000 } },
    });
  });

  it.each(["", "a".repeat(64), "finlytics api", "fínlytics", "finlytics\n"])(
    "rejects application name %j, which PostgreSQL would truncate or rewrite",
    (applicationName) => {
      expect(() => createPrismaClient({ url: UNREACHABLE_URL, applicationName })).toThrow(TypeError);
    },
  );

  it("passes the connect, statement and idle-in-transaction timeouts and the application name to the pg pool", async () => {
    const defaults = await configurationOf({ url: UNREACHABLE_URL });
    const explicit = await configurationOf({
      url: UNREACHABLE_URL,
      poolMax: 4,
      connectTimeoutMs: 1_500,
      statementTimeoutMs: 2_500,
      idleInTransactionTimeoutMs: 3_500,
      applicationName: "finlytics-api",
    });

    // Defaults (review D1): 5 s to get a connection, 10 s per statement, 15 s idle inside a transaction.
    expect(defaults.pool).toEqual({
      connectionString: UNREACHABLE_URL,
      max: 10,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
      application_name: "finlytics",
    });
    expect(explicit.pool).toEqual({
      connectionString: UNREACHABLE_URL,
      max: 4,
      connectionTimeoutMillis: 1_500,
      statement_timeout: 2_500,
      idle_in_transaction_session_timeout: 3_500,
      application_name: "finlytics-api",
    });
    // No client-side query_timeout: it would give up on a query and leave it running in PostgreSQL.
    expect(explicit.pool).not.toHaveProperty("query_timeout");
  });

  it("limits interactive transactions to a 5 s wait and a 12 s run by default", async () => {
    const defaults = await configurationOf({ url: UNREACHABLE_URL });
    const explicit = await configurationOf({
      url: UNREACHABLE_URL,
      statementTimeoutMs: 500,
      transaction: { maxWaitMs: 250, timeoutMs: 750 },
    });

    expect(defaults.client).toMatchObject({ transactionOptions: { maxWait: 5_000, timeout: 12_000 }, log: [] });
    expect(explicit.client).toMatchObject({ transactionOptions: { maxWait: 250, timeout: 750 } });
  });

  it("prints nothing by default, so a failed query never writes its arguments outside the app's logger", async () => {
    // Prisma's `error` log level prints a failed query's whole argument tree (emails, password hashes, encrypted
    // blobs) to the console, where the api's pino redaction can't reach it.
    const secret = "argon2id$hash-that-must-never-be-printed";
    const printed: string[] = [];
    const capture = (...args: unknown[]): true => {
      printed.push(args.map(String).join(" "));
      return true;
    };
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation(capture),
      vi.spyOn(process.stderr, "write").mockImplementation(capture),
      ...(["log", "info", "warn", "error"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(capture),
      ),
    ];
    const client = createPrismaClient({ url: UNREACHABLE_URL });
    try {
      // `email` must be a string: validation fails in the client, before any connection is attempted.
      await expect(client.user.create({ data: { email: 42, passwordHash: secret } as never })).rejects.toMatchObject({
        name: "PrismaClientValidationError",
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
      await client.$disconnect();
    }

    expect(printed.join("\n")).not.toContain(secret);
  });

  it("creates a client without connecting to the database", async () => {
    const client = createPrismaClient({ url: UNREACHABLE_URL, poolMax: 2, log: ["error"] });

    expect(typeof client.$connect).toBe("function");
    await client.$disconnect();
  });
});

describe("prismaClientOptionsFromEnv", () => {
  it("maps the database variables to client options", () => {
    expect(
      prismaClientOptionsFromEnv({
        DATABASE_URL: UNREACHABLE_URL,
        DB_POOL_MAX: 3,
        DB_CONNECT_TIMEOUT_MS: 1_000,
        DB_STATEMENT_TIMEOUT_MS: 2_000,
      }),
    ).toEqual({ url: UNREACHABLE_URL, poolMax: 3, connectTimeoutMs: 1_000, statementTimeoutMs: 2_000 });
  });
});

describe("getPrisma", () => {
  afterEach(async () => {
    await globalCache[PRISMA_GLOBAL_KEY]?.$disconnect();
    Reflect.deleteProperty(globalThis, PRISMA_GLOBAL_KEY);
  });

  it("configures the client from DATABASE_URL and the DB_* variables", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", UNREACHABLE_URL);
    vi.stubEnv("DB_POOL_MAX", "7");
    vi.stubEnv("DB_CONNECT_TIMEOUT_MS", "2000");
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "8000");

    getPrisma();

    expect(created.pools.at(-1)).toMatchObject({
      connectionString: UNREACHABLE_URL,
      max: 7,
      connectionTimeoutMillis: 2_000,
      statement_timeout: 8_000,
      idle_in_transaction_session_timeout: 15_000,
    });
  });

  it.each(["development", "test", "production"])(
    "caches one client per process on the registered symbol in every environment (%s)",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("DATABASE_URL", UNREACHABLE_URL);

      const first = getPrisma();
      // A second copy of this module, as the other build (ESM or CJS) of the package would be: it has its own module
      // scope but finds the same client under Symbol.for("@finlytics/database/prisma").
      vi.resetModules();
      const otherCopy = await import("../client");

      expect(getPrisma()).toBe(first);
      expect(otherCopy.getPrisma()).toBe(first);
      expect(otherCopy.getPrisma).not.toBe(getPrisma);
      expect(globalCache[Symbol.for("@finlytics/database/prisma") as typeof PRISMA_GLOBAL_KEY]).toBe(first);
    },
  );

  it("reads the environment on the first call, not at import", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", undefined);
    vi.resetModules();

    const freshModule = await import("../client");

    expect(() => freshModule.getPrisma()).toThrow(/DATABASE_URL: is required/);
    expect(globalCache[PRISMA_GLOBAL_KEY]).toBeUndefined();
  });

  it("refuses to create a client when DEBUG is set in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", UNREACHABLE_URL);
    vi.stubEnv("DEBUG", "prisma:*");

    expect(() => getPrisma()).toThrow(/DEBUG: must be empty in production/);
    expect(globalCache[PRISMA_GLOBAL_KEY]).toBeUndefined();
  });
});
