/** Helpers for the package tests: the manifest and the source files, read from disk. */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));

export type ExportTarget = string | { readonly [condition: string]: ExportTarget };

export interface PackageManifest {
  readonly name: string;
  readonly main?: string;
  readonly files?: readonly string[];
  readonly sideEffects?: boolean | readonly string[];
  readonly exports: Readonly<Record<string, ExportTarget>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
}

export function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")) as PackageManifest;
}

/** Package-relative paths of TS sources in src (declaration files excluded), sorted. */
export function sourceFiles(): string[] {
  return globSync("src/**/*.{ts,tsx}", { cwd: PACKAGE_DIR })
    .filter((file) => !file.endsWith(".d.ts"))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

/** Tests, stories and test helpers: they never ship to a consumer's server or client bundle. */
export function isTestOrStory(file: string): boolean {
  return file.startsWith("src/test/") || file.includes("/__tests__/") || /\.(test|stories)\.tsx?$/.test(file);
}

export function parseSource(file: string): ts.SourceFile {
  const text = readFileSync(path.join(PACKAGE_DIR, file), "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** Calls `visit` for every node of the file, depth first. */
export function walk(source: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  step(source);
}

/** Module specifiers of static imports, re-exports and literal dynamic imports. */
export function importedModules(source: ts.SourceFile): string[] {
  const modules: string[] = [];
  walk(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) modules.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }
  });
  return modules;
}

/** The directive prologue: "use client" counts only before the first statement that isn't a string directive. */
export function directives(source: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    found.push(statement.expression.text);
  }
  return found;
}
