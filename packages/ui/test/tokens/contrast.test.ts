import { describe, expect, it } from "vitest";

import { NON_TEXT_PAIRS, TEXT_PAIRS, surfaceLabel } from "./contrast-pairs";
import type { ContrastPair, Surface } from "./contrast-pairs";
import {
  HEX_COLOUR,
  THEMES,
  VAR_ALIAS,
  colourTokens,
  readTokenRules,
  resolveColour,
  rootDeclarations,
  themeDeclarations,
} from "./parse-tokens";
import type { Theme } from "./parse-tokens";
import { blend, contrastRatio, parseHex } from "./wcag";
import type { Rgb } from "./wcag";

const rules = readTokenRules();
const tokensByTheme = new Map(THEMES.map((theme) => [theme, colourTokens(themeDeclarations(rules, theme))]));

function tokensOf(theme: Theme): Map<string, string> {
  const tokens = tokensByTheme.get(theme);
  if (!tokens) throw new Error(`no tokens for ${theme}`);
  return tokens;
}

function colour(theme: Theme, token: string): Rgb {
  return parseHex(resolveColour(tokensOf(theme), token));
}

function surfaceColour(theme: Theme, surface: Surface): Rgb {
  return typeof surface === "string"
    ? colour(theme, surface)
    : blend(colour(theme, surface.token), surface.alpha, colour(theme, surface.over));
}

/** The ratio, and a description with the resolved colours for failure messages. */
function measure(theme: Theme, pair: ContrastPair): { pair: string; ratio: number } {
  const foreground = colour(theme, pair.foreground);
  const background = surfaceColour(theme, pair.background);
  const format = (rgb: Rgb): string => `rgb(${rgb.map((channel) => channel.toFixed(1)).join(" ")})`;
  return {
    pair: `${pair.foreground} ${format(foreground)} on ${surfaceLabel(pair.background)} ${format(background)}`,
    ratio: contrastRatio(foreground, background),
  };
}

const textCases = THEMES.flatMap((theme) =>
  TEXT_PAIRS.map((pair) => ({
    theme,
    pair,
    min: pair.min,
    foreground: pair.foreground,
    background: surfaceLabel(pair.background),
  })),
);

describe("colour tokens", () => {
  it("defines every colour token in both themes", () => {
    const light = tokensOf("light");
    const dark = tokensOf("dark");

    expect(light.size).toBeGreaterThan(0);
    expect([...dark.keys()]).toEqual([...light.keys()]);
    // Without JavaScript there is no data-theme yet: :root must carry exactly the light theme.
    expect(colourTokens(rootDeclarations(rules))).toEqual(light);
  });

  it("sets color-scheme for each theme, so native controls and scrollbars match", () => {
    for (const theme of THEMES) {
      expect(themeDeclarations(rules, theme).get("color-scheme"), theme).toBe(theme);
    }
    expect(rootDeclarations(rules).get("color-scheme")).toBe("light");
  });

  it("uses only 6-digit hex values or var() aliases for colour tokens", () => {
    for (const theme of THEMES) {
      const tokens = tokensOf(theme);
      const malformed = [...tokens].filter(([, value]) => !HEX_COLOUR.test(value) && !VAR_ALIAS.test(value));

      expect(malformed, theme).toEqual([]);
      // Every alias resolves to a hex value of the same theme.
      for (const name of tokens.keys()) expect(resolveColour(tokens, name), `${name} (${theme})`).toMatch(HEX_COLOUR);
    }
  });
});

describe("contrast matrix", () => {
  it.each(textCases)("meets $min:1 for $foreground on $background ($theme)", ({ theme, pair }) => {
    const { pair: description, ratio } = measure(theme, pair);

    expect(ratio, description).toBeGreaterThanOrEqual(pair.min);
  });

  it.each(THEMES)("meets 3:1 for the focus outline, the checked segment and input edges (%s)", (theme) => {
    const failing = NON_TEXT_PAIRS.map((pair) => ({ ...measure(theme, pair), min: pair.min })).filter(
      ({ ratio, min }) => ratio < min,
    );

    expect(failing).toEqual([]);
  });
});
