/**
 * Preset for browser-safe libraries (packages/shared), whose code ships to both the browser (Next.js) and Node
 * (NestJS). Bans Node built-ins and everything from Prisma or @finlytics/database. Applied on top of `base`.
 */
import { builtinModules } from "node:module";

import { ALL_FILES } from "./base.js";

const BROWSER_SAFE = "Library code must stay browser-safe, so it cannot use Node built-ins.";
const NO_PRISMA = "Library code never imports Prisma or @finlytics/database; mirror Prisma enums as Zod schemas.";

/** Bare specifiers ("fs", "fs/promises", ...). Prefix-only modules ("node:test") are caught by the `^node:` pattern. */
const BARE_BUILTINS = builtinModules.filter((name) => !name.startsWith("node:"));

const NODE_GLOBALS = [
  "process",
  "Buffer",
  "global",
  "require",
  "__dirname",
  "__filename",
  "setImmediate",
  "clearImmediate",
];

/** @type {import("eslint").Linter.Config[]} */
export const library = [
  {
    name: "finlytics/library",
    files: ALL_FILES,
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            ...BARE_BUILTINS.map((name) => ({ name, message: BROWSER_SAFE })),
            { name: "@finlytics/database", message: NO_PRISMA },
            { name: "prisma", message: NO_PRISMA },
          ],
          patterns: [
            { regex: "^node:", message: BROWSER_SAFE },
            { group: ["@finlytics/database/*", "@prisma/*", "prisma/*"], message: NO_PRISMA },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...NODE_GLOBALS.map((name) => ({ name, message: `${BROWSER_SAFE} "${name}" is a Node global.` })),
      ],
    },
  },
];
