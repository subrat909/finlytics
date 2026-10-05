import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Direct (non-pooled) URL for migrations; runtime client uses DATABASE_URL via PgBouncer.
    url: process.env["DATABASE_DIRECT_URL"] ?? process.env["DATABASE_URL"] ?? "",
  },
});
