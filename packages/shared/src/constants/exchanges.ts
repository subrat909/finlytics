/**
 * Segment tokens and holiday calendars (plan §5, D12, D13).
 *
 * A segment token is the first part of every instrument key (`NSE_FO|NIFTY|2025-10-30|24000|CE`). It says where the
 * instrument trades and which kinds it can be, so the Prisma `Exchange` and `Segment` of any key follow from its token
 * (and, for F&O tokens, from the number of parts: 3 for a future, 5 for an option).
 */
import { z } from "zod";

import { deepFreeze } from "../internal/deep-freeze";
import { lookup } from "../internal/lookup";
import type { Exchange, Segment } from "../schemas/enums";

/**
 * Every segment token. Part of the instrument-key grammar, which is permanent (keys are primary keys): a token can be
 * added, never renamed or removed.
 */
export const SEGMENT_TOKENS = Object.freeze([
  "NSE_EQ",
  "NSE_INDEX",
  "NSE_FO",
  "NSE_CD",
  "BSE_EQ",
  "BSE_INDEX",
  "BSE_FO",
  "MCX_FO",
] as const);
export const SegmentTokenSchema = z.enum(SEGMENT_TOKENS);
export type SegmentToken = z.infer<typeof SegmentTokenSchema>;

/** What a segment token stands for: the Prisma exchange, and the instrument kinds (Prisma segments) it can carry. */
export interface SegmentTokenInfo {
  readonly exchange: Exchange;
  readonly kinds: readonly Segment[];
}

/**
 * Token → Prisma exchange and instrument kinds. Exchange derivatives segments are separate Prisma exchanges: NSE F&O is
 * NFO, BSE F&O is BFO and NSE currency derivatives is CDS. MCX carries commodity futures and options. Frozen at every
 * depth.
 */
export const SEGMENT_TOKEN_INFO = deepFreeze({
  NSE_EQ: { exchange: "NSE", kinds: ["EQ"] },
  NSE_INDEX: { exchange: "NSE", kinds: ["INDEX"] },
  NSE_FO: { exchange: "NFO", kinds: ["FUT", "OPT"] },
  NSE_CD: { exchange: "CDS", kinds: ["FUT", "OPT"] },
  BSE_EQ: { exchange: "BSE", kinds: ["EQ"] },
  BSE_INDEX: { exchange: "BSE", kinds: ["INDEX"] },
  BSE_FO: { exchange: "BFO", kinds: ["FUT", "OPT"] },
  MCX_FO: { exchange: "MCX", kinds: ["FUT", "OPT"] },
} as const satisfies Record<SegmentToken, SegmentTokenInfo>);

/**
 * The segment token for a Prisma exchange and segment, e.g. `("NFO", "OPT")` → `"NSE_FO"`. `undefined` when no token
 * covers the pair, e.g. `("NSE", "FUT")`: NSE futures trade on NFO.
 */
export function segmentTokenFor(exchange: Exchange, segment: Segment): SegmentToken | undefined {
  return SEGMENT_TOKENS.find((token) => {
    const info: SegmentTokenInfo = SEGMENT_TOKEN_INFO[token];
    return info.exchange === exchange && info.kinds.includes(segment);
  });
}

/** The exchanges whose holiday lists are stored (`MarketHoliday.exchange`); every other exchange shares one of them. */
export type HolidayCalendar = Extract<Exchange, "NSE" | "BSE" | "MCX" | "CDS">;

/**
 * Exchange → holiday calendar (plan D12):
 * - NFO trades on NSE's calendar, and BFO on BSE's.
 * - CDS keeps its own: currency derivatives also close on bank holidays when equities trade (Annual Bank Closing on
 *   1 April, for instance).
 * - MCX keeps its own; its rows record which session is closed.
 */
const HOLIDAY_CALENDAR_BY_EXCHANGE = Object.freeze({
  NSE: "NSE",
  BSE: "BSE",
  MCX: "MCX",
  NFO: "NSE",
  BFO: "BSE",
  CDS: "CDS",
} as const satisfies Record<Exchange, HolidayCalendar>);

/**
 * The holiday calendar an exchange trades on: `"NFO"` → `"NSE"`, `"BFO"` → `"BSE"`, `"CDS"` → `"CDS"`.
 *
 * @throws {RangeError} for a value that is not an {@link Exchange} (untyped callers).
 */
export function holidayCalendarFor(exchange: Exchange): HolidayCalendar {
  return lookup(HOLIDAY_CALENDAR_BY_EXCHANGE, exchange, "exchange");
}
