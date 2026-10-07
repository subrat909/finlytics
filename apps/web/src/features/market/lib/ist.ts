/**
 * Indian Standard Time without `Intl` (the server render and the browser must agree, and the market's clock is IST
 * whatever the device's zone). IST is UTC+05:30 all year: no daylight saving.
 */
import type { BrokerCode, ExchangeStatus, MarketExchange } from "@finlytics/shared";

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The IST wall clock at `ms` (epoch milliseconds). */
export function istClock(ms: number): { hours: number; minutes: number; seconds: number } {
  const ist = new Date(ms + IST_OFFSET_MS);
  return { hours: ist.getUTCHours(), minutes: ist.getUTCMinutes(), seconds: ist.getUTCSeconds() };
}

/** `09:15`, or `09:15:42` with seconds. */
export function formatIstTime(ms: number, withSeconds = false): string {
  const { hours, minutes, seconds } = istClock(ms);
  return withSeconds ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}`;
}

/** The IST calendar day number (days since the epoch, in IST), to compare dates. */
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/**
 * When a session starts or ends, relative to `now`, in IST: `09:15` today, `Mon 09:15` within the week, `12 Oct 09:15`
 * further out. Undefined for an unreadable time.
 */
export function formatSessionTime(iso: string, now: number): string | undefined {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  const time = formatIstTime(ms);
  const days = istDay(ms) - istDay(now);
  const ist = new Date(ms + IST_OFFSET_MS);
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${WEEKDAYS[ist.getUTCDay()] ?? ""} ${time}`;
  return `${String(ist.getUTCDate())} ${MONTHS[ist.getUTCMonth()] ?? ""} ${time}`;
}

/** How a session reads in the status bar: a dot colour, a word, and when it next changes. */
export interface SessionView {
  exchange: MarketExchange;
  /** `Open`, `Pre-open`, `Post-close`, `Closed`, `Holiday`. */
  label: string;
  /** `closes 15:30`, `opens Mon 09:15`; undefined when the api didn't say. */
  detail: string | undefined;
  /** The dot's token utility. */
  dot: string;
  /** The holiday's name, for a tooltip. */
  holiday: string | null;
}

/** An exchange's session as the status bar shows it (phases per `MARKET_PHASES`, times in IST). */
export function describeSession(status: ExchangeStatus, now: number): SessionView {
  const opens = status.opensAt === null ? undefined : formatSessionTime(status.opensAt, now);
  const closes = status.closesAt === null ? undefined : formatSessionTime(status.closesAt, now);
  const base = { exchange: status.exchange, holiday: status.holiday };
  switch (status.phase) {
    case "open":
      return { ...base, label: "Open", detail: closes && `closes ${closes}`, dot: "bg-profit" };
    case "pre_open":
      return {
        ...base,
        label: "Pre-open",
        detail: opens ? `opens ${opens}` : closes && `closes ${closes}`,
        dot: "bg-info",
      };
    case "post_close":
      return { ...base, label: "Post-close", detail: opens && `opens ${opens}`, dot: "bg-warning" };
    case "closed":
      return {
        ...base,
        label: status.holiday === null ? "Closed" : "Holiday",
        detail: opens && `opens ${opens}`,
        dot: "bg-fg-muted",
      };
  }
}

/** Broker names as people write them (the feed's source). */
export const BROKER_NAMES: Readonly<Record<BrokerCode, string>> = {
  UPSTOX: "Upstox",
  DHAN: "Dhan",
  ZERODHA: "Zerodha",
  ANGELONE: "Angel One",
  FYERS: "Fyers",
  SHOONYA: "Shoonya",
  PAPER: "Paper",
};
