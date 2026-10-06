/**
 * The repo's only ESLint config (plan D3): @finlytics/eslint-config presets, scoped by globs. Packages never add their
 * own config. A package's `lint` script is `eslint . --max-warnings=0`, and ESLint 9 finds this file by searching upward
 * from the working directory, so turbo, lint-staged and the editor hook all lint with the same rules.
 *
 * To lint a new package: give it a tsconfig.json whose `include` covers every TS file it lints, and a `lint` script.
 * Its glob below decides which preset applies on top of `base`.
 */
import { base, prettier } from "@finlytics/eslint-config/base";
import { library } from "@finlytics/eslint-config/library";
import { nest } from "@finlytics/eslint-config/nest";
import { next } from "@finlytics/eslint-config/next";
import { node } from "@finlytics/eslint-config/node";
import { reactLibrary } from "@finlytics/eslint-config/react";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores(
    [
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      // Storybook and Playwright output (packages/ui).
      "**/storybook-static/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/blob-report/**",
      "**/.vitest/**",
      "packages/database/src/generated/**",
      // Next.js output and its generated declarations (apps/web).
      "**/.next/**",
      "**/next-env.d.ts",
    ],
    "finlytics/ignores",
  ),
  base({ tsconfigRootDir: import.meta.dirname }),
  {
    name: "finlytics/scope/library",
    files: ["packages/shared/**"],
    extends: [library],
  },
  {
    name: "finlytics/scope/node",
    // broker-sdk (1.1) is Node only: ioredis, and the browser never talks to a broker (broker.md).
    files: [
      "packages/database/**",
      "packages/broker-sdk/**",
      "apps/api/**",
      "packages/config/**",
      "scripts/**",
      "*.{js,mjs,cjs}",
    ],
    extends: [node],
  },
  {
    // The NestJS api: Node globals come from the node scope above; this adds no-console, empty @Module() classes and
    // the api's bans (Prisma only through @finlytics/database, process.env only in src/config, the unscoped Prisma
    // client only in its allowlisted folders). Its restrict() objects come later, so they decide for apps/api.
    name: "finlytics/scope/nest",
    files: ["apps/api/**"],
    extends: [nest],
  },
  {
    // shared's check:pkg smoke scripts load the built package on Node (node:assert, require). Deliberately narrow:
    // everything else in packages/shared, src/** included, keeps the browser-safe `library` rules. The node preset's
    // restrict() object replaces all of the library preset's no-restricted-* rules for these files.
    name: "finlytics/scope/shared-pkg-smoke",
    files: ["packages/shared/test/pkg/**"],
    extends: [node],
  },
  {
    // packages/ui code that runs in the browser: components, hooks, unit tests (jsdom) and the Storybook preview.
    name: "finlytics/scope/ui",
    files: ["packages/ui/src/**", "packages/ui/.storybook/{preview.tsx,vitest.setup.ts,design-checks.ts}"],
    extends: [reactLibrary],
  },
  {
    // packages/ui tooling that runs on Node: Vite/Vitest/Playwright configs, Storybook's main.ts, and the token,
    // package and visual tests.
    name: "finlytics/scope/ui-tooling",
    files: [
      "packages/ui/*.config.ts",
      "packages/ui/.storybook/main.ts",
      "packages/ui/test/**",
      "packages/ui/scripts/**",
    ],
    extends: [node],
  },
  {
    // The Next.js app (phase 0.6): React and the Next plugin, browser and Node globals, and the app's bans (Prisma only
    // through @finlytics/database, process.env only in src/lib/env.ts and the configs, no database in the proxy).
    // `rootDir` tells the Next plugin where the app is. Absolute, because the plugin resolves it against the working
    // directory, which is the repo root for `pnpm lint` but apps/web for its own `lint` script.
    name: "finlytics/scope/web",
    files: ["apps/web/**"],
    extends: [next],
    settings: { next: { rootDir: `${import.meta.dirname}/apps/web/` } },
  },
  prettier, // keep last
);
