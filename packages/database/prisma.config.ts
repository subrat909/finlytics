import path from "node:path";

import { config } from "dotenv";
import { defineConfig } from "prisma/config";

import { resolveCliDatabaseUrl } from "./src/env";

// Prisma 7 does not load .env itself, and the repo has one .env at the root. Variables that are already set win
// (no override), so CI and the Testcontainers harness can point every command at another database.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const shadowDatabaseUrl = process.env["SHADOW_DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // DATABASE_DIRECT_URL, else DATABASE_URL: migrations need a direct (non-pooled) connection, and the seed resolves
    // its database the same way. Never throws (unlike Prisma's env() helper), so `prisma generate` works in CI.
    url: resolveCliDatabaseUrl(),
    // Required by `prisma migrate diff --from-migrations` (the drift check). Without it, `migrate dev` creates and
    // drops a temporary shadow database. Spread conditionally: exactOptionalPropertyTypes forbids `undefined`.
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
