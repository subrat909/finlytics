/**
 * WCAG 2.x contrast (plan D6): relative luminance of sRGB colours and the (L1 + 0.05) / (L2 + 0.05) ratio.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

/** sRGB channels, 0–255. Fractional values are allowed (alpha blends aren't rounded). */
export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`"${hex}" is not a 6-digit hex colour`);
  const [, red = "", green = "", blue = ""] = match;
  return [parseInt(red, 16), parseInt(green, 16), parseInt(blue, 16)];
}

function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([red, green, blue]: Rgb): number {
  return 0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue);
}

/** From 1 (no contrast) to 21 (black on white). Symmetric, never rounded. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `foreground` at `alpha` composited over an opaque `background` (source-over in sRGB, as browsers paint it). A
 * Tailwind opacity modifier such as `bg-primary/90` is `color-mix(in oklab, <colour> 90%, transparent)`: the same
 * colour at 90% alpha.
 */
export function blend(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  if (alpha < 0 || alpha > 1) throw new RangeError(`alpha ${String(alpha)} is outside 0–1`);
  const mix = (index: 0 | 1 | 2): number => alpha * foreground[index] + (1 - alpha) * background[index];
  return [mix(0), mix(1), mix(2)];
}
