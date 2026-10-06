// check:pkg smoke test (CJS). Loads the BUILT package through its own name with require(), the way NestJS does.
// Never connects to a database and never starts a container: the integration tests run real queries through both
// builds, and start a database through both builds of the testing entry.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

// Nothing may read the environment at load time (plan D9), so require with DATABASE_URL unset.
delete process.env.DATABASE_URL;

/** Whether any module loaded so far comes from testcontainers. */
const testcontainersLoaded = () => Object.keys(require.cache).some((file) => file.includes("testcontainers"));

// The CJS build itself, not the ESM build through Node's require(esm).
assert.match(
  require.resolve("@finlytics/database"),
  /[/\\]dist[/\\]index\.cjs$/,
  "require() must resolve to dist/index.cjs",
);

const db = require("@finlytics/database");

assert.equal(typeof db.createPrismaClient, "function", "createPrismaClient is exported");
assert.equal(typeof db.getPrisma, "function", "getPrisma is exported");
assert.equal(db.Exchange.NSE, "NSE", "generated enums are exported");
assert.equal(typeof db.Prisma.Decimal, "function", "the Prisma namespace is exported");
assert.equal("PrismaClient" in db, false, "PrismaClient is type-only: clients come from createPrismaClient");
assert.equal(typeof db.checkDatabaseEnv, "function", "the env check is exported for the api");
assert.throws(
  () => db.loadDatabaseEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/x?query_timeout=1" }),
  /DATABASE_URL: must not set query_timeout/,
  "the env schema rejects a client-side query_timeout",
);
assert.throws(
  () => db.createPrismaClient({ url: "postgresql://u:p@127.0.0.1:1/x", statementTimeoutMs: 12_000 }),
  { name: "RangeError", message: /statementTimeoutMs \(12000\) must be below transaction\.timeoutMs \(12000\)/ },
  "the statement timeout must be below the transaction timeout",
);
assert.equal(testcontainersLoaded(), false, "the client entry never loads testcontainers");

// The testing entry: loads without Docker, starts nothing on load.
assert.match(
  require.resolve("@finlytics/database/testing"),
  /[/\\]dist[/\\]testing\.cjs$/,
  "require() must resolve the testing entry to dist/testing.cjs",
);
const testing = require("@finlytics/database/testing");

assert.equal(typeof testing.startTestDatabase, "function", "startTestDatabase is exported");
assert.match(testing.TIMESCALE_IMAGE, /^timescale\/timescaledb-ha:pg\d+\.\d+-ts\d+\.\d+\.\d+$/, "the image is pinned");
assert.notEqual(testing.randomPassword(), testing.randomPassword(), "every container gets its own password");
assert.equal(
  JSON.parse(readFileSync(path.join(testing.PACKAGE_ROOT, "package.json"), "utf8")).name,
  "@finlytics/database",
  "PACKAGE_ROOT is packages/database, where the Prisma CLI runs",
);
assert.equal("createPrismaClient" in testing, false, "the testing entry doesn't carry the client");

console.log("CJS smoke test passed: require() loads dist/index.cjs and dist/testing.cjs");
