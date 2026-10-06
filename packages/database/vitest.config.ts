import { configDefaults, defineConfig } from "vitest/config";

/** Unit tests: no database, no network. Integration tests (Testcontainers) use vitest.integration.config.ts. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/integration/**"],
    environment: "node",
    // vi.stubEnv() changes are undone after every test, so env-dependent tests can't leak into each other.
    unstubEnvs: true,
  },
});
