// Integration smoke test (CJS): require() the BUILT package through its own name, the way NestJS does, and run real
// queries against the database in DATABASE_URL. packaging.int.test.ts runs it as a child process with the Testcontainers
// URL and parses the single JSON line it prints. Not part of check:pkg, which never connects to a database.
const assert = require("node:assert/strict");

const url = process.env.DATABASE_URL;
if (url === undefined || url === "") {
  console.error("cjs-smoke: set DATABASE_URL to the test database");
  process.exit(2);
}

// The CJS build itself, not the ESM build through Node's require(esm).
const entry = require.resolve("@finlytics/database");
assert.match(entry, /[/\\]dist[/\\]index\.cjs$/, "require() must resolve to dist/index.cjs");

const { createPrismaClient } = require("@finlytics/database");

async function main() {
  const prisma = createPrismaClient({ url, poolMax: 1, log: [] });
  try {
    // One raw query and one model query: both paths through the bundled client and @prisma/adapter-pg.
    const [row] = await prisma.$queryRaw`SELECT current_database() AS database`;
    const missingUser = await prisma.user.findUnique({ where: { id: "cjs-smoke-no-such-user" } });
    console.log(JSON.stringify({ entry, database: row.database, missingUser }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
