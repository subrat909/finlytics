import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const SRC = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Unit tests (plan "Tests"): `*.test.tsx` run in jsdom with Testing Library and axe; `*.test.ts` run on Node (auth
 * helpers, env, proxy, api client). The e2e suite (e2e/, Playwright) is separate: `pnpm test:e2e`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": SRC } },
  test: {
    // next-auth imports "next/server" without an extension, which Node's ESM loader can't resolve (next has no exports
    // map); Vite resolves it when it processes the package.
    server: { deps: { inline: ["next-auth"] } },
    unstubGlobals: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/__tests__/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/__tests__/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/{lib,stores,hooks,components,features}/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "src/test/**"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
