import { configDefaults, defineConfig } from "vitest/config";

/**
 * Unit tests: no network, no containers (integration tests: vitest.integration.config.mts).
 *
 * Vite 8 transforms TypeScript with Oxc. Nest's dependency injection reads `design:paramtypes`, so Oxc must emit legacy
 * decorators with metadata, as tsc does for the build (plan D1). test/unit/oxc-canary.test.ts fails if it stops.
 */
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/integration/**"],
    setupFiles: ["test/setup/reflect-metadata.ts"],
    environment: "node",
    // vi.stubEnv() changes and vi.spyOn() spies are undone after every test.
    unstubEnvs: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Gated: the code unit tests own. src/infra, src/bootstrap, repositories and controllers are covered by the
      // integration tests instead (plan D16).
      include: ["src/common/**", "src/config/**", "src/modules/**"],
      exclude: ["**/__tests__/**", "**/*.module.ts", "**/dto/**", "**/*.repository.ts", "**/*.controller.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
