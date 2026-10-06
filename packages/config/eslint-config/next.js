/**
 * Preset for the Next.js app (apps/web, plan phase-0-web-bootstrap W14), applied on top of `base`.
 *
 * - `react` (React, hooks with exhaustive-deps as an error, jsx-a11y strict), plus `@next/eslint-plugin-next`'s
 *   recommended and core-web-vitals rules, every one raised to an error (the repo lints with --max-warnings=0 anyway).
 * - Browser and Node globals: the app has both server and client code.
 * - No `style` prop on DOM elements (tokens and utilities only; the CSP has no 'unsafe-inline' for styles).
 * - Restriction sets (./restrictions.js), composed in one restrict() call:
 *   - NODE_PROTOCOL: Node built-ins through `node:` only.
 *   - DETERMINISTIC_FORMATTING: no `Intl`/`toLocale*String` (server and browser render differently: hydration
 *     mismatches); format with @finlytics/shared's helpers.
 *   - REACT_PERF: lucide icons by name only.
 *   - WEB_IMPORTS: Prisma only through @finlytics/database, @finlytics packages only through their exports, Radix only
 *     through the unified `radix-ui` package.
 *   - NO_PROCESS_ENV: configuration through src/lib/env.ts (validated), except in that file, the configs, the proxy
 *     and the e2e suite.
 *   - NO_DATABASE (src/proxy.ts only): the proxy runs before every request and checks only the cookie's presence.
 *
 * Root-config usage: `{ files: ["apps/web/**"], extends: [next], settings: { next: { rootDir: <absolute path> } } }`.
 * Sub-globs start with `**\/` (see ./restrictions.js).
 */
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

import { ALL_FILES } from "./base.js";
import { react } from "./react.js";
import { DETERMINISTIC_FORMATTING, NODE_PROTOCOL, REACT_PERF, defineRestrictionSet, restrict } from "./restrictions.js";

const PRISMA_MESSAGE =
  "Import Prisma from @finlytics/database: its client factory sets the pool and statement timeouts and refuses query " +
  "logging.";
const DEEP_IMPORT_MESSAGE = "Import @finlytics packages through their exports map, never a src/ or dist/ path.";
const RADIX_MESSAGE = 'Import Radix primitives from the unified "radix-ui" package.';
const PROCESS_ENV_MESSAGE =
  "Read configuration through getWebEnv() (src/lib/env.ts), which validates it once; process.env is read only there, " +
  "in the configs, the proxy and the e2e suite.";
const PROXY_DATABASE_MESSAGE =
  "The proxy runs before every request and only checks that a session cookie is present; the (app) layout and the " +
  "api validate the session. Never import the database here.";

/** Prisma only through @finlytics/database; @finlytics packages through their exports; Radix through radix-ui. */
export const WEB_IMPORTS = defineRestrictionSet({
  paths: [{ name: "prisma", message: PRISMA_MESSAGE }],
  patterns: [
    { group: ["@prisma/*", "prisma/*"], message: PRISMA_MESSAGE },
    { regex: "^@finlytics/[^/]+/(?:src|dist)(?:/|$)", message: DEEP_IMPORT_MESSAGE },
    { group: ["@radix-ui/*"], message: RADIX_MESSAGE },
  ],
});

/** No `process.env` outside the configuration boundary. */
export const NO_PROCESS_ENV = defineRestrictionSet({
  properties: [{ object: "process", property: "env", message: PROCESS_ENV_MESSAGE }],
});

/** The proxy never loads the database (foundations carry-forward). */
export const NO_DATABASE = defineRestrictionSet({
  paths: [{ name: "@finlytics/database", message: PROXY_DATABASE_MESSAGE }],
  patterns: [{ group: ["@finlytics/database/*", "@/auth", "@/lib/auth/*"], message: PROXY_DATABASE_MESSAGE }],
});

/** Where `process.env` may be read. */
export const WEB_ENV_FILES = [
  "**/src/lib/env.ts",
  "**/src/proxy.ts",
  "**/next.config.ts",
  "**/*.config.{ts,mts}",
  "**/e2e/**",
];

/** The proxy file. */
export const WEB_PROXY_FILES = ["**/src/proxy.ts"];

/** @param {Record<string, unknown>} rules every rule at "error", keeping its options */
function asErrors(rules) {
  return Object.fromEntries(
    Object.entries(rules).map(([ruleId, entry]) => [
      ruleId,
      Array.isArray(entry) ? ["error", ...entry.slice(1)] : "error",
    ]),
  );
}

const nextRules = {
  ...nextPlugin.configs.recommended.rules,
  ...nextPlugin.configs["core-web-vitals"].rules,
};

/** @type {import("eslint").Linter.Config[]} */
export const next = [
  ...react,
  {
    name: "finlytics/next/plugin",
    files: ALL_FILES,
    plugins: { "@next/next": nextPlugin },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: asErrors(nextRules),
  },
  {
    name: "finlytics/next/dom-props",
    files: ALL_FILES,
    rules: {
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "style",
              message:
                "Style DOM elements with token utilities (className), never inline styles: tokens stay single-sourced " +
                "and the CSP needs no 'unsafe-inline'.",
            },
          ],
        },
      ],
    },
  },
  restrict(
    "finlytics/next/restrictions",
    ALL_FILES,
    NODE_PROTOCOL,
    DETERMINISTIC_FORMATTING,
    REACT_PERF,
    WEB_IMPORTS,
    NO_PROCESS_ENV,
  ),
  restrict(
    "finlytics/next/env-boundary",
    WEB_ENV_FILES,
    NODE_PROTOCOL,
    DETERMINISTIC_FORMATTING,
    REACT_PERF,
    WEB_IMPORTS,
  ),
  restrict(
    "finlytics/next/proxy",
    WEB_PROXY_FILES,
    NODE_PROTOCOL,
    DETERMINISTIC_FORMATTING,
    REACT_PERF,
    WEB_IMPORTS,
    NO_DATABASE,
  ),
];
