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
import { node } from "@finlytics/eslint-config/node";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores(
    [
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "packages/database/src/generated/**",
      // Not packages yet. Remove each line when the package is scaffolded (ui in 0.4, broker-sdk in 1.1).
      "packages/ui/**",
      "packages/broker-sdk/**",
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
    files: ["packages/database/**", "apps/api/**", "packages/config/**", "scripts/**", "*.{js,mjs,cjs}"],
    extends: [node],
  },
  {
    // shared's check:pkg smoke scripts load the built package on Node (node:assert, require). Deliberately narrow:
    // everything else in packages/shared, src/** included, keeps the browser-safe `library` rules.
    name: "finlytics/scope/shared-pkg-smoke",
    files: ["packages/shared/test/pkg/**"],
    extends: [node],
    rules: { "no-restricted-globals": "off" },
  },
  prettier, // keep last
);
