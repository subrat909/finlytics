// check:pkg smoke test (ESM). Loads the BUILT package through its own name with import(), the way Next.js does.
// Never connects to a database and never starts a container: the integration tests run real queries through both
// builds, and start a database through both builds of the testing entry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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
assert.equal(typeof db.databaseEnvShape.DATABASE_URL.safeParse, "function", "the env shape is exported for the api");
assert.equal(
  db.DatabaseEnvSchema.safeParse({ DATABASE_URL: "mysql://localhost/x" }).success,
  false,
  "the env schema rejects non-postgres URLs",
);
assert.throws(
  () => db.createPrismaClient({ url: "postgresql://u:p@127.0.0.1:1/x", log: [{ level: "query", emit: "event" }] }),
  TypeError,
  "query log definitions are refused",
);
assert.throws(
  () => db.createPrismaClient({ url: "postgresql://u:p@127.0.0.1:1/x?application_name=x" }),
  { name: "TypeError", message: /must not set application_name/ },
  "a URL can't replace the application name",
);

// The testing entry: loads without Docker, starts nothing on import.
assert.match(
  import.meta.resolve("@finlytics/database/testing"),
  /\/dist\/testing\.js$/,
  "import() must resolve the testing entry to the ESM build",
);
const testing = await import("@finlytics/database/testing");

assert.equal(typeof testing.startTestDatabase, "function", "startTestDatabase is exported");
assert.match(testing.TIMESCALE_IMAGE, /^timescale\/timescaledb-ha:pg\d+\.\d+-ts\d+\.\d+\.\d+$/, "the image is pinned");
assert.notEqual(testing.randomPassword(), testing.randomPassword(), "every container gets its own password");
assert.equal(
  JSON.parse(readFileSync(path.join(testing.PACKAGE_ROOT, "package.json"), "utf8")).name,
  "@finlytics/database",
  "PACKAGE_ROOT is packages/database, where the Prisma CLI runs",
);
assert.equal("createPrismaClient" in testing, false, "the testing entry doesn't carry the client");

console.log("ESM smoke test passed: import() loads dist/index.js and dist/testing.js");
