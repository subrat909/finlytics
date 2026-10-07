/**
 * Exchange session phases in IST (phase-1b "Market overview"; `MARKET_PHASES` in @finlytics/shared):
 *
 * | Exchange | pre_open    | open        | post_close  |
 * |----------|-------------|-------------|-------------|
 * | NSE, BSE | 09:00–09:15 | 09:15–15:30 | 15:30–16:00 |
 * | MCX      | —           | 09:00–23:30 | —           |
 *
 * Anything else is `closed`: weekends, `MarketHoliday` days (NSE and BSE close the whole day; MCX may close only its
 * morning, 09:00–17:00, or evening, 17:00–23:30, session), and the hours around the sessions. `opensAt` is the next
 * session's start (the normal market's open, not the pre-open) while not open; `closesAt` today's close during
 * pre-open and open. The 23:55 MCX close in US daylight saving and special sessions (Muhurat) are not modelled.
 */
import type { ExchangeStatus, MarketExchange, MarketPhase } from "@finlytics/shared";

import { IST_OFFSET_MS, istDayStart } from "../../feed/market-hours";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** How far ahead the next session is looked for (the longest closure, Diwali and a weekend, is far shorter). */
export const LOOKAHEAD_DAYS = 15;

/** A day's session as minutes after IST midnight. */
interface Schedule {
  readonly preOpen?: number;
  readonly open: number;
  readonly close: number;
  readonly postClose?: number;
}

const EQUITY: Schedule = Object.freeze({ preOpen: 9 * 60, open: 9 * 60 + 15, close: 15 * 60 + 30, postClose: 16 * 60 });
const MCX: Schedule = Object.freeze({ open: 9 * 60, close: 23 * 60 + 30 });
/** Where MCX's morning session ends and its evening session starts. */
const MCX_SPLIT = 17 * 60;

export const SCHEDULES: Readonly<Record<MarketExchange, Schedule>> = Object.freeze({ NSE: EQUITY, BSE: EQUITY, MCX });

export type HolidayClosure = "FULL_DAY" | "MORNING_SESSION" | "EVENING_SESSION";

/** A `MarketHoliday` row: the IST date (`YYYY-MM-DD`), its calendar, name and what closes. */
export interface HolidayEntry {
  readonly date: string;
  readonly exchange: string;
  readonly name: string;
  readonly closure: HolidayClosure;
}

/** Holidays by `<exchange>:<YYYY-MM-DD>`. */
export type HolidayIndex = ReadonlyMap<string, HolidayEntry>;

export function holidayIndex(entries: readonly HolidayEntry[]): HolidayIndex {
  return new Map(entries.map((entry) => [`${entry.exchange}:${entry.date}`, entry]));
}

/** The IST calendar date (`YYYY-MM-DD`) of the IST day starting at `dayStart`. */
export function istDate(dayStart: number): string {
  return new Date(dayStart + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function isWeekend(dayStart: number): boolean {
  const day = new Date(dayStart + IST_OFFSET_MS).getUTCDay();
  return day === 0 || day === 6;
}

/** The exchange's session on the IST day starting at `dayStart` (undefined: closed all day) and its holiday. */
export function scheduleOn(
  exchange: MarketExchange,
  dayStart: number,
  holidays: HolidayIndex,
): { schedule: Schedule | undefined; holiday: HolidayEntry | undefined } {
  if (isWeekend(dayStart)) return { schedule: undefined, holiday: undefined };
  const holiday = holidays.get(`${exchange}:${istDate(dayStart)}`);
  const base = SCHEDULES[exchange];
  if (holiday === undefined) return { schedule: base, holiday };
  if (exchange === "MCX" && holiday.closure === "MORNING_SESSION") {
    return { schedule: { open: MCX_SPLIT, close: base.close }, holiday };
  }
  if (exchange === "MCX" && holiday.closure === "EVENING_SESSION") {
    return { schedule: { open: base.open, close: MCX_SPLIT }, holiday };
  }
  return { schedule: undefined, holiday };
}

/** The next session start strictly after the IST day starting at `dayStart`, or null beyond the lookahead. */
function nextSessionStart(exchange: MarketExchange, dayStart: number, holidays: HolidayIndex): number | null {
  for (let offset = 1; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const day = dayStart + offset * DAY_MS;
    const { schedule } = scheduleOn(exchange, day, holidays);
    if (schedule !== undefined) return day + schedule.open * MINUTE_MS;
  }
  return null;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Where `exchange`'s day is at `now`. */
export function exchangeStatus(exchange: MarketExchange, now: number, holidays: HolidayIndex): ExchangeStatus {
  const dayStart = istDayStart(now);
  const minute = (now - dayStart) / MINUTE_MS;
  const { schedule, holiday } = scheduleOn(exchange, dayStart, holidays);
  const at = (minuteOfDay: number): number => dayStart + minuteOfDay * MINUTE_MS;
  const closed = (opensAt: number | null, holidayName: string | null): ExchangeStatus => ({
    exchange,
    phase: "closed",
    holiday: holidayName,
    opensAt: iso(opensAt),
    closesAt: null,
  });
  if (schedule === undefined) return closed(nextSessionStart(exchange, dayStart, holidays), holiday?.name ?? null);

  let phase: MarketPhase;
  if (minute >= schedule.open && minute < schedule.close) phase = "open";
  else if (schedule.preOpen !== undefined && minute >= schedule.preOpen && minute < schedule.open) phase = "pre_open";
  else if (schedule.postClose !== undefined && minute >= schedule.close && minute < schedule.postClose)
    phase = "post_close";
  else phase = "closed";

  const holidayName = holiday?.name ?? null;
  switch (phase) {
    case "open":
      return { exchange, phase, holiday: null, opensAt: null, closesAt: iso(at(schedule.close)) };
    case "pre_open":
      return { exchange, phase, holiday: null, opensAt: iso(at(schedule.open)), closesAt: iso(at(schedule.close)) };
    case "post_close":
      return {
        exchange,
        phase,
        holiday: null,
        opensAt: iso(nextSessionStart(exchange, dayStart, holidays)),
        closesAt: null,
      };
    default:
      return minute < schedule.open
        ? closed(at(schedule.open), holidayName)
        : closed(nextSessionStart(exchange, dayStart, holidays), holidayName);
  }
}
