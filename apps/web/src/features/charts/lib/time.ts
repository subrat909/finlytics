/**
 * Chart time. Bars are epoch seconds shifted by IST's +05:30, so Lightweight Charts (which draws UTC) labels the axis
 * in market time on any device. Every helper here works on those shifted seconds; none uses `Intl` (deterministic).
 */

export const IST_OFFSET_S = 19_800;
export const DAY_S = 86_400;
const WEEK_S = 7 * DAY_S;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Epoch ms (UTC) → IST-shifted epoch seconds. */
export function toChartTime(ms: number): number {
  return Math.floor(ms / 1_000) + IST_OFFSET_S;
}

/** IST-shifted seconds → real epoch seconds (what the api's `from`/`to` take). */
export function toEpochSeconds(time: number): number {
  return time - IST_OFFSET_S;
}

/** 00:00 IST of the day containing `time`. */
export function dayStart(time: number): number {
  return Math.floor(time / DAY_S) * DAY_S;
}

/** Monday 00:00 IST of the week containing `time` (1970-01-01 was a Thursday). */
export function weekStart(time: number): number {
  const day = Math.floor(time / DAY_S);
  return (day - ((((day + 3) % 7) + 7) % 7)) * DAY_S;
}

/** 1 January 00:00 IST of the year containing `time`. */
export function yearStart(time: number): number {
  return Date.UTC(new Date(time * 1_000).getUTCFullYear(), 0, 1) / 1_000;
}

/** 0 = Sunday … 6 = Saturday, in IST. */
export function weekdayOf(time: number): number {
  return new Date(time * 1_000).getUTCDay();
}

export function isWeekend(time: number): boolean {
  const day = weekdayOf(time);
  return day === 0 || day === 6;
}

/** The start of the IST day `count` weekdays before the day containing `time` (0 = that day). */
export function weekdaysBack(time: number, count: number): number {
  let start = dayStart(time);
  let left = count;
  while (left > 0) {
    start -= DAY_S;
    if (!isWeekend(start)) left -= 1;
  }
  return start;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `10:15:32` in IST, from epoch ms. */
export function formatClock(nowMs: number): string {
  const ist = new Date(nowMs + IST_OFFSET_S * 1_000);
  return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
}

/** `Tue 06 Oct '26 10:15` (intraday) or `Tue 06 Oct '26` for a chart time. */
export function formatBarTime(time: number, intraday: boolean): string {
  const date = new Date(time * 1_000);
  const day = `${WEEKDAYS[date.getUTCDay()] ?? ""} ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""} '${String(date.getUTCFullYear()).slice(2)}`;
  return intraday ? `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : day;
}

/** `2026-10-06_1015`: a file-name-safe stamp for a chart time. */
export function fileStamp(time: number): string {
  const date = new Date(time * 1_000);
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/** A span of seconds in words: `45m`, `3h 20m`, `4d 2h`, `12w`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Math.abs(seconds) / 60));
  if (total < 60) return `${String(total)}m`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return total % 60 === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(total % 60)}m`;
  const days = Math.floor(hours / 24);
  if (days < 14) return hours % 24 === 0 ? `${String(days)}d` : `${String(days)}d ${String(hours % 24)}h`;
  return `${String(Math.round(Math.abs(seconds) / WEEK_S))}w`;
}
