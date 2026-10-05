// check:pkg smoke test (CJS). Loads the BUILT package through its own name with require(), the way NestJS does.
// Never connects to a database: PR3's integration tests run real queries through both builds.
const assert = require("node:assert/strict");

// Nothing may read the environment at load time (plan D9), so require with DATABASE_URL unset.
delete process.env.DATABASE_URL;

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

console.log("CJS smoke test passed: require() loads dist/index.cjs");
