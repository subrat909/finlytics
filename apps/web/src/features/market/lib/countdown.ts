/**
 * Market countdowns (plan phase-1c "Footer"): the next session change of an exchange from the overview's phase and
 * times. NSE/BSE pre-open starts 15 min before `opensAt`; post-close ends at 16:00 IST.
 */
import type { ExchangeStatus } from "@finlytics/shared";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const IST_OFFSET = 330 * MINUTE;
const PRE_OPEN_LEAD = 15 * MINUTE;
const POST_CLOSE_END = 16 * HOUR;

export interface MarketEvent {
  /** `Pre-open in`, `Opens in`, `Closes in`, `Post-close ends in`. */
  readonly label: string;
  /** Epoch ms. */
  readonly at: number;
}

/** What happens next on `session`'s exchange, or undefined when the api gave no time. */
export function nextMarketEvent(session: ExchangeStatus, now: number): MarketEvent | undefined {
  const opensAt = session.opensAt === null ? Number.NaN : Date.parse(session.opensAt);
  const closesAt = session.closesAt === null ? Number.NaN : Date.parse(session.closesAt);
  switch (session.phase) {
    case "open":
      return Number.isFinite(closesAt) ? { label: "Closes in", at: closesAt } : undefined;
    case "pre_open":
      return Number.isFinite(opensAt) ? { label: "Opens in", at: opensAt } : undefined;
    case "post_close": {
      const istMidnight = Math.floor((now + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
      return { label: "Post-close ends in", at: istMidnight + POST_CLOSE_END };
    }
    case "closed": {
      if (!Number.isFinite(opensAt)) return undefined;
      const preOpen = opensAt - PRE_OPEN_LEAD;
      if (session.exchange !== "MCX" && now < preOpen) return { label: "Pre-open in", at: preOpen };
      return { label: "Opens in", at: opensAt };
    }
  }
}

/** `1d 20h`, `2h 14m`, `6m 12s`, `45s`; `0s` once due. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  return `${String(seconds)}s`;
}

/** The navbar's words for a phase. */
export function phaseLabel(session: Pick<ExchangeStatus, "phase" | "holiday">): string {
  switch (session.phase) {
    case "open":
      return "Market open";
    case "pre_open":
      return "Pre-open";
    case "post_close":
      return "Post-close";
    case "closed":
      return session.holiday === null ? "Market closed" : "Holiday";
  }
}

/** The dot's token utility for a phase. */
export function phaseDot(phase: ExchangeStatus["phase"]): string {
  switch (phase) {
    case "open":
      return "bg-profit";
    case "pre_open":
      return "bg-info";
    case "post_close":
      return "bg-warning";
    case "closed":
      return "bg-fg-muted";
  }
}
