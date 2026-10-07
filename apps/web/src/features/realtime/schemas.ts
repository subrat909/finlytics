/**
 * The realtime contract as the UI reads it. Wire schemas come from `@finlytics/shared` (`schemas/realtime`,
 * `schemas/quotes`); this file turns them into `Tick`s and `Depth`s: numbers, used only for display and direction,
 * never for money arithmetic.
 */
import {
  BrokerCodeSchema,
  RT_REJECT_REASONS,
  RtDepthSchema,
  RtFeedStateSchema,
  RtQuoteRowSchema,
} from "@finlytics/shared";
import type { BrokerCode, Quote, RtDepth, RtFeedState, RtRejectReason } from "@finlytics/shared";
import { z } from "zod";

export type FeedStatus = RtFeedState;

/** One instrument's latest values, as the UI keeps them. */
export interface Tick {
  ltp: number;
  /** Change from the previous close. */
  chg: number;
  chgPct: number;
  /** The day's volume; null when unknown. */
  vol: number | null;
  /** The exchange timestamp, epoch ms. */
  ts: number;
  /** When this client received it (epoch ms): staleness is measured from here, so clock skew can't fake it. */
  receivedAt: number;
  /**
   * The day's open, high and low, the previous close, open interest and the average traded price: null until the
   * feed has them (an index has no `oi` or `atp`). Optional so ticks built by older producers still type-check;
   * everything this module parses sets all six.
   */
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  oi?: number | null;
  atp?: number | null;
}

/** The six day-statistics fields of a tick. */
export const TICK_DAY_FIELDS = ["open", "high", "low", "close", "oi", "atp"] as const;

/** Which broker's feed drives every price, and whether it is live (`false`: the paper simulator). */
export interface FeedSource {
  source: BrokerCode;
  live: boolean;
}

/** One book level, best first. */
export interface DepthLevel {
  price: number;
  qty: number;
  /** 0 when the broker doesn't send it. */
  orders: number;
}

/** One instrument's market depth (5 levels from Upstox and Dhan `full`). */
export interface Depth {
  /** The exchange time, epoch ms. */
  t: number;
  bids: readonly DepthLevel[];
  asks: readonly DepthLevel[];
  /** Total buy / sell quantities when the broker sends them. */
  tbq: number | null;
  tsq: number | null;
  receivedAt: number;
}

/** The `q` envelope, read loosely so one malformed row is skipped instead of failing the batch. */
const QuoteBatchEnvelopeSchema = z.looseObject({ t: z.number(), d: z.array(z.unknown()) });

/** Rows are 12-tuples; a server from before phase 1b sent the first six, padded here with nulls. */
const QUOTE_ROW_LENGTH = 12;
const LEGACY_ROW_LENGTH = 6;

function padRow(row: unknown): unknown {
  if (!Array.isArray(row) || row.length < LEGACY_ROW_LENGTH || row.length >= QUOTE_ROW_LENGTH) return row;
  const values: unknown[] = [...(row as unknown[])];
  while (values.length < QUOTE_ROW_LENGTH) values.push(null);
  return values;
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** Reads a `q` message (rows validated with the shared `RtQuoteRowSchema`) into `[key, tick]` pairs. */
export function parseQuoteBatch(message: unknown, receivedAt: number): [string, Tick][] {
  const envelope = QuoteBatchEnvelopeSchema.safeParse(message);
  if (!envelope.success) return [];
  const rows: [string, Tick][] = [];
  for (const row of envelope.data.d) {
    const parsed = RtQuoteRowSchema.safeParse(padRow(row));
    if (!parsed.success) continue;
    const [key, ltp, chg, chgPct, vol, ts, open, high, low, close, oi, atp] = parsed.data;
    rows.push([
      key,
      {
        ltp: Number(ltp),
        chg: Number(chg),
        chgPct: Number(chgPct),
        vol,
        ts,
        receivedAt,
        open: numberOrNull(open),
        high: numberOrNull(high),
        low: numberOrNull(low),
        close: numberOrNull(close),
        oi,
        atp: numberOrNull(atp),
      },
    ]);
  }
  return rows;
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

/** A REST quote (`GET /v1/quotes`) as a tick; its age counts from the quote's own time, so an old one shows stale. */
export function quoteToTick(quote: Quote): Tick {
  return {
    ltp: Number(quote.ltp),
    chg: optionalNumber(quote.chg) ?? 0,
    chgPct: optionalNumber(quote.chgPct) ?? 0,
    vol: optionalNumber(quote.vol) ?? null,
    ts: quote.ts,
    receivedAt: quote.ts,
    open: optionalNumber(quote.open) ?? null,
    high: optionalNumber(quote.high) ?? null,
    low: optionalNumber(quote.low) ?? null,
    close: optionalNumber(quote.close) ?? null,
    oi: optionalNumber(quote.oi) ?? null,
    atp: optionalNumber(quote.atp) ?? null,
  };
}

/**
 * A new tick keeps the day statistics the previous one knew when it doesn't carry them (an instrument streamed in
 * `ltpc` mode after a REST seed with OHLC): a value never flips back to "—". Returns `next` itself when it is complete.
 */
export function mergeTick(next: Tick, previous: Tick | undefined): Tick {
  if (previous === undefined) return next;
  if (TICK_DAY_FIELDS.every((field) => next[field] !== null && next[field] !== undefined)) return next;
  return {
    ...next,
    open: next.open ?? previous.open ?? null,
    high: next.high ?? previous.high ?? null,
    low: next.low ?? previous.low ?? null,
    close: next.close ?? previous.close ?? null,
    oi: next.oi ?? previous.oi ?? null,
    atp: next.atp ?? previous.atp ?? null,
  };
}

function levelsOf(levels: RtDepth["bids"]): DepthLevel[] {
  return levels.map(([price, qty, orders]) => ({ price: Number(price), qty, orders }));
}

/** A wire depth (`depth` event or `GET /v1/quotes/depth`) in display units. */
export function depthFromWire(depth: RtDepth, receivedAt: number): Depth {
  return {
    t: depth.t,
    bids: levelsOf(depth.bids),
    asks: levelsOf(depth.asks),
    tbq: depth.tbq,
    tsq: depth.tsq,
    receivedAt,
  };
}

/** Reads a `depth` message; undefined when it isn't one. */
export function parseDepth(message: unknown, receivedAt: number): [string, Depth] | undefined {
  const parsed = RtDepthSchema.safeParse(message);
  return parsed.success ? [parsed.data.k, depthFromWire(parsed.data, receivedAt)] : undefined;
}

/** `status`, read loosely: a server from before phase 1b sent only `feed`. */
const StatusSchema = z.looseObject({
  feed: RtFeedStateSchema,
  source: BrokerCodeSchema.optional(),
  live: z.boolean().optional(),
});

export interface ParsedStatus {
  feed: FeedStatus;
  /** Undefined when the server didn't say. */
  source: FeedSource | undefined;
}

/** Reads a `status` message; undefined when it isn't one. */
export function parseStatus(message: unknown): ParsedStatus | undefined {
  const parsed = StatusSchema.safeParse(message);
  if (!parsed.success) return undefined;
  const { feed, source, live } = parsed.data;
  return { feed, source: source === undefined || live === undefined ? undefined : { source, live } };
}

/** Why a key has no live data, in words (the server's `rejected[].reason`). */
const REJECT_TEXT: Readonly<Record<RtRejectReason, string>> = {
  invalid_key: "not a valid instrument",
  unknown_instrument: "unknown instrument",
  limit: "your plan's live-price limit is reached",
  rate_limited: "too many changes at once",
  unavailable: "the live service is busy",
};

export function rejectReasonText(reason: string): string {
  return (RT_REJECT_REASONS as readonly string[]).includes(reason)
    ? REJECT_TEXT[reason as RtRejectReason]
    : "not available";
}

/** Why market depth isn't streaming, in words (a `dsub` refusal). */
export function depthRejectText(reason: string): string {
  if (reason === "limit") return "too many market depth panels are open; close one to stream this one";
  return rejectReasonText(reason);
}
