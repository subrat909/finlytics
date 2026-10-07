/**
 * Money display for the portfolio (deterministic, no `Intl`: the server render and the browser agree). Rupees with
 * Indian grouping from @finlytics/shared; a signed amount carries its direction for the ▲/▼ glyph and the colour.
 */
import { formatInr, formatInrCompact } from "@finlytics/shared";
import type { Decimal } from "@finlytics/shared";

import type { Direction } from "@/features/realtime/format";

export const NO_VALUE = "—";

type Amount = Decimal | string | null | undefined;

/** `₹1,23,456.78`; `+₹1,234.50` with `signed`. */
export function formatMoney(value: Amount, options: { signed?: boolean } = {}): string {
  if (value === null || value === undefined) return NO_VALUE;
  return formatInr(value, { sign: options.signed ? "always" : "auto" });
}

/** `₹12.3 L`, `₹1.2 Cr`: tiles and summaries. */
export function formatMoneyCompact(value: Amount): string {
  if (value === null || value === undefined) return NO_VALUE;
  return formatInrCompact(value, { maxDecimals: 2 });
}

/** A signed amount's direction, after rounding to paise (−0.004 is flat). */
export function moneyDirection(value: Amount): Direction {
  if (value === null || value === undefined) return "flat";
  const text = formatInr(value, { symbol: false });
  if (/^-/.test(text)) return "down";
  return /[1-9]/.test(text) ? "up" : "flat";
}

/** Text colour for a direction (colour is never the only signal: the glyph and words go with it). */
export const DIRECTION_TEXT: Readonly<Record<Direction, string>> = {
  up: "text-profit",
  down: "text-loss",
  flat: "text-fg",
};

export const DIRECTION_GLYPH: Readonly<Record<Direction, string>> = { up: "▲", down: "▼", flat: "" };

/** What a screen reader hears instead of the glyph. */
export const DIRECTION_WORD: Readonly<Record<Direction, string>> = { up: "profit", down: "loss", flat: "" };

const IST_OFFSET_MS = 330 * 60_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `10:32:05 IST`. */
export function formatIstTime(value: string | number): string {
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return NO_VALUE;
  const ist = new Date(ms + IST_OFFSET_MS);
  return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())} IST`;
}

/** `5h 12m`, `42m`, `3d 4h`: a duration for countdowns (minute precision, never negative). */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
  if (hours > 0) return `${String(hours)}h ${pad(rest)}m`;
  return `${String(rest)}m`;
}
