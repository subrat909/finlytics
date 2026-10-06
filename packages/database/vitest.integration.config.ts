import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real PostgreSQL + TimescaleDB: one Testcontainers container from the pinned image for
 * the whole run (test/integration/global-setup.ts). Needs Docker. The packaging test imports dist/, so build first;
 * `turbo run test:integration` does that (packages/database/turbo.json).
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["test/integration/global-setup.ts"],
    // The global setup has no timeout of its own: the first run pulls a ~4 GB image, later starts take seconds.
    // A test or hook may create and migrate databases and run Prisma CLI child processes (seconds each).
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Covers the global teardown, which stops and removes the container.
    teardownTimeout: 60_000,
    server: {
      deps: {
        // Load the built package with Node's own loader, the way consumers do, instead of transforming it with Vite.
        external: [/\/packages\/database\/dist\//],
      },
    },
  },
});
