import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type * as DatabasePackage from "../../src/index";
import type { PrismaClient } from "../../src/index";
import { PACKAGE_ROOT, runProcess } from "./database-admin";
import { sharedDatabaseUrl } from "./harness";

/** The package's own name: from inside packages/database it resolves through package.json `exports` (self-reference). */
const PACKAGE_NAME = "@finlytics/database";

const CJS_SMOKE = path.join(PACKAGE_ROOT, "test", "integration", "cjs-smoke.cjs");

/** The JSON on the last line of a child's stdout, or undefined, so a failed child shows its exit code and stderr. */
function lastJsonLine(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    return undefined;
  }
}

/** The same two queries as cjs-smoke.cjs: one raw, one through a model. Disconnects afterwards. */
async function smokeQueries(prisma: PrismaClient): Promise<{ database: string | undefined; missingUser: unknown }> {
  try {
    const rows = await prisma.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
    const missingUser = await prisma.user.findUnique({ where: { id: "esm-smoke-no-such-user" } });
    return { database: rows[0]?.database, missingUser };
  } finally {
    await prisma.$disconnect();
  }
}

describe("packaging", () => {
  it("queries the database through both the ESM and the CJS build", async () => {
    const url = sharedDatabaseUrl();
    const database = decodeURIComponent(new URL(url).pathname.slice(1));

    // ESM: import() resolves the `import` condition to dist/index.js, which Node loads itself
    // (vitest.integration.config.ts keeps dist/ external to Vite). Types come from the source; check:pkg covers dist.
    const esmEntry = import.meta.resolve(PACKAGE_NAME);
    const esm = (await import(/* @vite-ignore */ PACKAGE_NAME)) as typeof DatabasePackage;
    const esmResult = await smokeQueries(esm.createPrismaClient({ url, poolMax: 1, log: [] }));

    // CJS: a separate Node process require()s dist/index.cjs (the script asserts that) and gets only DATABASE_URL.
    const cjs = await runProcess(process.execPath, [CJS_SMOKE], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      timeoutMs: 60_000,
    });
    const cjsResult = lastJsonLine(cjs.stdout);

    expect(esmEntry).toBe(pathToFileURL(path.join(PACKAGE_ROOT, "dist", "index.js")).href);
    expect(esmResult).toEqual({ database, missingUser: null });
    expect(cjs.exitCode, cjs.stderr).toBe(0);
    expect(cjsResult).toEqual({ entry: path.join(PACKAGE_ROOT, "dist", "index.cjs"), database, missingUser: null });
  });
});
