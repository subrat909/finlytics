import { defineConfig } from "vitest/config";

/**
 * Unit and property tests: pure functions, no network. `pnpm test` runs them with coverage, and the thresholds below are
 * the CI gate for this package (plan §7: shared ≥ 90%).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
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
