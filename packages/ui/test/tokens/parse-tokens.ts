/**
 * Reads tokens.css (plan D6). A deliberately small parser for that one file: top-level rules whose selector lists use
 * only the theme selectors below, holding plain declarations. Anything else (at-rules, nesting, other selectors) throws,
 * so the token tests can't silently misread the file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];

export const TOKENS_CSS_PATH = fileURLToPath(new URL("../../src/styles/tokens.css", import.meta.url));

/** Custom properties in tokens.css that aren't colours. Every other one is a colour token. */
export const NON_COLOUR_TOKENS: ReadonlySet<string> = new Set(["--radius", "--sidebar-w", "--sidebar-w-collapsed"]);

const ROOT = ":root";
const ANY_THEME = "[data-theme]";
const themeSelector = (theme: Theme): string => `[data-theme="${theme}"]`;
const KNOWN_SELECTORS: ReadonlySet<string> = new Set([ROOT, ANY_THEME, ...THEMES.map(themeSelector)]);

export interface TokenRule {
  readonly selectors: readonly string[];
  /** Declarations in source order: custom properties and plain ones (color-scheme). */
  readonly declarations: ReadonlyMap<string, string>;
}

export function parseRules(css: string): TokenRule[] {
  let rest = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: TokenRule[] = [];

  while (rest.trim() !== "") {
    const open = rest.indexOf("{");
    const close = rest.indexOf("}");
    if (open === -1 || close < open)
      throw new Error(`tokens.css: unbalanced braces near "${rest.trim().slice(0, 40)}"`);
    const block = rest.slice(open + 1, close);
    if (block.includes("{")) throw new Error("tokens.css: nested rules are not supported");

    const selectors = rest
      .slice(0, open)
      .split(",")
      .map((selector) => selector.trim());
    for (const selector of selectors) {
      if (!KNOWN_SELECTORS.has(selector)) {
        throw new Error(`tokens.css: unexpected selector "${selector}" (allowed: ${[...KNOWN_SELECTORS].join(", ")})`);
      }
    }

    const declarations = new Map<string, string>();
    for (const declaration of block.split(";")) {
      if (declaration.trim() === "") continue;
      const colon = declaration.indexOf(":");
      if (colon === -1) throw new Error(`tokens.css: malformed declaration "${declaration.trim()}"`);
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }

    rules.push({ selectors, declarations });
    rest = rest.slice(close + 1);
  }
  return rules;
}

export function readTokenRules(): TokenRule[] {
  return parseRules(readFileSync(TOKENS_CSS_PATH, "utf8"));
}

function collect(rules: readonly TokenRule[], applies: (selectors: readonly string[]) => boolean): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const rule of rules) {
    if (applies(rule.selectors)) {
      for (const [property, value] of rule.declarations) declarations.set(property, value);
    }
  }
  return declarations;
}

/**
 * What an element with `data-theme="<theme>"` declares itself, in cascade order (all these selectors have the same
 * specificity, so source order decides). Deliberately excludes `:root`: a themed island must get every colour from its
 * own theme, not inherit the page's.
 */
export function themeDeclarations(rules: readonly TokenRule[], theme: Theme): Map<string, string> {
  return collect(rules, (selectors) => selectors.includes(themeSelector(theme)) || selectors.includes(ANY_THEME));
}

/** What `:root` declares on its own: the page before a theme is applied (no JavaScript). */
export function rootDeclarations(rules: readonly TokenRule[]): Map<string, string> {
  return collect(rules, (selectors) => selectors.includes(ROOT));
}

/** Colour tokens (name, value), without the `--` prefix, sorted by name. */
export function colourTokens(declarations: ReadonlyMap<string, string>): Map<string, string> {
  const entries = [...declarations]
    .filter(([property]) => property.startsWith("--") && !NON_COLOUR_TOKENS.has(property))
    .map(([property, value]): [string, string] => [property.slice(2), value])
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return new Map(entries);
}

export const HEX_COLOUR = /^#[0-9a-f]{6}$/;
export const VAR_ALIAS = /^var\(--([a-z0-9-]+)\)$/;

/** Follows var() aliases to a hex value. Throws on a missing token, an unknown value form or a cycle. */
export function resolveColour(tokens: ReadonlyMap<string, string>, name: string): string {
  const seen: string[] = [];
  let current = name;
  for (;;) {
    if (seen.includes(current)) throw new Error(`token cycle: ${[...seen, current].join(" -> ")}`);
    seen.push(current);
    const value = tokens.get(current);
    if (value === undefined) throw new Error(`unknown colour token "${current}"`);
    if (HEX_COLOUR.test(value)) return value;
    const alias = VAR_ALIAS.exec(value);
    if (!alias?.[1]) throw new Error(`"${current}" is "${value}": neither a 6-digit hex value nor a var() alias`);
    current = alias[1];
  }
}
