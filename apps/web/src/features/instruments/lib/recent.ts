/**
 * Recently picked instruments, per browser (localStorage): the search shows them when the field is empty. Public market
 * metadata only, validated on the way back in; storage that is full, blocked or corrupt just means no recents.
 */
import { InstrumentSchema } from "@finlytics/shared";
import type { Instrument } from "@finlytics/shared";
import { z } from "zod";

export const RECENT_STORAGE_KEY = "finlytics:recent-instruments";
export const MAX_RECENT = 8;

const RecentSchema = z.array(InstrumentSchema).max(50);

export function readRecent(): Instrument[] {
  try {
    const raw = globalThis.localStorage.getItem(RECENT_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = RecentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Moves `instrument` to the front (once) and returns the new list. */
export function rememberRecent(instrument: Instrument): Instrument[] {
  const next = [instrument, ...readRecent().filter((item) => item.key !== instrument.key)].slice(0, MAX_RECENT);
  try {
    globalThis.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Full or blocked storage: the list still works for this page.
  }
  return next;
}

export function clearRecent(): void {
  try {
    globalThis.localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
