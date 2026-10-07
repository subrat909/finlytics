import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { PACKAGE_DIR, utilitiesFor } from "./compile-css";

const TOKENS_FILE = "src/styles/tokens.css";

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const WHOLE_HEX = new RegExp(`^${HEX.source}$`, "i");
/** Colour functions. color-mix() over tokens is fine, and `in oklab` isn't a call. */
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
/** A Tailwind arbitrary colour value: bg-[#0f172a], text-[rgb(0_0_0)], fill-[color:…]. */
const ARBITRARY_COLOUR = /\[(?:color:|#|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/i;

function files(pattern: string): string[] {
  return globSync(pattern, { cwd: PACKAGE_DIR })
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

function read(file: string): string {
  return readFileSync(path.join(PACKAGE_DIR, file), "utf8");
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every string literal and template chunk in a TS/TSX file: where class names and style values live. */
function stringsIn(file: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, kind);
  const strings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return strings;
}

/** The class lists in `@apply` rules of a stylesheet. */
function appliedClasses(css: string): string[] {
  return [...withoutComments(css).matchAll(/@apply\s+([^;]+);/g)].map((match) => match[1] ?? "");
}

/** Colour names in Tailwind's default theme: shaded palettes (red, slate, …) and single colours (black, white). */
function defaultPalette(): { shaded: string[]; single: string[] } {
  const theme = readFileSync(path.join(PACKAGE_DIR, "node_modules/tailwindcss/theme.css"), "utf8");
  const shaded = new Set([...theme.matchAll(/--color-([a-z]+)-\d+:/g)].map((match) => match[1] ?? ""));
  const single = new Set([...theme.matchAll(/--color-([a-z]+):/g)].map((match) => match[1] ?? ""));
  return { shaded: [...shaded], single: [...single] };
}

/**
 * CSS system colours (CSS Color 4): the user's own palette in forced-colours mode (Windows contrast themes). They're
 * not literals, so the checks above let them through, but they only belong under `forced-colors:`, where the page
 * paints with that palette. Anywhere else they would bypass the tokens.
 */
const SYSTEM_COLOURS = [
  "AccentColor",
  "AccentColorText",
  "ActiveText",
  "ButtonBorder",
  "ButtonFace",
  "ButtonText",
  "Canvas",
  "CanvasText",
  "Field",
  "FieldText",
  "GrayText",
  "Highlight",
  "HighlightText",
  "LinkText",
  "Mark",
  "MarkText",
  "SelectedItem",
  "SelectedItemText",
  "VisitedText",
];
const SYSTEM_COLOUR_VALUE = new RegExp(`\\[(?:color:)?(?:${SYSTEM_COLOURS.join("|")})\\]`, "i");

const COLOUR_UTILITIES =
  "bg|text|border(?:-[xytrblse])?|outline|ring(?:-offset)?|inset-ring|fill|stroke|from|via|to|decoration|divide|" +
  "placeholder|caret|accent|shadow|inset-shadow|drop-shadow|text-shadow";

describe("tokens only", () => {
  it("defines colours only in tokens.css", () => {
    const stylesheets = files("src/**/*.css")
      .filter((file) => file !== TOKENS_FILE)
      .flatMap((file) =>
        withoutComments(read(file))
          .split("\n")
          .filter((line) => HEX.test(line) || COLOUR_FUNCTION.test(line) || ARBITRARY_COLOUR.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      );
    const scripts = files("src/**/*.{ts,tsx}").flatMap((file) =>
      stringsIn(file)
        .filter((text) => WHOLE_HEX.test(text.trim()) || COLOUR_FUNCTION.test(text) || ARBITRARY_COLOUR.test(text))
        .map((text) => `${file}: ${text}`),
    );

    expect(files(TOKENS_FILE)).toEqual([TOKENS_FILE]);
    expect([...stylesheets, ...scripts]).toEqual([]);
  });

  it("uses no Tailwind default-palette colour classes", () => {
    const { shaded, single } = defaultPalette();
    expect(shaded).toContain("red");
    expect(single).toEqual(expect.arrayContaining(["black", "white"]));
    const paletteClass = new RegExp(
      `^-?(?:${COLOUR_UTILITIES})-(?:(?:${shaded.join("|")})-\\d{2,3}|(?:${single.join("|")}))$`,
    );

    const classLists = [
      ...files("src/**/*.{ts,tsx}").flatMap((file) => stringsIn(file).map((text) => ({ file, text }))),
      ...files("src/**/*.css").flatMap((file) => appliedClasses(read(file)).map((text) => ({ file, text }))),
    ];
    const found = classLists.flatMap(({ file, text }) =>
      text
        .split(/\s+/)
        .map((token) => (token.split(":").at(-1) ?? "").replace(/^!|!$/g, "").replace(/\/[\w.%[\]-]+$/, ""))
        .filter((utility) => paletteClass.test(utility))
        .map((utility) => `${file}: ${utility}`),
    );

    expect(found).toEqual([]);
  });

  it("uses CSS system colours only under forced-colors:", () => {
    const uses = files("src/**/*.{ts,tsx}").flatMap((file) =>
      stringsIn(file).flatMap((text) =>
        text
          .split(/\s+/)
          .filter((token) => SYSTEM_COLOUR_VALUE.test(token))
          .map((token) => ({ file, token })),
      ),
    );
    const outsideForcedColours = uses
      .filter(({ token }) => !token.split(":").slice(0, -1).includes("forced-colors"))
      .map(({ file, token }) => `${file}: ${token}`);

    // SegmentedControl's checked option (ThemeToggle's too) uses them (Highlight, HighlightText, CanvasText).
    expect(uses.map(({ file }) => file)).toContain("src/components/segmented-control.tsx");
    expect(outsideForcedColours).toEqual([]);
  });

  it("removes the default palette in theme.css", async () => {
    expect(read("src/styles/theme.css")).toMatch(/--color-\*:\s*initial;/);

    for (const paletteClass of ["bg-red-500", "text-white", "bg-black/50", "border-slate-200", "fill-emerald-600"]) {
      expect(await utilitiesFor([paletteClass]), paletteClass).toBe("");
    }
    expect(await utilitiesFor(["bg-primary"])).toContain("background-color: var(--primary);");
  });
});
