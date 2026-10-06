import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cliDatasource,
  PACKAGE_ROOT,
  parseTestDatabaseUrl,
  randomPassword,
  startTestDatabase,
  uniqueDatabaseName,
} from "../testing/index";

/**
 * The passwords each container was configured with, and what `start()` does. No container is ever started: by default
 * `start()` fails; a test can make it resolve with a fake started container instead.
 */
const containers = vi.hoisted(() => ({
  passwords: [] as string[],
  start: (): Promise<unknown> => Promise.reject(new Error("no Docker in unit tests")),
}));

vi.mock("@testcontainers/postgresql", () => ({
  PostgreSqlContainer: class {
    withDatabase() {
      return this;
    }
    withUsername() {
      return this;
    }
    withPassword(password: string) {
      containers.passwords.push(password);
      return this;
    }
    withCommand() {
      return this;
    }
    withLabels() {
      return this;
    }
    start(): Promise<unknown> {
      return containers.start();
    }
  },
}));

/** A started container whose URL is on `port`, as Testcontainers' `start()` would resolve it, with a `stop` spy. */
function fakeStartedContainer(port: number, stop: () => Promise<void>) {
  return {
    getConnectionUri: () => `postgresql://finlytics_test:not-a-secret@localhost:${String(port)}/postgres`,
    stop: vi.fn(stop),
  };
}

describe("startTestDatabase", () => {
  it("generates a different password for every test database", async () => {
    await expect(startTestDatabase()).rejects.toThrow("no Docker in unit tests");
    await expect(startTestDatabase({ migrate: false })).rejects.toThrow("no Docker in unit tests");

    expect(containers.passwords).toHaveLength(2);
    expect(new Set(containers.passwords).size).toBe(2);
    // 192 random bits, URL-safe, so a connection URL needs no escaping.
    for (const password of containers.passwords) expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  describe("when the setup fails after the container started", () => {
    const realStart = containers.start;
    afterEach(() => {
      containers.start = realStart;
    });

    it("stops the container and rejects with the setup's own error", async () => {
      // A URL on the compose port: createDatabase refuses it before connecting anywhere.
      const container = fakeStartedContainer(5432, () => Promise.resolve());
      containers.start = () => Promise.resolve(container);

      await expect(startTestDatabase()).rejects.toThrow("Refusing to use");
      expect(container.stop).toHaveBeenCalledOnce();
    });

    it("reports both errors when stopping the container fails too", async () => {
      const container = fakeStartedContainer(5433, () => Promise.reject(new Error("docker: no such container")));
      containers.start = () => Promise.resolve(container);

      const error: unknown = await startTestDatabase({ migrate: false }).catch((reason: unknown) => reason);

      expect(container.stop).toHaveBeenCalledOnce();
      expect(error).toBeInstanceOf(AggregateError);
      const { errors, message } = error as AggregateError;
      expect(errors.map((cause: unknown) => (cause as Error).message)).toEqual([
        expect.stringContaining("Refusing to use localhost:5433/postgres"),
        "docker: no such container",
      ]);
      expect(message).toMatch(/Refusing to use .*stopping its container failed too \(docker: no such container\)/);
      expect(message).not.toContain("not-a-secret");
    });
  });
});

describe("randomPassword", () => {
  it("never repeats and never needs escaping in a URL", () => {
    const passwords = Array.from({ length: 200 }, () => randomPassword());

    expect(new Set(passwords).size).toBe(passwords.length);
    for (const password of passwords) expect(encodeURIComponent(password)).toBe(password);
  });
});

describe("parseTestDatabaseUrl", () => {
  it("accepts the container's URL on a random host port", () => {
    expect(parseTestDatabaseUrl("postgres://finlytics_test:pw@localhost:55123/finlytics_it").pathname).toBe(
      "/finlytics_it",
    );
  });

  it.each([
    ["the dev database's port", "postgresql://finlytics:finlytics@localhost:5433/finlytics", /port 5432 or 5433/],
    ["the compose default port", "postgresql://finlytics:finlytics@localhost:5432/finlytics", /port 5432 or 5433/],
    ["no port (pg would use 5432)", "postgresql://finlytics:finlytics@localhost/finlytics", /explicit port/],
    ["another protocol", "mysql://root:pw@localhost:55123/finlytics", /Not a PostgreSQL URL/],
    ["no database name", "postgres://finlytics_test:pw@localhost:55123/", /No database name/],
  ])("refuses %s", (_, url, message) => {
    expect(() => parseTestDatabaseUrl(url)).toThrow(message);
  });

  it("names host, port and database in its errors, never the password", () => {
    let message = "";
    try {
      parseTestDatabaseUrl("postgresql://finlytics:s3cret-password@localhost:5433/finlytics");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("localhost:5433/finlytics");
    expect(message).not.toContain("s3cret-password");
  });
});

describe("uniqueDatabaseName", () => {
  it("adds a random suffix that keeps the name a plain identifier", () => {
    const names = Array.from({ length: 50 }, () => uniqueDatabaseName("seed"));

    for (const name of names) expect(name).toMatch(/^seed_[0-9a-f]{12}$/);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("cliDatasource", () => {
  it("reads the database a Prisma CLI command reported", () => {
    const output =
      'Prisma schema loaded\nDatasource "db": PostgreSQL database "finlytics_it", schema "public" at "localhost:55123"\n';

    expect(cliDatasource(output)).toEqual({ database: "finlytics_it", schema: "public", hostPort: "localhost:55123" });
    expect(cliDatasource("no datasource line")).toBeUndefined();
  });
});

describe("PACKAGE_ROOT", () => {
  it("is packages/database, where prisma.config.ts and the migrations live", () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { name?: string };

    expect(manifest.name).toBe("@finlytics/database");
    expect(readFileSync(path.join(PACKAGE_ROOT, "prisma.config.ts"), "utf8")).toContain("prisma/migrations");
  });
});
