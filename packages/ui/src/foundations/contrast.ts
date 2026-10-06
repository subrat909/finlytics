/**
 * Live contrast ratios for the Foundations stories: the current theme's token values, read from the document, measured
 * with the WCAG 2.x formula. The CI gate is test/tokens/contrast.test.ts (same formula, every pair in both themes);
 * this only shows the numbers next to the swatches.
 */

type Rgb = readonly [number, number, number];

/** The token's value in the theme on <html>, with var() aliases resolved ("#4f46e5"). */
export function readToken(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
}

/** Parses #rrggbb, or #rgb, which the production CSS minifier writes for values like #ffffff. */
export function parseHex(hex: string): Rgb | undefined {
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const parts = long ? long.slice(1) : short?.slice(1).map((digit) => digit + digit);
  if (!parts) return undefined;
  const [red = "", green = "", blue = ""] = parts;
  return [parseInt(red, 16), parseInt(green, 16), parseInt(blue, 16)];
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast ratio of two tokens in the current theme, or undefined when a value isn't a hex colour. */
export function tokenContrast(foreground: string, background: string): number | undefined {
  const a = parseHex(readToken(foreground));
  const b = parseHex(readToken(background));
  if (!a || !b) return undefined;
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
