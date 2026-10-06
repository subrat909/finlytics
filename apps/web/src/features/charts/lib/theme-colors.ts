/**
 * Chart colours from the design tokens (frontend.md: tokens only). Canvas charts can't use CSS classes, so the token
 * values are read from the computed style of the chart's element, which also follows a themed island.
 */
export interface ChartColors {
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  upVolume: string;
  downVolume: string;
  crosshair: string;
}

function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** `#rrggbb` + alpha → `rgba()`; anything else is returned as is (tokens are 6-digit hex, enforced by test/tokens). */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return color;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? "0", 16));
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

export function readChartColors(element: Element): ChartColors {
  const style = getComputedStyle(element);
  const up = token(style, "--profit");
  const down = token(style, "--loss");
  return {
    text: token(style, "--fg-muted"),
    grid: token(style, "--surface-2"),
    border: token(style, "--surface-3"),
    up,
    down,
    upVolume: withAlpha(up, 0.35),
    downVolume: withAlpha(down, 0.35),
    crosshair: token(style, "--fg-muted"),
  };
}
