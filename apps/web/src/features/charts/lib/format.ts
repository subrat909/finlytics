/**
 * Number formatting for the chart's legend, panels and canvases: Indian digit grouping, a fixed number of decimals,
 * no `Intl` (server and browser agree) and no Decimal.js on the crosshair's hot path. Display only, never arithmetic.
 */

export const NO_VALUE = "—";

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** `1234567` → `12,34,567` (lakh grouping). */
function groupIndian(integer: string): string {
  if (integer.length <= 3) return integer;
  const last = integer.slice(-3);
  const rest = integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last}`;
}

/** Decimals a tick size needs: `0.05` → 2, `0.0025` → 4, `1` → 0. Capped at 6. */
export function precisionOf(tickSize: string | number | undefined): number {
  if (tickSize === undefined) return 2;
  const text = typeof tickSize === "number" ? String(tickSize) : tickSize;
  const fraction = text.split(".")[1]?.replace(/0+$/, "") ?? "";
  return Math.min(Math.max(fraction.length, 2), 6);
}

/** `24,012.35`; `sign: "always"` gives `+12.35` / `-3.05`. */
export function formatNumber(value: number | null | undefined, decimals = 2, sign: "auto" | "always" = "auto"): string {
  if (!isNumber(value)) return NO_VALUE;
  const fixed = Math.abs(value).toFixed(decimals);
  const [integer = "0", fraction] = fixed.split(".");
  const zero = Number(fixed) === 0;
  const prefix = zero ? "" : value < 0 ? "-" : sign === "always" ? "+" : "";
  return `${prefix}${groupIndian(integer)}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** `+0.52%` */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  return isNumber(value) ? `${formatNumber(value, decimals, "always")}%` : NO_VALUE;
}

const UNITS = [
  { scale: 1e7, suffix: " Cr" },
  { scale: 1e5, suffix: " L" },
  { scale: 1e3, suffix: " K" },
] as const;

/** Volume and open interest: `12.3 L`, `4.56 Cr`, `850`. */
export function formatCompact(value: number | null | undefined): string {
  if (!isNumber(value)) return NO_VALUE;
  const magnitude = Math.abs(value);
  const unit = UNITS.find((candidate) => magnitude >= candidate.scale);
  if (unit === undefined) return formatNumber(value, 0);
  const scaled = Math.round((magnitude / unit.scale) * 100) / 100;
  const text = scaled.toFixed(2).replace(/\.?0+$/, "");
  return `${value < 0 ? "-" : ""}${text}${unit.suffix}`;
}

export type Direction = "up" | "down" | "flat";

export function directionOf(change: number | null | undefined): Direction {
  if (!isNumber(change)) return "flat";
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}
