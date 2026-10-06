import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";
import { describe, expect, inject, it } from "vitest";

import type * as Testing from "../../src/testing/index";
import { PACKAGE_ROOT, runProcess } from "../../src/testing/index";

/** The entry apps/api's integration setup imports; from inside packages/database it resolves through `exports`. */
const TESTING_ENTRY = "@finlytics/database/testing";

const CJS_SMOKE = path.join(PACKAGE_ROOT, "test", "integration", "testing-entry.cjs");

/** Migration folder names, in the order Prisma applies them. */
function migrationFolders(): string[] {
  return readdirSync(path.join(PACKAGE_ROOT, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** SHA-256 of a URL's password: enough to tell passwords apart without handling them. */
function passwordDigest(url: string): string {
  return createHash("sha256").update(new URL(url).password).digest("hex");
}

/** The JSON on the last line of a child's stdout, or undefined, so a failed child shows its exit code and stderr. */
function lastJsonLine(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    return undefined;
  }
}

async function query<T>(url: string, sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T & pg.QueryResultRow>(sql)).rows;
  } finally {
    await client.end();
  }
}

describe("@finlytics/database/testing", () => {
  it("starts a migrated database through the ./testing entry of both builds", { timeout: 240_000 }, async () => {
    // ESM: import() resolves the `import` condition to dist/testing.js, which Node loads itself
    // (vitest.integration.config.ts keeps dist/ external to Vite).
    const esmEntry = import.meta.resolve(TESTING_ENTRY);
    const esm = (await import(/* @vite-ignore */ TESTING_ENTRY)) as typeof Testing;
    const startedThroughEsm = async () => {
      const database = await esm.startTestDatabase();
      try {
        return {
          migrations: (
            await query<{ name: string }>(
              database.databaseUrl,
              "SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1",
            )
          ).map((row) => row.name),
          shadowTables: await query<{ count: number }>(
            database.shadowDatabaseUrl,
            "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
          ),
          passwordDigest: passwordDigest(database.adminUrl),
        };
      } finally {
        await database.stop();
      }
    };

    // CJS: a separate Node process require()s dist/testing.cjs (the script asserts that), concurrently.
    const [esmResult, cjs] = await Promise.all([
      startedThroughEsm(),
      runProcess(process.execPath, [CJS_SMOKE], { cwd: PACKAGE_ROOT, env: process.env, timeoutMs: 180_000 }),
    ]);
    const cjsResult = lastJsonLine(cjs.stdout) as { passwordDigest?: string } | undefined;

    expect(esmEntry).toBe(pathToFileURL(path.join(PACKAGE_ROOT, "dist", "testing.js")).href);
    expect(esmResult.migrations).toEqual(migrationFolders());
    expect(esmResult.shadowTables).toEqual([{ count: 0 }]);
    expect(cjs.exitCode, cjs.stderr).toBe(0);
    expect(cjsResult).toEqual({
      entry: path.join(PACKAGE_ROOT, "dist", "testing.cjs"),
      migrations: migrationFolders(),
      passwordDigest: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
    // A random password per container: the two started here and the one this suite runs on all differ.
    const digests = [esmResult.passwordDigest, cjsResult?.passwordDigest, passwordDigest(inject("adminDatabaseUrl"))];
    expect(new Set(digests).size).toBe(3);
  });
});
