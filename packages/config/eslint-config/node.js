/**
 * Preset for code that runs on Node (packages/database, apps/api, repo tooling): Node globals, and built-ins
 * imported through the `node:` protocol so they can never be confused with npm packages. Applied on top of `base`.
 */
import { builtinModules } from "node:module";
import globals from "globals";

import { ALL_FILES } from "./base.js";

/** Bare specifiers ("fs", "fs/promises", ...). Prefix-only modules ("node:test") have no bare form. */
const BARE_BUILTINS = builtinModules.filter((name) => !name.startsWith("node:"));

/** @type {import("eslint").Linter.Config[]} */
export const node = [
  {
    name: "finlytics/node",
    files: ALL_FILES,
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: BARE_BUILTINS.map((name) => ({
            name,
            message: `Use the node: protocol: import from "node:${name}".`,
          })),
        },
      ],
    },
  },
];
