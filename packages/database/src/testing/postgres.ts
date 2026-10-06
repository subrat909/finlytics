/**
 * A PostgreSQL + TimescaleDB server for integration tests: one Testcontainers container from the pinned image, with a
 * random password, an app database (migrated by default) and an empty shadow database.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { parseTestDatabaseUrl } from "./database-url";
import { TIMESCALE_IMAGE } from "./images";
import { migrateDeploy } from "./prisma-cli";

/** The container's superuser. Its password is random per container: see {@link randomPassword}. */
const CONTAINER_USER = "finlytics_test";

/** Names of the databases {@link startTestDatabase} creates. */
const APP_DATABASE = "finlytics_it";
const SHADOW_DATABASE = "finlytics_it_shadow";

/** Lowercase, unquoted-identifier style, within PostgreSQL's 63-byte limit. */
const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
}

export interface StartTestDatabaseOptions {
  /** Apply every migration to the app database with `prisma migrate deploy` (target asserted). Defaults to true. */
  readonly migrate?: boolean;
  /** More Docker labels for the container, besides `dev.finlytics.test=database`. */
  readonly labels?: Readonly<Record<string, string>>;
}

export interface StartedTestDatabase {
  /**
   * The container's maintenance database (`postgres`), as its superuser. Connect here only to create databases
   * ({@link createDatabase}).
   */
  readonly adminUrl: string;
  /** The app database, `finlytics_it`: migrated, unless `migrate: false`. */
  readonly databaseUrl: string;
  /** An empty database, `finlytics_it_shadow`, for SHADOW_DATABASE_URL (`prisma migrate diff --from-migrations`). */
  readonly shadowDatabaseUrl: string;
  /** Stops and removes the container and its data. */
  stop(): Promise<void>;
}

/**
 * A fresh random password: 192 bits, URL-safe (base64url), so it needs no escaping in a connection URL. One per
 * container, so a test database's credentials are never a constant that something else on the host could know.
 */
export function randomPassword(): string {
  return randomBytes(24).toString("base64url");
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
 * (so not in a DO block either). The name is checked against a strict pattern first and then quoted by pg.
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

/**
 * Starts a PostgreSQL + TimescaleDB container from {@link TIMESCALE_IMAGE} with a random password, creates the app
 * database (`finlytics_it`) and an empty shadow database (`finlytics_it_shadow`), and applies every migration to the
 * app database unless `migrate` is false. For a Vitest global setup: call `stop()` in its teardown. Testcontainers'
 * Ryuk removes the container if the process dies first.
 *
 * The container's port is published on a random host port. Testcontainers can't narrow the host binding, which is
 * accepted: the container lives for one run, and its password is random.
 *
 * @throws the error that stopped the setup, after stopping the container; an AggregateError of that error and the
 *   stop failure when stopping fails too.
 */
export async function startTestDatabase(options: StartTestDatabaseOptions = {}): Promise<StartedTestDatabase> {
  const { migrate = true, labels = {} } = options;
  const container = await new PostgreSqlContainer(TIMESCALE_IMAGE)
    .withDatabase("postgres")
    .withUsername(CONTAINER_USER)
    .withPassword(randomPassword())
    // TimescaleDB reports telemetry by default; a test run has nothing to report.
    .withCommand(["postgres", "-c", "timescaledb.telemetry_level=off"])
    .withLabels({ ...labels, "dev.finlytics.test": "database" })
    .start();

  try {
    const adminUrl = container.getConnectionUri();
    const app = await createDatabase(adminUrl, APP_DATABASE);
    const shadow = await createDatabase(adminUrl, SHADOW_DATABASE);
    if (migrate) await migrateDeploy({ databaseUrl: app.url, shadowDatabaseUrl: shadow.url });
    return {
      adminUrl,
      databaseUrl: app.url,
      shadowDatabaseUrl: shadow.url,
      stop: async () => {
        await container.stop();
      },
    };
  } catch (error: unknown) {
    // The caller never gets a handle to stop it (a Vitest setup that throws registers no teardown), so stop it here.
    // A failing stop must not hide why the start failed: report both (Ryuk still removes the container).
    try {
      await container.stop();
    } catch (stopError: unknown) {
      throw new AggregateError(
        [error, stopError],
        `startTestDatabase failed (${messageOf(error)}), and stopping its container failed too (${messageOf(stopError)})`,
      );
    }
    throw error;
  }
}

/** An error's message, for a combined error message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
