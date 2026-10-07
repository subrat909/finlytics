import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PACKAGE_DIR, readManifest } from "./package-files";
import type { ExportTarget } from "./package-files";

/**
 * The public surface (plan D2): an explicit map with no root barrel and no wildcard (a wildcard would expose stories
 * and tests). A PR that adds a component adds its `./components/<name>` line here and in package.json.
 */
const DOCUMENTED_ENTRY_POINTS = [
  "./globals.css",
  "./components/badge",
  "./components/button",
  "./components/card",
  "./components/dropdown-menu",
  "./components/empty-state",
  "./components/error-state",
  "./components/input",
  "./components/kbd",
  "./components/page-loader",
  "./components/popover",
  "./components/segmented-control",
  "./components/separator",
  "./components/skeleton",
  "./components/table",
  "./components/tabs",
  "./components/theme-provider",
  "./components/theme-toggle",
  "./components/tooltip",
  "./lib/theme",
  "./lib/utils",
  "./package.json",
];

const manifest = readManifest();

function targetsOf(target: ExportTarget): string[] {
  return typeof target === "string" ? [target] : Object.values(target).flatMap(targetsOf);
}

describe("package exports", () => {
  it("exports exactly the documented entry points", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual([...DOCUMENTED_ENTRY_POINTS].sort());
  });

  it("points every export at an existing file", () => {
    const targets = Object.values(manifest.exports).flatMap(targetsOf);
    const missing = targets.filter((target) => !existsSync(path.join(PACKAGE_DIR, target)));

    expect(targets.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("types the stylesheet export, so consumers' CSS imports typecheck", () => {
    expect(manifest.exports["./globals.css"]).toEqual({
      types: "./src/styles/stylesheet.d.ts",
      default: "./src/styles/globals.css",
    });
  });

  it("has a story and a unit test for every exported component", () => {
    const components = Object.keys(manifest.exports)
      .filter((entry) => entry.startsWith("./components/"))
      .map((entry) => entry.slice("./components/".length));
    const expected = components.flatMap((name) => [
      `src/components/${name}.tsx`,
      `src/components/${name}.stories.tsx`,
      `src/components/__tests__/${name}.test.tsx`,
    ]);
    const missing = expected.filter((file) => !existsSync(path.join(PACKAGE_DIR, file)));

    expect(missing).toEqual([]);
    for (const name of components) {
      expect(manifest.exports[`./components/${name}`]).toBe(`./src/components/${name}.tsx`);
    }
  });

  it("ships source with no build step", () => {
    expect(manifest.scripts).not.toHaveProperty("build");
    expect(manifest.main).toBeUndefined();
    expect(existsSync(path.join(PACKAGE_DIR, "dist"))).toBe(false);
    for (const target of Object.values(manifest.exports).flatMap(targetsOf)) {
      expect(target).toMatch(/^\.\/(src\/|package\.json$)/);
    }
  });

  it("marks only stylesheets as side effects", () => {
    expect(manifest.sideEffects).toEqual(["**/*.css"]);
  });
});
