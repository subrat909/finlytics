import { afterEach, describe, expect, it, vi } from "vitest";

import { createPrismaClient, getPrisma, PRISMA_GLOBAL_KEY } from "../client";
import type { PrismaClient } from "../generated/client";

/** Syntactically valid but never connected to: no test here runs a query (port 1 refuses connections). */
const UNREACHABLE_URL = "postgresql://finlytics:not-a-secret@127.0.0.1:1/never";

const globalCache = globalThis as typeof globalThis & { [PRISMA_GLOBAL_KEY]?: PrismaClient | undefined };

describe("createPrismaClient", () => {
  it.each(["", "   "])("rejects an empty URL (%j)", (url) => {
    expect(() => createPrismaClient({ url })).toThrow(/non-empty PostgreSQL connection string/);
  });

  it("refuses query logging, at the type level and at runtime", () => {
    // @ts-expect-error -- "query" is deliberately not a DatabaseLogLevel: query logs would leak bound parameters.
    const enableQueryLogging = () => createPrismaClient({ url: UNREACHABLE_URL, log: ["query"] });

    expect(enableQueryLogging).toThrow(/query logging is not allowed/);
  });

  it.each([0, -1, 2.5, Number.NaN])("rejects pool size %d", (poolMax) => {
    expect(() => createPrismaClient({ url: UNREACHABLE_URL, poolMax })).toThrow(RangeError);
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

describe("getPrisma", () => {
  afterEach(async () => {
    await globalCache[PRISMA_GLOBAL_KEY]?.$disconnect();
    Reflect.deleteProperty(globalThis, PRISMA_GLOBAL_KEY);
  });

  it("reuses one instance outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", UNREACHABLE_URL);

    const first = getPrisma();
    const second = getPrisma();

    expect(second).toBe(first);
    expect(globalCache[PRISMA_GLOBAL_KEY]).toBe(first);
  });

  it("keeps the production client in its module instead of on globalThis", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", UNREACHABLE_URL);
    vi.resetModules();
    const { getPrisma: getFreshPrisma } = await import("../client");

    const first = getFreshPrisma();

    expect(getFreshPrisma()).toBe(first);
    expect(globalCache[PRISMA_GLOBAL_KEY]).toBeUndefined();
    await first.$disconnect();
  });

  it("reads the environment on the first call, not at import", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", undefined);
    vi.resetModules();

    const freshModule = await import("../client");

    expect(() => freshModule.getPrisma()).toThrow(/DATABASE_URL is required/);
    expect(globalCache[PRISMA_GLOBAL_KEY]).toBeUndefined();
  });
});
