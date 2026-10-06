/**
 * Indian market sessions, for the paper simulator and paper candles (phase 1 plan P2). Regular sessions only, Monday
 * to Friday in IST; exchange holidays (`MarketHoliday`) are not consulted, so a holiday reads as open. Good enough for
 * a simulator: the real feeds simply stop sending ticks.
 *
 * | Exchanges | Session (IST) |
 * |---|---|
 * | NSE, BSE, NFO, BFO | 09:15–15:30 |
 * | MCX | 09:00–23:30 |
 * | CDS | 09:00–17:00 |
 */
import type { Exchange } from "@finlytics/shared";

/** IST is UTC+05:30 all year. */
export const IST_OFFSET_MS = 330 * 60_000;

const DAY_MS = 86_400_000;

/** A session as minutes after IST midnight: `[open, close)`. */
export interface Session {
  readonly openMin: number;
  readonly closeMin: number;
}

const EQUITY: Session = { openMin: 9 * 60 + 15, closeMin: 15 * 60 + 30 };

export const SESSIONS: Readonly<Record<Exchange, Session>> = Object.freeze({
  NSE: EQUITY,
  BSE: EQUITY,
  NFO: EQUITY,
  BFO: EQUITY,
  MCX: { openMin: 9 * 60, closeMin: 23 * 60 + 30 },
  CDS: { openMin: 9 * 60, closeMin: 17 * 60 },
});

/** Epoch ms of IST midnight on the IST day containing `ms`. */
export function istDayStart(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/** Whether `ms` falls on an IST weekday (Monday–Friday). */
export function isIstWeekday(ms: number): boolean {
  const day = new Date(istDayStart(ms) + IST_OFFSET_MS).getUTCDay();
  return day !== 0 && day !== 6;
}

/** Whether the exchange's regular session is open at `ms`. */
export function isMarketOpen(exchange: Exchange, ms: number): boolean {
  if (!isIstWeekday(ms)) return false;
  const minute = Math.floor((ms - istDayStart(ms)) / 60_000);
  const session = SESSIONS[exchange];
  return minute >= session.openMin && minute < session.closeMin;
}

/**
 * The start of the bar of length `barMs` containing `ms`. Bars are aligned to IST midnight (so 1-hour bars start on
 * the IST hour and daily bars at IST midnight, the way Indian brokers stamp them); for 1-, 5- and 15-minute bars that
 * is the same as aligning to the epoch, since 05:30 is a multiple of 15 minutes.
 */
export function alignToBar(ms: number, barMs: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / barMs) * barMs - IST_OFFSET_MS;
}

/** The session's `[open, close)` in epoch ms on the IST day containing `ms`. */
export function sessionBounds(exchange: Exchange, ms: number): { open: number; close: number } {
  const start = istDayStart(ms);
  const session = SESSIONS[exchange];
  return { open: start + session.openMin * 60_000, close: start + session.closeMin * 60_000 };
}
