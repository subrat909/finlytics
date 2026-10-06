/**
 * The realtime contract as the UI reads it. Wire schemas come from `@finlytics/shared` (`schemas/realtime`,
 * `schemas/quotes`, stream C2/C1); this file turns them into `Tick`s: numbers, used only for display and direction,
 * never for money arithmetic.
 */
import { RT_REJECT_REASONS, RtQuoteRowSchema } from "@finlytics/shared";
import type { Quote, RtFeedState, RtRejectReason } from "@finlytics/shared";
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
}

/** The `q` envelope, read loosely so one malformed row is skipped instead of failing the batch. */
const QuoteBatchEnvelopeSchema = z.looseObject({ t: z.number(), d: z.array(z.unknown()) });

/** Reads a `q` message (rows validated with the shared `RtQuoteRowSchema`) into `[key, tick]` pairs. */
export function parseQuoteBatch(message: unknown, receivedAt: number): [string, Tick][] {
  const envelope = QuoteBatchEnvelopeSchema.safeParse(message);
  if (!envelope.success) return [];
  const rows: [string, Tick][] = [];
  for (const row of envelope.data.d) {
    const parsed = RtQuoteRowSchema.safeParse(row);
    if (!parsed.success) continue;
    const [key, ltp, chg, chgPct, vol, ts] = parsed.data;
    rows.push([key, { ltp: Number(ltp), chg: Number(chg), chgPct: Number(chgPct), vol, ts, receivedAt }]);
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
  };
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
