import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real Redis: one Testcontainers container from the image pinned in docker-compose.yml for
 * the whole run (test/integration/global-setup.ts). Needs Docker.
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["test/integration/global-setup.ts"],
    testTimeout: 30_000,
    // The first run pulls the image.
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
