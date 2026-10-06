/**
 * Compiles src/styles/globals.css with the installed Tailwind (its `compile()` API), so tests can check what the theme
 * actually generates. Imports resolve like Tailwind's own resolver: relative paths from the importing file, and bare
 * package names through the package's `style` export. scannedFiles() runs Tailwind's file scanner on a stylesheet's
 * `@source` rules, as a consumer's build does.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";

export const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));
export const STYLES_DIR = path.join(PACKAGE_DIR, "src/styles");

interface SourceEntry {
  readonly base: string;
  readonly pattern: string;
  readonly negated: boolean;
}

interface FileScanner {
  scan(): string[];
  readonly files: string[];
}

/**
 * Tailwind's file scanner (@tailwindcss/oxide), the one its Vite and PostCSS plugins run. It isn't a dependency of this
 * package, so it's loaded the way the Vite plugin (a devDependency) loads it, at the version the plugin pins.
 */
function loadScanner(): new (options: { sources: SourceEntry[] }) => FileScanner {
  const fromVitePlugin = createRequire(createRequire(import.meta.url).resolve("@tailwindcss/vite"));
  return (fromVitePlugin("@tailwindcss/oxide") as { Scanner: new (options: { sources: SourceEntry[] }) => FileScanner })
    .Scanner;
}

interface StyleManifest {
  readonly style?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
}

function resolvePackageStylesheet(id: string): string {
  const packageDir = path.join(PACKAGE_DIR, "node_modules", id);
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as StyleManifest;
  const root = manifest.exports?.["."];
  const styleExport =
    typeof root === "object" && root !== null && "style" in root && typeof root.style === "string" ? root.style : null;
  return path.join(packageDir, styleExport ?? manifest.style ?? "index.css");
}

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  const file = id.startsWith(".") ? path.resolve(base, id) : resolvePackageStylesheet(id);
  return Promise.resolve({ path: file, base: path.dirname(file), content: readFileSync(file, "utf8") });
}

/**
 * The whole stylesheet globals.css produces when `candidates` are the classes found in the sources. A fresh compiler
 * per call: a compiler's build() accumulates every candidate it has seen.
 */
export async function buildGlobals(candidates: readonly string[] = []): Promise<string> {
  const from = path.join(STYLES_DIR, "globals.css");
  const compiler = await compile(readFileSync(from, "utf8"), { base: STYLES_DIR, from, loadStylesheet });
  return compiler.build([...candidates]);
}

/** Only the utilities generated for `candidates` (the `@layer utilities` block), or "" when none is generated. */
export async function utilitiesFor(candidates: readonly string[]): Promise<string> {
  const css = await buildGlobals(candidates);
  const start = css.indexOf("@layer utilities {");
  if (start === -1) return "";
  // The layer ends at the first line that closes a top-level block.
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end === -1 ? undefined : end + 2);
}

/**
 * The files Tailwind scans for class names through a stylesheet's `@source` and `@source not` rules, package-relative
 * and sorted. Only the stylesheet's own sources: a consumer adds its own project root, which isn't this package.
 */
export async function scannedFiles(stylesheet: string): Promise<string[]> {
  const compiler = await compile(readFileSync(stylesheet, "utf8"), {
    base: path.dirname(stylesheet),
    from: stylesheet,
    loadStylesheet,
  });
  const Scanner = loadScanner();
  const scanner = new Scanner({ sources: [...compiler.sources] });
  scanner.scan();
  return scanner.files.map((file) => path.relative(PACKAGE_DIR, file).split(path.sep).join("/")).sort();
}
