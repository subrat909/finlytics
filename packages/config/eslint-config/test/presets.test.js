/**
 * Preset tests (plan §8, @finlytics/eslint-config).
 *
 * - "Effective config" tests ask ESLint which rules the repo-root eslint.config.mjs applies to a path
 *   (calculateConfigForFile). The files needn't exist; this pins the scopes and the composed restrictions.
 * - Behaviour tests lint snippets with a preset and the typescript-eslint parser, without type information (type-aware
 *   rules need a tsconfig project for every linted file, and these rules don't use types).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import { ALL_FILES } from "../base.js";
import { library } from "../library.js";
import { NEST_IMPORTS, NO_PROCESS_ENV, NO_UNSCOPED, nest } from "../nest.js";
import { NO_DATABASE, NO_PROCESS_ENV as WEB_NO_PROCESS_ENV, WEB_IMPORTS, next } from "../next.js";
import { node } from "../node.js";
import { REACT_VERSION, reactLibrary } from "../react.js";
import {
  BROWSER_SAFE,
  DETERMINISTIC_FORMATTING,
  NODE_PROTOCOL,
  REACT_PERF,
  UI_PACKAGE,
  defineRestrictionSet,
  restrict,
} from "../restrictions.js";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = path.resolve(PACKAGE_DIR, "../../..");

const RESTRICTION_RULES = [
  "no-restricted-imports",
  "@typescript-eslint/no-restricted-imports",
  "no-restricted-globals",
  "no-restricted-properties",
  "no-restricted-syntax",
];
const REACT_RULE_PREFIXES = ["react/", "react-hooks/", "jsx-a11y/"];
const SEVERITY = { off: 0, warn: 1, error: 2 };

const rootEslint = new ESLint({ cwd: REPO_ROOT });

/** @param {string} relativePath a path from the repo root */
async function effectiveConfig(relativePath) {
  const config = await rootEslint.calculateConfigForFile(path.join(REPO_ROOT, relativePath));
  expect(config, `${relativePath} is linted`).toBeDefined();
  return config;
}

/**
 * A rule entry as "off" or [severity, ...options] with a numeric severity, so preset entries ("error") compare with
 * ESLint's normalised ones (2). An "off" rule keeps earlier options in ESLint's output; they don't apply.
 *
 * @param {unknown} entry
 */
function normalise(entry) {
  const [severity, ...options] = Array.isArray(entry) ? entry : [entry];
  const level = typeof severity === "string" ? SEVERITY[/** @type {keyof typeof SEVERITY} */ (severity)] : severity;
  return level === 0 ? "off" : [level, ...options];
}

/** @param {Record<string, unknown>} rules */
function restrictionsOf(rules) {
  return Object.fromEntries(RESTRICTION_RULES.map((ruleId) => [ruleId, normalise(rules[ruleId] ?? "off")]));
}

/** @param {import("../restrictions.js").RestrictionSet[]} sets */
function expectedRestrictions(...sets) {
  const config = restrict("expected", ALL_FILES, ...sets);
  return restrictionsOf(/** @type {Record<string, unknown>} */ (config.rules));
}

/**
 * Enabled React rules. (eslint-config-prettier, last in the root config, switches react/jsx-* formatting rules off for
 * every file, so they appear as "off" everywhere.)
 *
 * @param {Record<string, unknown>} rules
 */
function reactRuleIds(rules) {
  return Object.entries(rules)
    .filter(
      ([ruleId, entry]) =>
        REACT_RULE_PREFIXES.some((prefix) => ruleId.startsWith(prefix)) && normalise(entry) !== "off",
    )
    .map(([ruleId]) => ruleId);
}

/**
 * Lints `code` with a preset, the typescript-eslint parser and no type information.
 *
 * @param {import("eslint").Linter.Config[]} preset
 * @param {string} code
 * @param {string} [fileName]
 */
async function lint(preset, code, fileName = "src/example.tsx") {
  const eslint = new ESLint({
    cwd: PACKAGE_DIR,
    overrideConfigFile: true,
    overrideConfig: [tseslint.configs.base, ...preset, tseslint.configs.disableTypeChecked],
  });
  const [result] = await eslint.lintText(code, { filePath: path.join(PACKAGE_DIR, fileName) });
  expect(result?.fatalErrorCount, "the snippet parses").toBe(0);
  return (result?.messages ?? []).map(({ ruleId, severity, line }) => ({ ruleId, severity, line }));
}

/** @param {number} line @param {string} ruleId */
const error = (line, ruleId) => ({ ruleId, severity: 2, line });

describe("effective config (repo-root eslint.config.mjs)", () => {
  it("applies browser-safe bans, deterministic formatting and React rules together to a ui source file", async () => {
    for (const file of ["packages/ui/src/components/button.tsx", "packages/ui/.storybook/preview.tsx"]) {
      const { rules, settings } = await effectiveConfig(file);

      expect(restrictionsOf(rules), file).toEqual(
        expectedRestrictions(BROWSER_SAFE, DETERMINISTIC_FORMATTING, REACT_PERF, UI_PACKAGE),
      );
      expect(normalise(rules["react-hooks/rules-of-hooks"]), file).toEqual([2]);
      expect(normalise(rules["react-hooks/exhaustive-deps"]), file).toEqual([2]);
      expect(normalise(rules["react/no-danger"]), file).toEqual([2]);
      expect(normalise(rules["react/prop-types"]), file).toBe("off");
      expect(normalise(rules["jsx-a11y/alt-text"]), file).toEqual([2]);
      expect(normalise(rules["react/forbid-dom-props"]), file).toEqual([
        2,
        { forbid: [expect.objectContaining({ propName: "style" })] },
      ]);
      expect(normalise(rules["@typescript-eslint/no-misused-promises"]), file).toEqual([
        2,
        { checksVoidReturn: { attributes: false } },
      ]);
      expect(settings, file).toEqual({ react: { version: REACT_VERSION } });
    }
  });

  it("keeps shared on the library preset without React rules", async () => {
    const { rules } = await effectiveConfig("packages/shared/src/money.ts");

    expect(restrictionsOf(rules)).toEqual(expectedRestrictions(BROWSER_SAFE, DETERMINISTIC_FORMATTING));
    expect(reactRuleIds(rules)).toEqual([]);
  });

  it("allows Node globals in ui tooling files", async () => {
    const files = [
      "packages/ui/vitest.config.ts",
      "packages/ui/.storybook/main.ts",
      "packages/ui/test/tokens/contrast.test.ts",
      "packages/ui/scripts/visual.mjs",
    ];
    for (const file of files) {
      const { rules, languageOptions } = await effectiveConfig(file);

      expect(languageOptions.globals, file).toHaveProperty("process");
      expect(restrictionsOf(rules), file).toEqual(expectedRestrictions(NODE_PROTOCOL));
      expect(reactRuleIds(rules), file).toEqual([]);
    }
  });

  it("keeps Node packages on the node: protocol ban alone", async () => {
    for (const file of ["packages/database/src/client.ts", "packages/shared/test/pkg/smoke.cjs"]) {
      const { rules } = await effectiveConfig(file);

      expect(restrictionsOf(rules), file).toEqual(expectedRestrictions(NODE_PROTOCOL));
    }
  });

  it("applies every api ban to api source files, with Node globals, no-console and decorated empty classes", async () => {
    const files = [
      "apps/api/src/app.module.ts",
      "apps/api/src/modules/users/users.service.ts",
      "apps/api/src/common/filters/problem-details.filter.ts",
    ];
    for (const file of files) {
      const { rules, languageOptions } = await effectiveConfig(file);

      expect(languageOptions.globals, file).toHaveProperty("process");
      expect(restrictionsOf(rules), file).toEqual(
        expectedRestrictions(NODE_PROTOCOL, NEST_IMPORTS, NO_PROCESS_ENV, NO_UNSCOPED),
      );
      // ESLint fills in the rule's default options, so compare the severity only.
      expect(normalise(rules["no-console"])[0], file).toBe(2);
      expect(normalise(rules["@typescript-eslint/no-extraneous-class"]), file).toEqual([
        2,
        { allowWithDecorator: true },
      ]);
      expect(reactRuleIds(rules), file).toEqual([]);
    }
  });

  it("allows process.env only at the api's configuration boundary, in scripts, tests and Vitest configs", async () => {
    const files = [
      "apps/api/src/config/env.schema.ts",
      "apps/api/src/main.ts",
      "apps/api/scripts/dev-session.mts",
      "apps/api/test/integration/app.ts",
      "apps/api/vitest.config.mts",
    ];
    for (const file of files) {
      const { rules } = await effectiveConfig(file);

      expect(restrictionsOf(rules), file).toEqual(expectedRestrictions(NODE_PROTOCOL, NEST_IMPORTS, NO_UNSCOPED));
    }
  });

  it("allows the unscoped Prisma client only in infra/prisma, the auth module and the health module", async () => {
    const files = [
      "apps/api/src/infra/prisma/prisma.service.ts",
      "apps/api/src/modules/auth/session.repository.ts",
      "apps/api/src/modules/health/health.service.ts",
    ];
    for (const file of files) {
      const { rules } = await effectiveConfig(file);

      expect(restrictionsOf(rules), file).toEqual(expectedRestrictions(NODE_PROTOCOL, NEST_IMPORTS, NO_PROCESS_ENV));
    }
  });
});

describe("effective config: apps/web (next preset)", () => {
  const WEB_SETS = [NODE_PROTOCOL, DETERMINISTIC_FORMATTING, REACT_PERF, WEB_IMPORTS];

  it("applies React, the Next plugin as errors and every web ban to app source files", async () => {
    for (const file of ["apps/web/src/app/layout.tsx", "apps/web/src/components/shell/app-shell.tsx"]) {
      const { rules, settings, languageOptions } = await effectiveConfig(file);

      expect(restrictionsOf(rules), file).toEqual(expectedRestrictions(...WEB_SETS, WEB_NO_PROCESS_ENV));
      expect(normalise(rules["react-hooks/exhaustive-deps"]), file).toEqual([2]);
      expect(normalise(rules["@next/next/no-img-element"]), file).toEqual([2]);
      expect(normalise(rules["@next/next/no-html-link-for-pages"])[0], file).toBe(2);
      expect(normalise(rules["react/forbid-dom-props"])[0], file).toBe(2);
      expect(settings, file).toEqual({
        react: { version: REACT_VERSION },
        next: { rootDir: path.join(REPO_ROOT, "apps/web/") },
      });
      expect(languageOptions.globals, file).toHaveProperty("window");
      expect(languageOptions.globals, file).toHaveProperty("process");
    }
  });

  it("allows process.env only in the env module, configs and e2e, and bans the database in the proxy", async () => {
    for (const file of ["apps/web/src/lib/env.ts", "apps/web/next.config.ts", "apps/web/e2e/support.ts"]) {
      const { rules } = await effectiveConfig(file);
      expect(restrictionsOf(rules), file).toEqual(expectedRestrictions(...WEB_SETS));
    }
    const { rules } = await effectiveConfig("apps/web/src/proxy.ts");
    expect(restrictionsOf(rules)).toEqual(expectedRestrictions(...WEB_SETS, NO_DATABASE));
  });
});

describe("next preset (apps/web)", () => {
  it("flags the database and auth modules in the proxy, Prisma, deep and @radix-ui imports, and process.env", async () => {
    const proxy = [
      'import { getPrisma } from "@finlytics/database";',
      'import { auth } from "@/auth";',
      'import { SESSION_COOKIE_NAME } from "@finlytics/shared";',
      "export const mode = process.env.NODE_ENV;",
      "export { getPrisma, auth, SESSION_COOKIE_NAME };",
    ].join("\n");
    expect(await lint(next, proxy, "src/proxy.ts")).toEqual([
      error(1, "@typescript-eslint/no-restricted-imports"),
      error(2, "@typescript-eslint/no-restricted-imports"),
    ]);

    const page = [
      'import { PrismaClient } from "@prisma/client";',
      'import { Dialog } from "@radix-ui/react-dialog";',
      'import { MeSchema } from "@finlytics/shared/src/schemas/me";',
      'import { readFileSync } from "fs";',
      "export const secret = process.env.AUTH_SECRET;",
      "export const price = (1).toLocaleString();",
      // Allowed: the database package, the unified radix-ui, shared's exports.
      'import { getPrisma } from "@finlytics/database";',
      'import { Tooltip } from "radix-ui";',
      "export { PrismaClient, Dialog, MeSchema, readFileSync, getPrisma, Tooltip };",
    ].join("\n");
    expect(await lint(next, page, "src/app/page.tsx")).toEqual([
      error(1, "@typescript-eslint/no-restricted-imports"),
      error(2, "@typescript-eslint/no-restricted-imports"),
      error(3, "@typescript-eslint/no-restricted-imports"),
      error(4, "@typescript-eslint/no-restricted-imports"),
      error(5, "no-restricted-properties"),
      error(6, "no-restricted-properties"),
    ]);
  });

  it("reports Next.js rules as errors", async () => {
    const code = ["export function Avatar() {", '  return <img src="/a.png" alt="" />;', "}"].join("\n");
    expect(await lint(next, code, "src/components/avatar.tsx")).toEqual([error(2, "@next/next/no-img-element")]);
  });
});

describe("nest preset (apps/api)", () => {
  /** @param {string} code @param {string} [fileName] */
  const lintNest = (code, fileName = "src/modules/example/example.service.ts") =>
    lint([...node, ...nest], code, fileName);

  it("flags process.env, Prisma imports, deep @finlytics imports and bare Node built-ins", async () => {
    const code = [
      'import { PrismaClient } from "@prisma/client";',
      'import { PrismaPg } from "@prisma/adapter-pg";',
      'import { ProblemDetailsSchema } from "@finlytics/shared/src/schemas/errors";',
      'import { createPrismaClient } from "@finlytics/database/dist/index.cjs";',
      'import { readFileSync } from "fs";',
      "export const port = process.env.API_PORT;",
      // Allowed: package exports, the testing entry and node: built-ins.
      'import { MeSchema } from "@finlytics/shared";',
      'import { startTestDatabase } from "@finlytics/database/testing";',
      'import { createHash } from "node:crypto";',
      "export { PrismaClient, PrismaPg, ProblemDetailsSchema, createPrismaClient, readFileSync };",
      "export { MeSchema, startTestDatabase, createHash };",
    ].join("\n");

    expect(await lintNest(code)).toEqual([
      error(1, "@typescript-eslint/no-restricted-imports"),
      error(2, "@typescript-eslint/no-restricted-imports"),
      error(3, "@typescript-eslint/no-restricted-imports"),
      error(4, "@typescript-eslint/no-restricted-imports"),
      error(5, "@typescript-eslint/no-restricted-imports"),
      error(6, "no-restricted-properties"),
    ]);
  });

  it("flags the unscoped Prisma client and console outside their allowlists", async () => {
    const code = [
      "declare const prisma: { unscoped: { user: unknown }; db: { user: unknown } };",
      "export const raw = prisma.unscoped.user;",
      "export const scoped = prisma.db.user;",
      'console.log("hello");',
    ].join("\n");

    expect(await lintNest(code)).toEqual([error(2, "no-restricted-syntax"), error(4, "no-console")]);
  });

  it("flags the unscoped client reached through a computed key or destructuring", async () => {
    const code = [
      "declare const prisma: { unscoped: { user: unknown }; db: { user: unknown } };",
      'export const computed = prisma["unscoped"].user;',
      "export const optional = prisma?.unscoped;",
      "const { unscoped } = prisma;",
      "const { unscoped: renamed } = prisma;",
      'const { "unscoped": quoted } = prisma;',
      "export function take({ unscoped: client }: typeof prisma) { return client; }",
      "export { unscoped, renamed, quoted };",
      // Allowed: the guarded client, and the word in other positions.
      'export const scoped = prisma["db"].user;',
      "const { db } = prisma;",
      'export const label = { unscoped: "a property named unscoped" };',
      "export { db };",
    ].join("\n");

    expect(await lintNest(code)).toEqual([
      error(2, "no-restricted-syntax"),
      error(3, "no-restricted-syntax"),
      error(4, "no-restricted-syntax"),
      error(5, "no-restricted-syntax"),
      error(6, "no-restricted-syntax"),
      error(7, "no-restricted-syntax"),
    ]);
  });

  it("allows every form of the unscoped client in its allowlisted folders", async () => {
    const code = [
      "declare const prisma: { unscoped: { user: unknown } };",
      'export const computed = prisma["unscoped"].user;',
      "const { unscoped } = prisma;",
      "export { unscoped };",
    ].join("\n");

    for (const file of ["src/infra/prisma/x.ts", "src/modules/auth/x.ts", "src/modules/health/x.ts"]) {
      expect(await lintNest(code, file), file).toEqual([]);
    }
  });

  it("allows the unscoped client in the auth module and process.env in src/config, but keeps their other bans", async () => {
    const code = [
      "declare const prisma: { unscoped: { session: unknown } };",
      "export const lookup = prisma.unscoped.session;",
      "export const port = process.env.API_PORT;",
    ].join("\n");

    expect(await lintNest(code, "src/modules/auth/session.repository.ts")).toEqual([
      error(3, "no-restricted-properties"),
    ]);
    expect(await lintNest(code, "src/config/env.ts")).toEqual([error(2, "no-restricted-syntax")]);
  });

  it("accepts an empty @Module() class but not an undecorated empty class", async () => {
    const code = [
      "declare function Module(metadata: object): ClassDecorator;",
      "@Module({})",
      "export class AppModule {}",
      "export class Empty {}",
    ].join("\n");

    expect(await lintNest(code)).toEqual([error(4, "@typescript-eslint/no-extraneous-class")]);
  });
});

describe("R7: browser-safe library code", () => {
  it("flags import('node:fs') and dynamic imports of bare built-ins in library code", async () => {
    const code = [
      'await import("node:fs");',
      'await import("fs/promises");',
      'await import("events");',
      // Allowed: npm packages whose names start with a built-in's, a subpath, local modules.
      'await import("eventsource");',
      'await import("path-browserify");',
      'await import("decimal.js/decimal.js");',
      'await import("./local.js");',
      "export {};",
    ].join("\n");

    expect(await lint(library, code, "src/example.ts")).toEqual([
      error(1, "no-restricted-syntax"),
      error(2, "no-restricted-syntax"),
      error(3, "no-restricted-syntax"),
    ]);
  });

  it("flags a dynamic import whose specifier is not a string literal", async () => {
    const code = [
      'const name = "./module.js";',
      "await import(name);",
      "await import(`./${name}`);",
      "export {};",
    ].join("\n");

    expect(await lint(library, code, "src/example.ts")).toEqual([
      error(2, "no-restricted-syntax"),
      error(3, "no-restricted-syntax"),
    ]);
  });

  it("flags globalThis.process, globalThis['Buffer'] and process destructured from globalThis", async () => {
    const code = [
      "globalThis.process;",
      'globalThis["Buffer"];',
      "const { process: proc } = globalThis;",
      "window.require;",
      "self.global;",
      "export { proc };",
    ].join("\n");

    expect(await lint(library, code, "src/example.ts")).toEqual([
      error(1, "no-restricted-properties"),
      error(2, "no-restricted-properties"),
      error(3, "no-restricted-properties"),
      error(4, "no-restricted-properties"),
      error(5, "no-restricted-properties"),
    ]);
  });

  it("keeps the static Node built-in, Node global and Prisma bans", async () => {
    const code = [
      'import { readFileSync } from "node:fs";',
      'import path from "path";',
      'import { getPrisma } from "@finlytics/database";',
      "process.env;",
      "export { readFileSync, path, getPrisma };",
    ].join("\n");

    expect(await lint(library, code, "src/example.ts")).toEqual([
      error(1, "@typescript-eslint/no-restricted-imports"),
      error(2, "@typescript-eslint/no-restricted-imports"),
      error(3, "@typescript-eslint/no-restricted-imports"),
      error(4, "no-restricted-globals"),
    ]);
  });
});

describe("S2: deterministic formatting", () => {
  it("flags Intl, globalThis.Intl and toLocaleString/toLocaleDateString/toLocaleTimeString", async () => {
    const code = [
      'new Intl.NumberFormat("en-IN");',
      "globalThis.Intl;",
      "(1234.5).toLocaleString();",
      "new Date().toLocaleDateString();",
      "new Date().toLocaleTimeString();",
      // Allowed: a type-only reference.
      "export type Options = Intl.NumberFormatOptions;",
    ].join("\n");

    expect(await lint(library, code, "src/example.ts")).toEqual([
      error(1, "no-restricted-globals"),
      error(2, "no-restricted-properties"),
      error(3, "no-restricted-properties"),
      error(4, "no-restricted-properties"),
      error(5, "no-restricted-properties"),
    ]);
  });
});

describe("React and ui rules", () => {
  it("reports a missing effect dependency as an error, not a warning", async () => {
    const code = [
      'import { useEffect } from "react";',
      "export function Example({ value }: { value: string }) {",
      "  useEffect(() => {",
      "    document.title = value;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n");

    expect(await lint(reactLibrary, code)).toEqual([error(5, "react-hooks/exhaustive-deps")]);
  });

  it("flags namespace imports of lucide-react and imports of lucide-react/dynamic", async () => {
    const code = [
      'import * as Icons from "lucide-react";',
      'import { icons } from "lucide-react";',
      'import { DynamicIcon } from "lucide-react/dynamic";',
      'import dynamicIconImports from "lucide-react/dynamicIconImports";',
      'export * from "lucide-react";',
      // Allowed: icons by name.
      'import { Sun } from "lucide-react";',
      "export { Icons, icons, DynamicIcon, dynamicIconImports, Sun };",
    ].join("\n");

    expect(await lint(reactLibrary, code)).toEqual([
      error(1, "no-restricted-syntax"),
      error(2, "no-restricted-syntax"),
      error(3, "@typescript-eslint/no-restricted-imports"),
      error(4, "@typescript-eslint/no-restricted-imports"),
      error(5, "no-restricted-syntax"),
    ]);
  });

  it("flags the cn package and @finlytics/ui self-imports inside packages/ui", async () => {
    const code = [
      'import { cn } from "cn";',
      'import { Button } from "@finlytics/ui/components/button";',
      'import { Slot } from "@radix-ui/react-slot";',
      // Allowed: the unified radix-ui package and relative imports.
      'import { RadioGroup } from "radix-ui";',
      'import { cn as merge } from "../lib/utils";',
      "export { cn, Button, Slot, RadioGroup, merge };",
    ].join("\n");

    expect(await lint(reactLibrary, code, "src/components/example.tsx")).toEqual([
      error(1, "@typescript-eslint/no-restricted-imports"),
      error(2, "@typescript-eslint/no-restricted-imports"),
      error(3, "@typescript-eslint/no-restricted-imports"),
    ]);
  });

  it("flags dangerouslySetInnerHTML and a style prop on a DOM element in ui", async () => {
    const code = [
      "export function Example({ html }: { html: string }) {",
      "  return (",
      "    <>",
      "      <div dangerouslySetInnerHTML={{ __html: html }} />",
      '      <div style={{ width: "1px" }} />',
      // Allowed: a `style` prop on a component (it decides what to do with it).
      "      <Inner style={{}} />",
      "    </>",
      "  );",
      "}",
      "function Inner(props: { style: object }) {",
      "  return <span>{Object.keys(props.style).length}</span>;",
      "}",
    ].join("\n");

    expect(await lint(reactLibrary, code)).toEqual([error(4, "react/no-danger"), error(5, "react/forbid-dom-props")]);
  });

  it("pins the React version setting to the catalog's React minor", async () => {
    const workspace = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
    const pin = /^\s+react:\s*"?(\d+)\.(\d+)\.\d+"?\s*$/m.exec(workspace);
    expect(pin, "the catalog pins react").not.toBeNull();

    const catalogMinor = `${pin?.[1] ?? ""}.${pin?.[2] ?? ""}`;
    expect(REACT_VERSION).toBe(catalogMinor);
    const { settings } = await effectiveConfig("packages/ui/src/components/button.tsx");
    expect(settings).toEqual({ react: { version: catalogMinor } });
  });
});

describe("restrict()", () => {
  const IMPORTS = defineRestrictionSet({
    paths: [{ name: "left-pad", message: "no" }],
    patterns: [{ group: ["lodash/*"], message: "no" }],
  });
  const PROPERTIES = defineRestrictionSet({ properties: [{ object: "process", property: "env", message: "no" }] });

  it("sets all four rules from the union of the sets in one config object", () => {
    const config = restrict("finlytics/example", ["**/*.ts"], IMPORTS, PROPERTIES);

    expect(config).toEqual({
      name: "finlytics/example",
      files: ["**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "@typescript-eslint/no-restricted-imports": [
          "error",
          { paths: [{ name: "left-pad", message: "no" }], patterns: [{ group: ["lodash/*"], message: "no" }] },
        ],
        "no-restricted-globals": "off",
        "no-restricted-properties": ["error", { object: "process", property: "env", message: "no" }],
        "no-restricted-syntax": "off",
      },
    });
  });

  it("switches a rule off when no set uses it, so an earlier scope's bans can't leak through", async () => {
    const preset = [
      restrict("finlytics/earlier", ALL_FILES, PROPERTIES),
      restrict("finlytics/later", ALL_FILES, IMPORTS),
    ];

    expect(await lint(preset, 'process.env;\nimport pad from "left-pad";\nexport { pad };', "src/example.ts")).toEqual([
      error(2, "@typescript-eslint/no-restricted-imports"),
    ]);
  });

  it("keeps an entry that two sets share once", () => {
    const config = restrict("finlytics/example", ["**/*.ts"], BROWSER_SAFE, BROWSER_SAFE);

    expect(config.rules).toEqual(restrict("finlytics/example", ["**/*.ts"], BROWSER_SAFE).rules);
  });

  it("rejects an unknown key in a restriction set", () => {
    // Misspelt keys ("property", "global") would otherwise drop their bans silently.
    expect(() => defineRestrictionSet({ property: [] })).toThrow(/unknown restriction key "property"/);
    expect(() => restrict("finlytics/example", ["**/*.ts"], { global: [] })).toThrow(/unknown restriction key/);
  });

  it("keeps the shared sets immutable", () => {
    expect(Object.isFrozen(BROWSER_SAFE)).toBe(true);
    expect(Object.isFrozen(BROWSER_SAFE.paths)).toBe(true);
    expect(Object.isFrozen(BROWSER_SAFE.paths?.[0])).toBe(true);
  });
});
