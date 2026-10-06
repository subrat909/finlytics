import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PACKAGE_DIR, STYLES_DIR, buildGlobals, scannedFiles, utilitiesFor } from "./compile-css";
import { colourTokens, readTokenRules, themeDeclarations } from "./parse-tokens";

/**
 * shadcn's colour names (plan D5) and the token each one means. `border` isn't here: it's a Finlytics token of its own
 * (tokens.css), so `border-border` already reads `var(--border)`.
 */
const SHADCN_BRIDGE: Readonly<Record<string, string>> = {
  background: "bg",
  foreground: "fg",
  card: "surface-1",
  "card-foreground": "fg",
  popover: "surface-1",
  "popover-foreground": "fg",
  "primary-foreground": "primary-fg",
  secondary: "surface-2",
  "secondary-foreground": "fg",
  muted: "surface-2",
  "muted-foreground": "fg-muted",
  accent: "surface-3",
  "accent-foreground": "fg",
  destructive: "loss",
  "destructive-foreground": "loss-fg",
  input: "surface-2",
};

function readStylesheet(name: string): string {
  return readFileSync(path.join(STYLES_DIR, name), "utf8");
}

/** The body of the base layer that base.css contributes (the last `@layer base` block of the build). */
function ownBaseLayer(css: string): string {
  const start = css.lastIndexOf("@layer base {");
  return css.slice(start, css.indexOf("\n}\n", start));
}

describe("Tailwind theme", () => {
  it("maps every colour token to a utility that reads its variable", async () => {
    const tokens = [...colourTokens(themeDeclarations(readTokenRules(), "light")).keys()];
    const css = await utilitiesFor(tokens.map((token) => `bg-${token}`));

    const unmapped = tokens.filter((token) => !css.includes(`.bg-${token} {\n    background-color: var(--${token});`));
    expect(unmapped).toEqual([]);
  });

  it("bridges shadcn's colour names to the tokens, as utilities and as raw variables", async () => {
    const names = Object.keys(SHADCN_BRIDGE);
    const css = await utilitiesFor(names.map((name) => `bg-${name}`));
    const rawAliases = /:root,\s*\[data-theme\]\s*\{([^}]*)\}/.exec(readStylesheet("theme.css"))?.[1] ?? "";

    for (const [name, token] of Object.entries(SHADCN_BRIDGE)) {
      expect(css, `bg-${name}`).toContain(`.bg-${name} {\n    background-color: var(--${token});`);
      expect(rawAliases, `--${name}`).toMatch(new RegExp(`--${name}: var\\(--${token}\\);`));
    }
  });

  it("switches the dark variant on data-theme, not on the colour-scheme media query", async () => {
    const css = await utilitiesFor(["dark:bg-surface-1"]);

    expect(css).toContain(".dark\\:bg-surface-1:where([data-theme=dark], [data-theme=dark] *)");
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("generates tabular numerals in the mono face, the radius scale and the shimmer animation", async () => {
    const css = await buildGlobals(["tabular", "rounded-md", "rounded-xl", "motion-safe:animate-shimmer"]);

    expect(css).toMatch(/\.tabular \{\s*font-variant-numeric: tabular-nums;\s*font-family: var\(--font-mono\);/);
    expect(css).toMatch(/--font-mono: var\(--font-jetbrains-mono, "JetBrains Mono Variable"\)/);
    expect(css).toMatch(/\.rounded-md \{\s*border-radius: calc\(var\(--radius\) - 4px\);/);
    expect(css).toMatch(/\.rounded-xl \{\s*border-radius: var\(--radius\);/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference\) \{\s*\.motion-safe\\:animate-shimmer \{/);
    expect(css).toContain("@keyframes shimmer");
  });

  it("paints the shimmer as a translucent band, so a skeleton's own background (a tint) shows through", async () => {
    const css = (await utilitiesFor(["shimmer"])).replace(/\s+/g, " ");

    expect(css).toContain(
      "@supports (color: color-mix(in lab, red, red)) { background-image: linear-gradient( 90deg, transparent 25%, " +
        "color-mix(in oklab, var(--fg) 8%, transparent) 50%, transparent 75% ); }",
    );
    expect(css).toContain("background-size: 400% 100%;");
    expect(css).not.toContain("--surface");
  });

  it("leaves the skeleton flat, never an opaque band, where color-mix() isn't supported", async () => {
    const css = await utilitiesFor(["shimmer"]);

    // One background-image, inside the @supports block: Tailwind adds no fallback that drops the mix's transparency.
    expect(css.match(/background-image:/g)).toHaveLength(1);
    expect(css).toMatch(/@supports \(color: color-mix\(in lab, red, red\)\) \{\s*background-image:/);
  });

  it("draws SegmentedControl's (and so ThemeToggle's) checked option in system colours under forced colours", async () => {
    const toggle = readFileSync(path.join(PACKAGE_DIR, "src/components/segmented-control.tsx"), "utf8");
    const forcedColourClasses = toggle.match(/forced-colors:[^\s"]+/g) ?? [];
    const css = await utilitiesFor(forcedColourClasses);
    const forcedColours = /@media \(forced-colors: active\) \{([\s\S]*)/.exec(css)?.[1] ?? "";

    expect(forcedColourClasses.length).toBeGreaterThan(0);
    expect(forcedColours).toContain("forced-color-adjust: none;");
    expect(forcedColours).toContain("background-color: Highlight;");
    expect(forcedColours).toContain("color: HighlightText;");
    expect(forcedColours).toContain("outline-color: CanvasText;");
    expect(css.match(/&\[data-state="checked"\]|\[data-state="checked"\]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("gives cards a 1px border token and inputs a stronger one, both following the theme", async () => {
    const css = await utilitiesFor(["border-border", "border-border-strong"]);

    expect(css).toContain(".border-border {\n    border-color: var(--border);");
    expect(css).toContain(".border-border-strong {\n    border-color: var(--border-strong);");
  });

  it("tightens the whole spacing scale under data-density=compact", async () => {
    const css = await buildGlobals(["p-4"]);
    const compact = /\[data-density="compact"\] \{\s*--spacing: ([^;]+);/.exec(css);

    expect(css).toMatch(/\.p-4 \{\s*padding: calc\(var\(--spacing\) \* 4\);/);
    expect(compact?.[1]).toBe("0.21875rem");
    // At the top level (no indent), not inside a layer, so it beats the theme layer's :root { --spacing }.
    expect(css).toMatch(/^\[data-density="compact"\] \{/m);
  });

  it("loads Tailwind once, through globals.css only", () => {
    const globals = readStylesheet("globals.css");

    expect(globals.match(/@import "tailwindcss";/g)).toHaveLength(1);
    expect(globals).toMatch(/@source "\.\.\/";/);
    for (const partial of ["tokens.css", "theme.css", "base.css"]) {
      expect(readStylesheet(partial), partial).not.toMatch(/@import/);
    }
  });
});

describe("base layer", () => {
  it("shows focus as a 2px solid --ring outline, never as a box-shadow", async () => {
    const base = ownBaseLayer(await buildGlobals());

    expect(base).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--ring\);\s*outline-offset: 2px;\s*\}/);
    expect(base.match(/box-shadow: [^;]+;/g)).toEqual(["box-shadow: none;"]);
    expect(base).not.toMatch(/outline: none|outline-style: none/);
  });

  it("stops animations after one near-instant run under reduced motion", async () => {
    const base = ownBaseLayer(await buildGlobals());
    const reducedMotion = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/.exec(base)?.[1] ?? "";

    expect(reducedMotion).toContain("animation-duration: 0.01ms !important;");
    expect(reducedMotion).toContain("animation-iteration-count: 1 !important;");
    expect(reducedMotion).toContain("transition-duration: 0.01ms !important;");
    expect(reducedMotion).toContain("scroll-behavior: auto !important;");
  });

  it("paints the document with the theme's background, text colour and sans face", async () => {
    const base = ownBaseLayer(await buildGlobals());

    expect(base).toMatch(
      /html \{\s*background-color: var\(--bg\);\s*font-family: var\(--font-inter, "Inter Variable"\)/,
    );
    expect(base).toContain("color: var(--fg);");
  });
});

describe("class sources", () => {
  /** Files that never render in an app: stories, unit tests, test helpers and the Foundations pages. */
  const NOT_SHIPPED = /\.stories\.tsx$|\/__tests__\/|^src\/test\/|^src\/foundations\//;

  it("scans only shipped modules for consumers, never stories, tests, test helpers or Foundations", async () => {
    const files = await scannedFiles(path.join(STYLES_DIR, "globals.css"));
    const modules = globSync("src/{components,hooks,lib}/**/*.{ts,tsx}", { cwd: PACKAGE_DIR })
      .map((file) => file.split(path.sep).join("/"))
      .filter((file) => !NOT_SHIPPED.test(file));

    expect(modules).toEqual(expect.arrayContaining(["src/components/button.tsx", "src/lib/theme.ts"]));
    expect(files).toEqual(expect.arrayContaining(modules));
    expect(files.filter((file) => NOT_SHIPPED.test(file))).toEqual([]);
  });

  it("scans every story again for Storybook, Foundations included, through its own stylesheet", async () => {
    const files = await scannedFiles(path.join(PACKAGE_DIR, ".storybook/preview.css"));
    const stories = globSync("src/**/*.stories.tsx", { cwd: PACKAGE_DIR }).map((file) =>
      file.split(path.sep).join("/"),
    );

    expect(stories).toEqual(expect.arrayContaining(["src/foundations/colors.stories.tsx"]));
    expect(files).toEqual(expect.arrayContaining(["src/components/button.tsx", ...stories]));
    expect(files.filter((file) => /\/__tests__\/|^src\/test\//.test(file))).toEqual([]);
  });
});
