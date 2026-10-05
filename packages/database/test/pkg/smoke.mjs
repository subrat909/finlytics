// check:pkg smoke test (ESM). Loads the BUILT package through its own name with import(), the way Next.js does.
// Never connects to a database: PR3's integration tests run real queries through both builds.
import assert from "node:assert/strict";

// Nothing may read the environment at import time (plan D9), so import with DATABASE_URL unset.
delete process.env.DATABASE_URL;

assert.match(
  import.meta.resolve("@finlytics/database"),
  /\/dist\/index\.js$/,
  "import() must resolve to the ESM build",
);

const db = await import("@finlytics/database");

assert.equal(typeof db.createPrismaClient, "function", "createPrismaClient is exported");
assert.equal(typeof db.getPrisma, "function", "getPrisma is exported");
assert.equal(db.Exchange.NSE, "NSE", "generated enums are exported");
assert.equal(typeof db.Prisma.Decimal, "function", "the Prisma namespace is exported");
assert.equal("PrismaClient" in db, false, "PrismaClient is type-only: clients come from createPrismaClient");

console.log("ESM smoke test passed: import() loads dist/index.js");
