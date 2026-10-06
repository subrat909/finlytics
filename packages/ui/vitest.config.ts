import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import type { TestProjectInlineConfiguration } from "vitest/config";

// With its extension, as Vite's native config loader (planned default) requires.
import viteConfig from "./vite.config.ts";

const STORYBOOK_CONFIG_DIR = fileURLToPath(new URL("./.storybook", import.meta.url));

/**
 * Every story as a test in Chromium (plan D15): it renders, its play function passes, addon-a11y finds no violation
 * (colour contrast included) and the preview's afterEach design check passes. One project per environment, through the
 * plugin's `initialGlobals` (the theme toolbar and the viewport):
 * - `storybook`: every story, light theme, 1200 × 900;
 * - `storybook-dark`: every story again in the dark theme;
 * - `storybook-360`: the `responsive` stories at 360 px, where their play functions check for horizontal scroll.
 */
function storybookProject(
  name: string,
  options: Parameters<typeof storybookTest>[0] = {},
): TestProjectInlineConfiguration {
  return {
    plugins: [storybookTest({ configDir: STORYBOOK_CONFIG_DIR, storybookUrl: "http://127.0.0.1:6006", ...options })],
    test: {
      name,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
      },
    },
  };
}

/**
 * Test projects (plan D15). Inline projects inherit this root config (Vitest 5), plugins included.
 * - `unit`: components, hooks and lib in jsdom, with Testing Library and axe. `pnpm test` runs it with coverage.
 * - `node`: package, token and contrast tests that read files; no DOM.
 * - `storybook*`: the stories in Chromium (`pnpm test:storybook`), see storybookProject().
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Globals stubbed with vi.stubGlobal() (matchMedia in theme tests) are restored after every test.
      unstubGlobals: true,
      projects: [
        {
          test: {
            name: "unit",
            environment: "jsdom",
            include: ["src/**/*.test.{ts,tsx}"],
            setupFiles: ["./src/test/setup.ts"],
          },
        },
        {
          test: {
            name: "node",
            environment: "node",
            include: ["test/**/*.test.ts"],
          },
        },
        storybookProject("storybook"),
        storybookProject("storybook-dark", { initialGlobals: { theme: "dark" } }),
        storybookProject("storybook-360", {
          initialGlobals: { viewport: { value: "mobile360", isRotated: false } },
          tags: { include: ["responsive"] },
        }),
      ],
      coverage: {
        provider: "v8",
        // The unit project's gate (plan D15, ≥ 80%). Stories, tests and test helpers aren't measured.
        include: ["src/{components,lib,hooks}/**/*.{ts,tsx}"],
        exclude: ["**/*.stories.tsx", "**/__tests__/**"],
        reporter: ["text", "json-summary"],
        thresholds: {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  }),
);
