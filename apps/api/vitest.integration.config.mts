import { defineConfig } from "vitest/config";

/**
 * Integration tests (plan D16): apps built by the production bootstrap, requests through Fastify `inject` (or a real
 * port), against one TimescaleDB and one Redis container for the whole run (test/integration/global-setup.ts). Needs
 * Docker. The build smoke test runs dist/main.js, and the harness loads @finlytics/database/testing from its dist:
 * `turbo run test:integration` builds both first (apps/api/turbo.json).
 */
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ["test/integration/**/*.int.test.ts"],
    environment: "node",
    setupFiles: ["test/setup/reflect-metadata.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    restoreMocks: true,
    // The global setup has no timeout of its own: the first run pulls the images, later starts take seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
    server: {
      deps: {
        // Load the built workspace packages with Node's own loader, the way the api does at runtime.
        external: [/\/packages\/(?:database|shared)\/dist\//],
      },
    },
  },
});
