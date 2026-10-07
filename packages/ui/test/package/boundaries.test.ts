import { createRequire } from "node:module";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { directives, importedModules, isTestOrStory, parseSource, sourceFiles, walk } from "./package-files";

const require = createRequire(import.meta.url);

/**
 * React APIs that Server Components can't use: everything `react` exports that its `react-server` build doesn't
 * (useState, useEffect, createContext, ...). Read from the installed React, so new client-only hooks are covered.
 */
function clientOnlyReactApis(): Set<string> {
  const reactDir = path.dirname(require.resolve("react/package.json"));
  const load = (file: string): string[] => Object.keys(require(path.join(reactDir, file)) as object);
  const serverApis = new Set(load("react.react-server.js"));
  return new Set(load("index.js").filter((name) => !name.startsWith("__") && !serverApis.has(name)));
}

/** react-dom's client-only exports. (Its react-server build refuses to load outside an RSC environment.) */
const CLIENT_ONLY_REACT_DOM_APIS = new Set([
  "createPortal",
  "flushSync",
  "requestFormReset",
  "unstable_batchedUpdates",
  "useFormState",
  "useFormStatus",
]);

const NETWORK_APIS = new Set(["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "sendBeacon"]);

/** Client-only React APIs a module uses: named imports, and `React.x` through a namespace or default import. */
function clientOnlyApisUsed(source: ts.SourceFile, clientOnly: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const used = new Set<string>();
  const namespaces = new Map<string, ReadonlySet<string>>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const typeOnly = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    if (module === "react-dom/client" && !typeOnly) used.add("react-dom/client");
    const apis = clientOnly.get(module);
    if (!apis || !clause || typeOnly) continue;

    if (clause.name) namespaces.set(clause.name.text, apis);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, apis);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && apis.has(imported)) used.add(imported);
      }
    }
  }

  walk(source, (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const apis = namespaces.get(node.expression.text);
      if (apis?.has(node.name.text)) used.add(`${node.expression.text}.${node.name.text}`);
    }
  });
  return [...used].sort();
}

describe("module boundaries", () => {
  it("keeps client-only React APIs out of modules without 'use client'", () => {
    const clientOnly = new Map<string, ReadonlySet<string>>([
      ["react", clientOnlyReactApis()],
      ["react-dom", CLIENT_ONLY_REACT_DOM_APIS],
    ]);
    expect(clientOnly.get("react")).toContain("useState");

    const violations = sourceFiles()
      .filter((file) => !isTestOrStory(file))
      .flatMap((file) => {
        const source = parseSource(file);
        const apis = clientOnlyApisUsed(source, clientOnly);
        return apis.length > 0 && !directives(source).includes("use client") ? [`${file}: ${apis.join(", ")}`] : [];
      });

    expect(violations).toEqual([]);
  });

  it("keeps lib modules free of directives, so Server Components can import their values", () => {
    const lib = sourceFiles().filter((file) => file.startsWith("src/lib/") && !isTestOrStory(file));
    const withDirectives = lib.filter((file) => directives(parseSource(file)).length > 0);

    expect(lib).toEqual(expect.arrayContaining(["src/lib/theme.ts", "src/lib/utils.ts"]));
    expect(withDirectives).toEqual([]);
  });

  it("imports next-themes only in theme-provider", () => {
    const importers = sourceFiles().filter((file) =>
      importedModules(parseSource(file)).some(
        (module) => module === "next-themes" || module.startsWith("next-themes/"),
      ),
    );

    expect(importers.filter((file) => file !== "src/components/theme-provider.tsx")).toEqual([]);
  });

  it("makes no network calls", () => {
    const uses = sourceFiles().flatMap((file) => {
      const found: string[] = [];
      walk(parseSource(file), (node) => {
        if (ts.isIdentifier(node) && NETWORK_APIS.has(node.text)) found.push(`${file}: ${node.text}`);
      });
      return found;
    });

    expect(uses).toEqual([]);
  });
});
