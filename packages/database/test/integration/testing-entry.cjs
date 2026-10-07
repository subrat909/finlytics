// Integration smoke test (CJS): require() the BUILT `./testing` entry through the package's own name, the way apps/api
// (CommonJS) does, start a migrated database with it, list the applied migrations and stop it again.
// testing-entry.int.test.ts runs it as a child process and parses the single JSON line it prints. Needs Docker.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

// The CJS build itself, not the ESM build through Node's require(esm).
const entry = require.resolve("@finlytics/database/testing");
assert.match(entry, /[/\\]dist[/\\]testing\.cjs$/, "require() must resolve to dist/testing.cjs");

const { startTestDatabase } = require("@finlytics/database/testing");
const pg = require("pg");

async function appliedMigrations(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name",
    );
    return rows.map((row) => row.migration_name);
  } finally {
    await client.end();
  }
}

async function main() {
  const database = await startTestDatabase();
  try {
    const migrations = await appliedMigrations(database.databaseUrl);
    // A digest, never the password itself: the test only compares passwords between containers.
    const passwordDigest = createHash("sha256").update(new URL(database.adminUrl).password).digest("hex");
    console.log(JSON.stringify({ entry, migrations, passwordDigest }));
  } finally {
    await database.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
