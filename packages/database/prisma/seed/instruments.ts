/**
 * Development instruments (plan P6): about 190 common NSE/BSE instruments, so search, watchlists and charts work
 * without broker credentials or an instrument-master sync. **Not reference data**: lot sizes, freeze quantities and the
 * strike grids are approximate, and the option strikes sit around a fixed reference level, not the live market.
 *
 * - Indices, the NIFTY 50 stocks, NIFTY and BANKNIFTY current-month futures, NIFTY options for the next weekly and
 *   the current monthly expiry, BANKNIFTY options for the current monthly expiry.
 * - Expiries follow NSE's Tuesday schedule (weekly NIFTY; monthly = the month's last Tuesday), moved to the previous
 *   trading day when that Tuesday is an NSE holiday in the seeded holiday calendar.
 * - Idempotent: rows are upserted by key (their `brokerTokens` are never touched), and derivatives that have expired by
 *   `today` are marked inactive, never deleted. Runs only outside production (prisma/seed.ts).
 */
import { formatInstrumentKey, parseInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey, OptionType, SegmentToken } from "@finlytics/shared";

import type { Exchange, PrismaClient, Segment } from "../../src/index";
import { holidayRows, loadHolidayFiles } from "./holidays";
import type { HolidayFile } from "./holidays";

/** One seeded instrument: the Instrument columns the seed sets. */
export interface DevInstrumentRow {
  readonly key: InstrumentKey;
  readonly exchange: Exchange;
  readonly segment: Segment;
  readonly symbol: string;
  readonly tradingSymbol: string;
  readonly name: string;
  readonly expiry: Date | null;
  readonly strike: string | null;
  readonly optionType: OptionType | null;
  readonly lotSize: number;
  readonly tickSize: string;
  readonly freezeQty: number | null;
}

const INDICES: readonly { token: SegmentToken; symbol: string; name: string }[] = [
  { token: "NSE_INDEX", symbol: "NIFTY 50", name: "Nifty 50" },
  { token: "NSE_INDEX", symbol: "NIFTY BANK", name: "Nifty Bank" },
  { token: "NSE_INDEX", symbol: "NIFTY FIN SERVICE", name: "Nifty Financial Services" },
  { token: "NSE_INDEX", symbol: "NIFTY MID SELECT", name: "Nifty Midcap Select" },
  { token: "NSE_INDEX", symbol: "NIFTY NEXT 50", name: "Nifty Next 50" },
  { token: "NSE_INDEX", symbol: "NIFTY IT", name: "Nifty IT" },
  { token: "NSE_INDEX", symbol: "INDIA VIX", name: "India VIX" },
  { token: "BSE_INDEX", symbol: "SENSEX", name: "BSE Sensex" },
  { token: "BSE_INDEX", symbol: "BANKEX", name: "BSE Bankex" },
];

/** NIFTY 50 constituents (approximate; the index is rebalanced twice a year). */
const NIFTY_50: readonly (readonly [symbol: string, name: string])[] = [
  ["ADANIENT", "Adani Enterprises"],
  ["ADANIPORTS", "Adani Ports and Special Economic Zone"],
  ["APOLLOHOSP", "Apollo Hospitals Enterprise"],
  ["ASIANPAINT", "Asian Paints"],
  ["AXISBANK", "Axis Bank"],
  ["BAJAJ-AUTO", "Bajaj Auto"],
  ["BAJAJFINSV", "Bajaj Finserv"],
  ["BAJFINANCE", "Bajaj Finance"],
  ["BEL", "Bharat Electronics"],
  ["BHARTIARTL", "Bharti Airtel"],
  ["CIPLA", "Cipla"],
  ["COALINDIA", "Coal India"],
  ["DRREDDY", "Dr. Reddy's Laboratories"],
  ["EICHERMOT", "Eicher Motors"],
  ["ETERNAL", "Eternal"],
  ["GRASIM", "Grasim Industries"],
  ["HCLTECH", "HCL Technologies"],
  ["HDFCBANK", "HDFC Bank"],
  ["HDFCLIFE", "HDFC Life Insurance Company"],
  ["HINDALCO", "Hindalco Industries"],
  ["HINDUNILVR", "Hindustan Unilever"],
  ["ICICIBANK", "ICICI Bank"],
  ["INDIGO", "InterGlobe Aviation"],
  ["INFY", "Infosys"],
  ["ITC", "ITC"],
  ["JIOFIN", "Jio Financial Services"],
  ["JSWSTEEL", "JSW Steel"],
  ["KOTAKBANK", "Kotak Mahindra Bank"],
  ["LT", "Larsen & Toubro"],
  ["M&M", "Mahindra & Mahindra"],
  ["MARUTI", "Maruti Suzuki India"],
  ["MAXHEALTH", "Max Healthcare Institute"],
  ["NESTLEIND", "Nestle India"],
  ["NTPC", "NTPC"],
  ["ONGC", "Oil and Natural Gas Corporation"],
  ["POWERGRID", "Power Grid Corporation of India"],
  ["RELIANCE", "Reliance Industries"],
  ["SBILIFE", "SBI Life Insurance Company"],
  ["SBIN", "State Bank of India"],
  ["SHRIRAMFIN", "Shriram Finance"],
  ["SUNPHARMA", "Sun Pharmaceutical Industries"],
  ["TATACONSUM", "Tata Consumer Products"],
  ["TATASTEEL", "Tata Steel"],
  ["TCS", "Tata Consultancy Services"],
  ["TECHM", "Tech Mahindra"],
  ["TITAN", "Titan Company"],
  ["TMPV", "Tata Motors Passenger Vehicles"],
  ["TRENT", "Trent"],
  ["ULTRACEMCO", "UltraTech Cement"],
  ["WIPRO", "Wipro"],
];

/** The F&O underlyings: reference level, strike step, strikes per expiry, lot size and freeze quantity. */
const UNDERLYINGS = {
  NIFTY: { name: "Nifty", reference: 25_000, step: 50, lotSize: 65, freezeQty: 1_800 },
  BANKNIFTY: { name: "Bank Nifty", reference: 56_000, step: 100, lotSize: 30, freezeQty: 900 },
} as const;
type Underlying = keyof typeof UNDERLYINGS;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
/** NSE's one-character month in weekly option symbols: 1–9, then O, N, D. */
const WEEKLY_MONTH_CODES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "O", "N", "D"] as const;
const TUESDAY = 2;
const DAY_MS = 86_400_000;

/** UTC midnight of a date. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The NSE trading holidays (FULL_DAY rows) of the seeded calendar, as YYYY-MM-DD. */
export function nseHolidays(files: readonly HolidayFile[] = loadHolidayFiles()): ReadonlySet<string> {
  return new Set(files.flatMap((file) => holidayRows(file, "NSE").map((row) => isoDate(row.date))));
}

/** `date`, or the closest earlier weekday that isn't an NSE holiday. */
export function previousTradingDay(date: Date, holidays: ReadonlySet<string>): Date {
  let day = date;
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6 || holidays.has(isoDate(day))) {
    day = new Date(day.getTime() - DAY_MS);
  }
  return day;
}

/** The last Tuesday of a month (UTC). */
function lastTuesday(year: number, month: number): Date {
  const last = utcDay(year, month + 1, 0);
  const back = (last.getUTCDay() - TUESDAY + 7) % 7;
  return new Date(last.getTime() - back * DAY_MS);
}

/** The next weekly (Tuesday) expiry on or after `today`, holiday-adjusted. */
export function nextWeeklyExpiry(today: Date, holidays: ReadonlySet<string>): Date {
  for (let offset = 0; offset < 21; offset += 1) {
    const tuesday = new Date(today.getTime() + offset * DAY_MS);
    if (tuesday.getUTCDay() !== TUESDAY) continue;
    const expiry = previousTradingDay(tuesday, holidays);
    if (expiry.getTime() >= today.getTime()) return expiry;
  }
  throw new RangeError("No weekly expiry within three weeks");
}

/** The current monthly expiry (the month's last Tuesday, holiday-adjusted), or next month's once it has passed. */
export function nextMonthlyExpiry(today: Date, holidays: ReadonlySet<string>): Date {
  for (let ahead = 0; ahead < 3; ahead += 1) {
    const expiry = previousTradingDay(lastTuesday(today.getUTCFullYear(), today.getUTCMonth() + ahead), holidays);
    if (expiry.getTime() >= today.getTime()) return expiry;
  }
  throw new RangeError("No monthly expiry within three months");
}

/** NSE-style F&O trading symbols. */
function derivativeSymbol(underlying: string, expiry: Date, monthly: boolean, suffix: string): string {
  const yy = String(expiry.getUTCFullYear() % 100).padStart(2, "0");
  const month = expiry.getUTCMonth();
  if (monthly) return `${underlying}${yy}${MONTHS[month] ?? ""}${suffix}`;
  return `${underlying}${yy}${WEEKLY_MONTH_CODES[month] ?? ""}${String(expiry.getUTCDate()).padStart(2, "0")}${suffix}`;
}

function displayDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()] ?? ""} ${String(date.getUTCFullYear())}`;
}

function optionRows(underlying: Underlying, expiry: Date, monthly: boolean, strikes: number): DevInstrumentRow[] {
  const spec = UNDERLYINGS[underlying];
  const half = Math.floor(strikes / 2);
  const step = monthly && underlying === "NIFTY" ? spec.step * 2 : spec.step;
  const rows: DevInstrumentRow[] = [];
  for (let index = -half; index <= half; index += 1) {
    const strike = String(spec.reference + index * step);
    for (const optionType of ["CE", "PE"] as const) {
      rows.push({
        key: formatInstrumentKey({
          segment: "OPT",
          token: "NSE_FO",
          symbol: underlying,
          expiry: isoDate(expiry),
          strike,
          optionType,
        }),
        exchange: "NFO",
        segment: "OPT",
        symbol: underlying,
        tradingSymbol: derivativeSymbol(underlying, expiry, monthly, `${strike}${optionType}`),
        name: `${underlying} ${displayDate(expiry)} ${strike} ${optionType}`,
        expiry,
        strike,
        optionType,
        lotSize: spec.lotSize,
        tickSize: "0.05",
        freezeQty: spec.freezeQty,
      });
    }
  }
  return rows;
}

function futureRow(underlying: Underlying, expiry: Date): DevInstrumentRow {
  const spec = UNDERLYINGS[underlying];
  return {
    key: formatInstrumentKey({ segment: "FUT", token: "NSE_FO", symbol: underlying, expiry: isoDate(expiry) }),
    exchange: "NFO",
    segment: "FUT",
    symbol: underlying,
    tradingSymbol: derivativeSymbol(underlying, expiry, true, "FUT"),
    name: `${underlying} ${displayDate(expiry)} FUT`,
    expiry,
    strike: null,
    optionType: null,
    lotSize: spec.lotSize,
    tickSize: "0.10",
    freezeQty: spec.freezeQty,
  };
}

/**
 * The development instruments for `today` (UTC midnight of the IST trading date), deduplicated by key (the weekly and
 * monthly NIFTY expiries coincide in the last week of a month).
 */
export function devInstrumentRows(today: Date, holidays: ReadonlySet<string> = nseHolidays()): DevInstrumentRow[] {
  const weekly = nextWeeklyExpiry(today, holidays);
  const monthly = nextMonthlyExpiry(today, holidays);
  const rows: DevInstrumentRow[] = [
    ...INDICES.map(({ token, symbol, name }) => ({
      key: formatInstrumentKey({ segment: "INDEX", token, symbol }),
      exchange: token === "BSE_INDEX" ? ("BSE" as const) : ("NSE" as const),
      segment: "INDEX" as const,
      symbol,
      tradingSymbol: symbol,
      name,
      expiry: null,
      strike: null,
      optionType: null,
      lotSize: 1,
      tickSize: "0.05",
      freezeQty: null,
    })),
    ...NIFTY_50.map(([symbol, name]) => ({
      key: formatInstrumentKey({ segment: "EQ", token: "NSE_EQ", symbol }),
      exchange: "NSE" as const,
      segment: "EQ" as const,
      symbol,
      tradingSymbol: symbol,
      name,
      expiry: null,
      strike: null,
      optionType: null,
      lotSize: 1,
      tickSize: "0.05",
      freezeQty: null,
    })),
    futureRow("NIFTY", monthly),
    futureRow("BANKNIFTY", monthly),
    ...optionRows("NIFTY", weekly, false, 25),
    ...optionRows("NIFTY", monthly, true, 15),
    ...optionRows("BANKNIFTY", monthly, true, 25),
  ];
  return [...new Map(rows.map((row) => [row.key, row])).values()];
}

/** Today's date in India (the trading date), as UTC midnight. */
export function istToday(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return utcDay(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
}

export interface DevInstrumentSummary {
  /** Rows created or brought up to date. */
  readonly upserted: number;
  /** Futures and options whose expiry is before today, newly marked inactive. */
  readonly deactivated: number;
}

/** Generous limits: 190 upserts on a slow remote database. */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

/** Upserts the development instruments and deactivates expired derivatives. Safe to run any number of times. */
export async function seedDevInstruments(
  prisma: PrismaClient,
  today: Date = istToday(),
  holidays?: ReadonlySet<string>,
): Promise<DevInstrumentSummary> {
  const rows = devInstrumentRows(today, holidays);
  for (const row of rows) {
    // Defensive: formatInstrumentKey already produced canonical keys.
    if (!parseInstrumentKey(row.key).ok) throw new RangeError(`Invalid development instrument key ${row.key}`);
  }
  return prisma.$transaction(async (tx) => {
    for (const { key, ...columns } of rows) {
      await tx.instrument.upsert({
        where: { key },
        create: { key, ...columns, brokerTokens: {}, isActive: true },
        update: { ...columns, isActive: true },
      });
    }
    const expired = await tx.instrument.updateMany({
      where: { segment: { in: ["FUT", "OPT"] }, expiry: { lt: today }, isActive: true },
      data: { isActive: false },
    });
    return { upserted: rows.length, deactivated: expired.count };
  }, TRANSACTION_OPTIONS);
}
