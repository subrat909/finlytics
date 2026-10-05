/**
 * Database administration for the integration tests: creating databases in the Testcontainers PostgreSQL and running
 * the Prisma CLI against them. Used by global-setup.ts (main Vitest process) and, through harness.ts, by the tests, so
 * it must not import "vitest".
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

/** packages/database. The Prisma CLI runs here: it looks for prisma.config.ts in the working directory only. */
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The pinned `prisma` devDependency's CLI, run with the current Node binary (no shell, no .bin shim). */
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js");

/** This package's executables (tsx for the seed command), as pnpm puts them on PATH for package scripts. */
const PACKAGE_BIN = path.join(PACKAGE_ROOT, "node_modules", ".bin");

/**
 * Host ports the harness never touches. 5432 is the compose default and often a local PostgreSQL that belongs to
 * something else; 5433 is the dev database's port when 5432 is taken. Testcontainers maps the container to a random
 * high port, so a URL on either of these did not come from the container.
 */
const PROTECTED_PORTS: ReadonlySet<string> = new Set(["5432", "5433"]);

/** Lowercase, unquoted-identifier style, within PostgreSQL's 63-byte limit. */
const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

const DEFAULT_TIMEOUT_MS = 120_000;

/** `Datasource "db": PostgreSQL database "x", schema "public" at "host:port"`, printed by `migrate deploy`. */
const DATASOURCE_LINE =
  /^Datasource "db": PostgreSQL database "(?<database>[^"]+)", schema "(?<schema>[^"]+)" at "(?<hostPort>[^"]+)"$/m;

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
}

/** The databases a Prisma CLI command may use. All three URL variables are always set (see prismaEnv). */
export interface PrismaCliTarget {
  /** Becomes DATABASE_DIRECT_URL, and DATABASE_URL unless `pooledDatabaseUrl` is given: the database the command works on. */
  readonly databaseUrl: string;
  /** Becomes SHADOW_DATABASE_URL. Only `migrate diff --from-migrations` and `migrate dev` use it. */
  readonly shadowDatabaseUrl: string;
  /** Becomes DATABASE_URL when it must differ from DATABASE_DIRECT_URL, as with a pooler in production. */
  readonly pooledDatabaseUrl?: string;
}

export interface ProcessResult {
  /** The exit code, or null when the process was killed by a signal (for example on timeout). */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The database a Prisma CLI command reported working on. */
export interface CliDatasource {
  readonly database: string;
  readonly schema: string;
  readonly hostPort: string;
}

/** "host:port/database", for messages. Never the whole URL: it carries the password. */
function describeUrl(url: URL): string {
  return `${url.hostname}:${url.port}${url.pathname}`;
}

function databaseNameOf(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

/**
 * Parses a URL the harness is about to use and rejects anything that can't be the test container: other protocols,
 * a missing port (pg would default to 5432), the protected ports and a missing database name.
 */
export function parseTestDatabaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`Not a PostgreSQL URL: ${url.protocol}`);
  }
  if (url.port === "" || PROTECTED_PORTS.has(url.port)) {
    throw new Error(
      `Refusing to use ${describeUrl(url)}: integration tests run only against the Testcontainers database, ` +
        `never on port 5432 or 5433 and never without an explicit port`,
    );
  }
  if (databaseNameOf(url) === "") throw new Error(`No database name in ${describeUrl(url)}`);
  return url;
}

/** Runs a process without a shell and collects its output. Resolves on exit, whatever the exit code. */
export function runProcess(
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly timeoutMs?: number },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/**
 * The environment of a Prisma CLI child process. prisma.config.ts prefers DATABASE_DIRECT_URL over DATABASE_URL, and
 * loads the root .env without override: only variables that are already set win. Setting all three keeps every URL
 * in .env (the dev database) out of the command (plan D7); `extraEnv` can never replace them. PATH starts with this
 * package's node_modules/.bin, as under `pnpm run`, so the seed command (`tsx prisma/seed.ts`) resolves even when
 * Vitest was started some other way.
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
 * Runs the Prisma CLI in packages/database against the target databases, after checking that every URL belongs to the
 * test container. Resolves with the exit code and output; the caller decides what counts as success.
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
  return runProcess(process.execPath, [PRISMA_CLI, ...args], { cwd: PACKAGE_ROOT, env: prismaEnv(target, extraEnv) });
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
      `prisma migrate deploy failed on ${describeUrl(expected)} (exit ${String(result.exitCode)}):\n${output}`,
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

/** A unique, valid database name: `<prefix>_<12 hex chars>`. */
export function uniqueDatabaseName(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Creates an empty database next to the admin database and returns its URL (same server and credentials). It is a
 * copy of template1, which in the TimescaleDB image already has the timescaledb and timescaledb_toolkit extensions.
 *
 * Connects with `pg` rather than Prisma: CREATE DATABASE takes no bind parameters and can't run inside a transaction
 * (so not in a DO block either). The name is checked against DATABASE_NAME first and then quoted by pg.
 */
export async function createDatabase(adminUrl: string, name: string): Promise<TestDatabase> {
  if (!DATABASE_NAME.test(name)) throw new Error(`Invalid test database name: ${JSON.stringify(name)}`);
  const admin = parseTestDatabaseUrl(adminUrl);

  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }

  const url = new URL(admin.href);
  url.pathname = `/${name}`;
  return { name, url: url.href };
}
