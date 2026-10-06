import { configDefaults, defineConfig } from "vitest/config";

/**
 * Unit, property and contract tests: no network, no Redis (MemoryRateLimiter, PaperAdapter). `pnpm test` runs them with
 * coverage, and the thresholds below are the CI gate for this package (testing.md: broker-sdk ≥ 90%). The Redis
 * integration tests use vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/integration/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Test code, including the contract suite that 1.2 and 1.3 reuse.
      exclude: ["src/**/__tests__/**"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
