/**
 * Instruments and watchlists: the wire contract is `@finlytics/shared` (`schemas/instruments`, `schemas/watchlists`,
 * stream C1). This file adds the UI's form messages and display helpers.
 */
import type { Instrument, Watchlist, WatchlistItem } from "@finlytics/shared";
import type { z } from "zod";

export type { Instrument, Watchlist, WatchlistItem };

/** For `zodResolver(CreateWatchlistSchema, { error: watchlistNameErrors })`: the shared pattern's message still wins. */
export const watchlistNameErrors: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === "too_small") return "Give the watchlist a name";
  if (issue.code === "too_big") return "Use at most 40 characters";
  return undefined;
};

/** What a row shows: the instrument's symbol (the underlying for derivatives). */
export function symbolOf(item: Pick<WatchlistItem, "instrumentKey" | "instrument">): string {
  return item.instrument.symbol;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2025-10-30` → `30 Oct 25`. */
function shortExpiry(expiry: string): string {
  const [year = "", month = "", day = ""] = expiry.split("-");
  return `${String(Number(day))} ${MONTHS[Number(month) - 1] ?? month} ${year.slice(2)}`;
}

/** A one-line description: `NSE · Reliance Industries`, `NFO · 30 Oct 25 24000 CE`, `NFO · 30 Oct 25 FUT`. */
export function describeInstrument(instrument: Instrument): string {
  if (instrument.segment === "OPT" || instrument.segment === "FUT") {
    const detail = [
      instrument.expiry === null ? undefined : shortExpiry(instrument.expiry),
      instrument.segment === "OPT" ? instrument.strike : "FUT",
      instrument.optionType,
    ]
      .filter((part) => part !== undefined && part !== null && part !== "")
      .join(" ");
    return `${instrument.exchange} · ${detail}`;
  }
  return `${instrument.exchange} · ${instrument.name}`;
}
