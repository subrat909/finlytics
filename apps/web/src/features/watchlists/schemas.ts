/**
 * Instruments and watchlists: the wire contract is `@finlytics/shared` (`schemas/instruments`, `schemas/watchlists`).
 * This file adds the UI's form messages; instrument display helpers live in `features/instruments` and are re-exported
 * here for existing imports.
 */
import type { Instrument, Watchlist, WatchlistItem } from "@finlytics/shared";
import type { z } from "zod";

export { describeInstrument } from "@/features/instruments/lib/describe";
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
