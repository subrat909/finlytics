/**
 * The Prisma CLI, run against a test database: `prisma migrate deploy`, `prisma db seed`, `prisma migrate diff`.
 * Always in packages/database (prisma.config.ts and the migrations live there), with every database URL set
 * explicitly, so nothing from the repo-root .env (the dev database) can apply.
 */
import { createRequire } from "node:module";
import path from "node:path";

import { databaseNameOf, describeTestDatabaseUrl, parseTestDatabaseUrl } from "./database-url";
import { runProcess } from "./process";
import type { ProcessResult } from "./process";

// Not named `require`: the CJS build runs this module inside a function whose parameter has that name.
const requireHere = createRequire(import.meta.url);

/**
 * packages/database. The Prisma CLI runs here: it looks for prisma.config.ts in the working directory only. Found
 * through the package's own name, so it is the same from src/testing (tests run from source) and from dist (the
 * built `./testing` entry, ESM or CJS, wherever it is imported from).
 */
export const PACKAGE_ROOT = path.dirname(requireHere.resolve("@finlytics/database/package.json"));

/** This package's executables (tsx for the seed command), as pnpm puts them on PATH for package scripts. */
const PACKAGE_BIN = path.join(PACKAGE_ROOT, "node_modules", ".bin");

/** `Datasource "db": PostgreSQL database "x", schema "public" at "host:port"`, printed by `migrate deploy`. */
const DATASOURCE_LINE =
  /^Datasource "db": PostgreSQL database "(?<database>[^"]+)", schema "(?<schema>[^"]+)" at "(?<hostPort>[^"]+)"$/m;

/** The databases a Prisma CLI command may use. All three URL variables are always set (see prismaEnv). */
export interface PrismaCliTarget {
  /** Becomes DATABASE_DIRECT_URL, and DATABASE_URL unless `pooledDatabaseUrl` is given: the database the command works on. */
  readonly databaseUrl: string;
  /** Becomes SHADOW_DATABASE_URL. Only `migrate diff --from-migrations` and `migrate dev` use it. */
  readonly shadowDatabaseUrl: string;
  /** Becomes DATABASE_URL when it must differ from DATABASE_DIRECT_URL, as with a pooler in production. */
  readonly pooledDatabaseUrl?: string;
}

/** The database a Prisma CLI command reported working on. */
export interface CliDatasource {
  readonly database: string;
  readonly schema: string;
  readonly hostPort: string;
}

/**
 * The environment of a Prisma CLI child process. prisma.config.ts prefers DATABASE_DIRECT_URL over DATABASE_URL, and
 * loads the root .env without override: only variables that are already set win. Setting all three keeps every URL
 * in .env (the dev database) out of the command; `extraEnv` can never replace them. PATH starts with this package's
 * node_modules/.bin, as under `pnpm run`, so the seed command (`tsx prisma/seed.ts`) resolves however the tests were
 * started.
 */
function prismaEnv(target: PrismaCliTarget, extraEnv: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    PATH: [PACKAGE_BIN, process.env["PATH"]]
      .filter((entry) => entry !== undefined && entry !== "")
      .join(path.delimiter),
    DATABASE_URL: target.pooledDatabaseUrl ?? target.databaseUrl,
    DATABASE_DIRECT_URL: target.databaseUrl,
    SHADOW_DATABASE_URL: target.shadowDatabaseUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    CHECKPOINT_DISABLE: "1",
  };
}

/**
 * Runs the pinned Prisma CLI (this package's `prisma` devDependency, with the current Node binary: no shell, no .bin
 * shim) in packages/database against the target databases, after checking that every URL belongs to the test
 * container. Resolves with the exit code and output; the caller decides what counts as success.
 *
 * @param extraEnv more variables for the child (e.g. TZ). The database URLs always come from `target`.
 */
export async function runPrismaCli(
  args: readonly string[],
  target: PrismaCliTarget,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<ProcessResult> {
  parseTestDatabaseUrl(target.databaseUrl);
  parseTestDatabaseUrl(target.shadowDatabaseUrl);
  if (target.pooledDatabaseUrl !== undefined) parseTestDatabaseUrl(target.pooledDatabaseUrl);
  const cli = requireHere.resolve("prisma/build/index.js", { paths: [PACKAGE_ROOT] });
  return runProcess(process.execPath, [cli, ...args], { cwd: PACKAGE_ROOT, env: prismaEnv(target, extraEnv) });
}

/** The `Datasource "db": ...` line of a Prisma CLI command's output, if it printed one. */
export function cliDatasource(output: string): CliDatasource | undefined {
  const groups = DATASOURCE_LINE.exec(output)?.groups;
  const database = groups?.["database"];
  const schema = groups?.["schema"];
  const hostPort = groups?.["hostPort"];
  if (database === undefined || schema === undefined || hostPort === undefined) return undefined;
  return { database, schema, hostPort };
}

/**
 * `prisma migrate deploy` on the target database. Never `migrate dev`: it turns interactive when it finds drift.
 *
 * Throws unless the command succeeded and its Datasource line names the target database, schema `public`, at the
 * target host:port. That proves prisma.config.ts resolved the URL passed here and not one from the root .env.
 *
 * @returns the command's output (stdout, then stderr).
 */
export async function migrateDeploy(target: PrismaCliTarget): Promise<string> {
  const expected = parseTestDatabaseUrl(target.databaseUrl);
  const result = await runPrismaCli(["migrate", "deploy"], target);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy failed on ${describeTestDatabaseUrl(expected)} (exit ${String(result.exitCode)}):\n${output}`,
    );
  }

  const actual = cliDatasource(output);
  const wanted: CliDatasource = {
    database: databaseNameOf(expected),
    schema: "public",
    hostPort: `${expected.hostname}:${expected.port}`,
  };
  if (actual?.database !== wanted.database || actual.schema !== wanted.schema || actual.hostPort !== wanted.hostPort) {
    const seen =
      actual === undefined ? "no Datasource line" : `${actual.hostPort}/${actual.database} (${actual.schema})`;
    throw new Error(`prisma migrate deploy targeted ${seen}, expected ${wanted.hostPort}/${wanted.database} (public)`);
  }
  return output;
}
