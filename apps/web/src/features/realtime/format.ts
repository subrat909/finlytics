/**
 * Deterministic number formatting for live cells (no `Intl`: the server render and the browser must agree). Prices
 * use Indian digit grouping from @finlytics/shared without the rupee sign: an index level isn't rupees.
 */
import { formatInr, formatInrCompact } from "@finlytics/shared";

/** The placeholder for a value that hasn't arrived. */
export const NO_VALUE = "—";

function fixed2(value: number): string {
  // toFixed is locale-free; -0.004 rounds to "-0.00", which formatInr prints unsigned.
  return value.toFixed(2);
}

/** `24,012.35` */
export function formatPrice(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? NO_VALUE
    : formatInr(fixed2(value), { symbol: false });
}

/** `+120.50`, `-3.05`, `0.00` */
export function formatChange(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? NO_VALUE
    : formatInr(fixed2(value), { symbol: false, sign: "always" });
}

/** `+0.52%`, `-1.10%`, `0.00%` */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${formatInr(fixed2(value), { symbol: false, sign: "always" })}%`;
}

/** `12.3 L` (lakh), `4.5 Cr` (crore): volume and open interest. */
export function formatQuantityCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return formatInrCompact(String(Math.round(value)), { maxDecimals: 1 }).replace("₹", "");
}

export type Direction = "up" | "down" | "flat";

export function directionOf(change: number | null | undefined): Direction {
  if (change === null || change === undefined || !Number.isFinite(change)) return "flat";
  if (Math.round(change * 100) > 0) return "up";
  if (Math.round(change * 100) < 0) return "down";
  return "flat";
}

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `7 Oct 2026, 03:30 IST`: Indian time whatever the device's zone (the market's clock). */
export function formatIstDateTime(value: string | number | Date): string {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return NO_VALUE;
  const ist = new Date(ms + IST_OFFSET_MS);
  const month = MONTHS[ist.getUTCMonth()] ?? "";
  return `${String(ist.getUTCDate())} ${month} ${String(ist.getUTCFullYear())}, ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
}

/** `7 Oct 2026` in IST. */
export function formatIstDate(value: string | number | Date): string {
  const text = formatIstDateTime(value);
  return text === NO_VALUE ? text : text.slice(0, text.indexOf(","));
}
