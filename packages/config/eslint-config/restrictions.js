/**
 * Composed `no-restricted-*` rules (plan D16): the only place a preset may restrict imports, globals, properties or
 * syntax.
 *
 * Why: flat config *replaces* a rule's options when a later config object sets the same rule; it never merges them.
 * Two presets that both set `no-restricted-imports` for one file keep only the last one's bans, silently. So bans are
 * never written as raw rules in a preset. They are data, composed in one place:
 *
 * - A **restriction set** is plain data: `{ paths, patterns, globals, properties, syntax }`. Each key holds option
 *   entries for one rule (see {@link RestrictionSet}). Define one with {@link defineRestrictionSet}, which validates and
 *   freezes it.
 * - **`restrict(name, files, ...sets)`** returns ONE config object that sets all four rules from the union of the sets:
 *   `@typescript-eslint/no-restricted-imports` (paths and patterns; it extends core `no-restricted-imports`, which is
 *   switched off), `no-restricted-globals`, `no-restricted-properties` and `no-restricted-syntax`.
 *
 * Contract: **the last `restrict()` object that matches a file decides all four rules for that file.** A rule that no
 * set uses is switched "off" explicitly, so nothing leaks in from an earlier scope.
 *
 * Composing another preset, for example the `nest` preset planned for apps/api (phase-0-api-bootstrap §3):
 *
 *     import { ALL_FILES } from "./base.js";
 *     import { NODE_PROTOCOL, defineRestrictionSet, restrict } from "./restrictions.js";
 *
 *     const NEST_IMPORTS = defineRestrictionSet({ paths: [...], patterns: [...] }); // prisma, deep @finlytics paths
 *     const NO_PROCESS_ENV = defineRestrictionSet({
 *       properties: [{ object: "process", property: "env", message: "Read configuration through ConfigService." }],
 *     });
 *     const NO_UNSCOPED = defineRestrictionSet({
 *       syntax: [{ selector: "MemberExpression[property.name='unscoped']", message: "Use the tenancy-guarded client." }],
 *     });
 *
 *     export const nest = [
 *       // ...plugins and other rules...
 *       restrict("finlytics/nest/restrictions", ALL_FILES, NODE_PROTOCOL, NEST_IMPORTS, NO_PROCESS_ENV, NO_UNSCOPED),
 *       // To lift ONE ban for a subtree, call restrict() again there with the sets that still apply. Never switch a
 *       // no-restricted-* rule "off": that also drops every other ban the rule carries.
 *       restrict("finlytics/nest/config", ["**\/src/config/**", "**\/src/main.ts"], NODE_PROTOCOL, NEST_IMPORTS, NO_UNSCOPED),
 *     ];
 *
 * Globs: a preset's `files` match paths relative to the repo-root eslint.config.mjs, and a root scope that `extends`
 * the preset intersects them with its own `files`. So a sub-glob inside a preset starts with `**\/`. (The backslash in
 * `**\/` above is only there because a literal star-star-slash would end this comment; the real glob has none.)
 *
 * Every rule here comes from ESLint core or typescript-eslint, which `base` registers for every linted file.
 */
import { builtinModules } from "node:module";

/**
 * @typedef {{ name: string, message: string, importNames?: string[], allowTypeImports?: boolean }} RestrictedPath
 * @typedef {({ group: string[] } | { regex: string }) & { message: string, importNames?: string[], caseSensitive?: boolean, allowTypeImports?: boolean }} RestrictedPattern
 * @typedef {{ name: string, message: string }} RestrictedGlobal
 * @typedef {({ object: string, property?: string } | { property: string }) & { message: string }} RestrictedProperty
 * @typedef {{ selector: string, message: string }} RestrictedSyntax
 */

/**
 * One group of bans. Every key is optional; each array holds option entries for one rule.
 *
 * @typedef {object} RestrictionSet
 * @property {readonly RestrictedPath[]} [paths] `@typescript-eslint/no-restricted-imports` `paths`
 * @property {readonly RestrictedPattern[]} [patterns] `@typescript-eslint/no-restricted-imports` `patterns`
 * @property {readonly RestrictedGlobal[]} [globals] `no-restricted-globals`
 * @property {readonly RestrictedProperty[]} [properties] `no-restricted-properties`
 * @property {readonly RestrictedSyntax[]} [syntax] `no-restricted-syntax` (esquery selectors)
 */

const SET_KEYS = /** @type {const} */ (["paths", "patterns", "globals", "properties", "syntax"]);

/**
 * Validates a restriction set and returns a deeply frozen copy, so no preset can mutate a set another preset shares.
 * Unknown keys throw: a typo such as `property` instead of `properties` would otherwise drop the bans silently.
 *
 * @param {RestrictionSet} set
 * @returns {Readonly<RestrictionSet>}
 */
export function defineRestrictionSet(set) {
  assertRestrictionSet(set);
  return deepFreeze(structuredClone(set));
}

/**
 * One flat-config object that sets all four `no-restricted-*` rules for `files` from the union of `sets`. Identical
 * entries are kept once (the rules' option schemas require unique items).
 *
 * @param {string} name config name, shown by `eslint --inspect-config` and in the preset tests
 * @param {string[]} files globs the restrictions apply to
 * @param {...RestrictionSet} sets
 * @returns {import("eslint").Linter.Config}
 */
export function restrict(name, files, ...sets) {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("restrict(): name must be a non-empty string.");
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError(`restrict("${name}"): files must be a non-empty array of globs.`);
  }
  for (const set of sets) {
    assertRestrictionSet(set, name);
  }

  /** @param {(typeof SET_KEYS)[number]} key */
  const union = (key) => {
    const seen = new Set();
    const entries = [];
    for (const set of sets) {
      for (const entry of set[key] ?? []) {
        const id = JSON.stringify(entry);
        if (!seen.has(id)) {
          seen.add(id);
          // A fresh, unfrozen copy: ESLint's option validation may fill defaults into option objects.
          entries.push(structuredClone(entry));
        }
      }
    }
    return entries;
  };

  const paths = union("paths");
  const patterns = union("patterns");
  const globals = union("globals");
  const properties = union("properties");
  const syntax = union("syntax");

  /** @type {Record<string, unknown>} */
  const importOptions = {};
  if (paths.length > 0) importOptions.paths = paths;
  if (patterns.length > 0) importOptions.patterns = patterns;

  return {
    name,
    files,
    rules: {
      // The typescript-eslint rule extends the core one (it also understands `import type`); never run both.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": paths.length + patterns.length > 0 ? ["error", importOptions] : "off",
      "no-restricted-globals": globals.length > 0 ? ["error", ...globals] : "off",
      "no-restricted-properties": properties.length > 0 ? ["error", ...properties] : "off",
      "no-restricted-syntax": syntax.length > 0 ? ["error", ...syntax] : "off",
    },
  };
}

// ── Building blocks ────────────────────────────────────────────────────────────────────────────────────────────────

/** Bare specifiers ("fs", "fs/promises", ...). Prefix-only modules ("node:test") are caught by the `^node:` checks. */
const BARE_BUILTINS = builtinModules.filter((name) => !name.startsWith("node:"));

/** First path segments of the bare built-ins ("fs" for "fs/promises"); every subpath built-in has its root built in. */
const BUILTIN_ROOTS = [...new Set(BARE_BUILTINS.map((name) => name.split("/")[0]))];

/**
 * esquery regex for a dynamic import of a bare built-in or one of its subpaths ("fs", "fs/promises"), but not of an
 * npm package that merely starts with a built-in's name ("eventsource", "path-browserify"). esquery regexes can't
 * contain "/", hence the negated class instead of an explicit "/" after the root.
 */
const BARE_BUILTIN_REGEX = `/^(?:${BUILTIN_ROOTS.join("|")})(?:$|[^\\w.-])/`;

/** Node-only globals. */
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

/** Objects that expose globals as properties in browsers, workers and Node. */
const GLOBAL_OBJECTS = ["globalThis", "window", "self"];

/** Formatting whose output depends on the host's locale and time zone. */
const LOCALE_METHODS = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"];

const NODE_BUILTIN_MESSAGE = "Library code must stay browser-safe, so it cannot use Node built-ins.";
const NO_PRISMA_MESSAGE =
  "Library code never imports Prisma or @finlytics/database; mirror Prisma enums as Zod schemas.";
const DYNAMIC_SPECIFIER_MESSAGE =
  "Dynamic import() specifiers must be string literals, so bundlers and these lint rules can see the module.";
const FORMATTING_MESSAGE =
  "Locale- and time-zone-dependent formatting renders differently on the server and in the browser (hydration " +
  "mismatches). Use the deterministic helpers from @finlytics/shared (formatInr, formatInrCompact) or format explicitly.";
const LUCIDE_MESSAGE =
  'Import lucide icons by name (import { Sun } from "lucide-react"): namespace, `icons` and dynamic imports pull ' +
  "every icon into the bundle.";

// ── Sets ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Code that runs in browsers as well as on Node (packages/shared, packages/ui): no Node built-ins (static or dynamic),
 * no Node globals (directly or through globalThis, window or self), no Prisma, and no dynamic import whose module
 * can't be seen statically. Closes review finding R7.
 */
export const BROWSER_SAFE = defineRestrictionSet({
  paths: [
    ...BARE_BUILTINS.map((name) => ({ name, message: NODE_BUILTIN_MESSAGE })),
    { name: "@finlytics/database", message: NO_PRISMA_MESSAGE },
    { name: "prisma", message: NO_PRISMA_MESSAGE },
  ],
  patterns: [
    { regex: "^node:", message: NODE_BUILTIN_MESSAGE },
    { group: ["@finlytics/database/*", "@prisma/*", "prisma/*"], message: NO_PRISMA_MESSAGE },
  ],
  globals: NODE_GLOBALS.map((name) => ({ name, message: `${NODE_BUILTIN_MESSAGE} "${name}" is a Node global.` })),
  properties: GLOBAL_OBJECTS.flatMap((object) =>
    NODE_GLOBALS.map((property) => ({
      object,
      property,
      message: `${NODE_BUILTIN_MESSAGE} "${property}" is a Node global, also when read through ${object}.`,
    })),
  ),
  syntax: [
    { selector: "ImportExpression[source.type='Literal'][source.value=/^node:/]", message: NODE_BUILTIN_MESSAGE },
    {
      selector: `ImportExpression[source.type='Literal'][source.value=${BARE_BUILTIN_REGEX}]`,
      message: NODE_BUILTIN_MESSAGE,
    },
    { selector: "ImportExpression[source.type!='Literal']", message: DYNAMIC_SPECIFIER_MESSAGE },
  ],
});

/**
 * Formatting that renders the same text on the server and in the browser: no `Intl` (directly or through a global
 * object) and no `toLocale*String`. Closes review finding S2.
 */
export const DETERMINISTIC_FORMATTING = defineRestrictionSet({
  globals: [{ name: "Intl", message: FORMATTING_MESSAGE }],
  properties: [
    ...GLOBAL_OBJECTS.map((object) => ({ object, property: "Intl", message: FORMATTING_MESSAGE })),
    ...LOCALE_METHODS.map((property) => ({ property, message: FORMATTING_MESSAGE })),
  ],
});

/** React bundle hygiene: lucide icons by name only (no namespace, `icons` map or `lucide-react/dynamic`). */
export const REACT_PERF = defineRestrictionSet({
  patterns: [{ regex: "^lucide-react/dynamic", message: LUCIDE_MESSAGE }],
  syntax: [
    { selector: "ImportDeclaration[source.value='lucide-react'] > ImportNamespaceSpecifier", message: LUCIDE_MESSAGE },
    {
      selector: "ImportDeclaration[source.value='lucide-react'] > ImportSpecifier[imported.name='icons']",
      message: LUCIDE_MESSAGE,
    },
    { selector: "ExportAllDeclaration[source.value='lucide-react']", message: LUCIDE_MESSAGE },
    { selector: "ImportExpression[source.value=/^lucide-react/]", message: LUCIDE_MESSAGE },
  ],
});

/** packages/ui internals (plan D1, D9, D10): relative imports only, our own cn(), the unified radix-ui package. */
export const UI_PACKAGE = defineRestrictionSet({
  patterns: [
    {
      regex: "^cn(?:/|$)",
      message: "Use cn() from the package's lib/utils (plan D9); shadcn's `cn` package is not adopted.",
    },
    {
      regex: "^@finlytics/ui(?:/|$)",
      message: "Inside packages/ui, import relatively (plan D1). The exports map is for consumers only.",
    },
    {
      group: ["@radix-ui/*"],
      message: 'Import Radix primitives from the unified "radix-ui" package (plan D10).',
    },
  ],
});

/** Node code (packages/database, apps/api, tooling): built-ins through the `node:` protocol only. */
export const NODE_PROTOCOL = defineRestrictionSet({
  paths: BARE_BUILTINS.map((name) => ({ name, message: `Use the node: protocol: import from "node:${name}".` })),
});

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {unknown} set
 * @param {string} [context] the restrict() name, for the error message
 */
function assertRestrictionSet(set, context) {
  const where = context ? `restrict("${context}")` : "defineRestrictionSet()";
  if (typeof set !== "object" || set === null || Array.isArray(set)) {
    throw new TypeError(`${where}: a restriction set must be an object.`);
  }
  for (const [key, value] of Object.entries(set)) {
    if (!SET_KEYS.includes(/** @type {(typeof SET_KEYS)[number]} */ (key))) {
      throw new TypeError(`${where}: unknown restriction key "${key}"; expected one of ${SET_KEYS.join(", ")}.`);
    }
    if (!Array.isArray(value)) {
      throw new TypeError(`${where}: "${key}" must be an array.`);
    }
  }
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
