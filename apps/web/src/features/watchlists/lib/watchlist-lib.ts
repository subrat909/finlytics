/**
 * Pure helpers for the watchlist terminal: reorder maths, the plan's item limit from a problem's detail, the open list
 * remembered per browser, chart links and keyboard targets.
 */
import type { Route } from "next";

import type { WatchlistItem } from "../schemas";

/** The ids of `items` with the one at `from` moved to `to` (both clamped); the same order when nothing moves. */
export function reorderedIds(items: readonly Pick<WatchlistItem, "id">[], from: number, to: number): string[] {
  const ids = items.map((item) => item.id);
  if (from < 0 || from >= ids.length) return ids;
  const target = Math.min(Math.max(to, 0), ids.length - 1);
  const [moved] = ids.splice(from, 1);
  if (moved !== undefined) ids.splice(target, 0, moved);
  return ids;
}

/**
 * The plan's per-list limit, read from the api's 403 detail ("Your plan allows 50 instruments per watchlist."). The
 * api exposes no limits endpoint for watchlists, so the footer shows the limit once the api has said it.
 */
export function itemLimitFrom(detail: string | undefined): number | undefined {
  const match = detail === undefined ? null : /allows (\d{1,5}) instruments? per watchlist/i.exec(detail);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

const ACTIVE_LIST_KEY = "finlytics:watchlists:active";

/** The list opened last time in this browser (undefined on the server, or when storage is blocked). */
export function readActiveList(): string | undefined {
  try {
    return globalThis.localStorage.getItem(ACTIVE_LIST_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeActiveList(id: string): void {
  try {
    globalThis.localStorage.setItem(ACTIVE_LIST_KEY, id);
  } catch {
    // Blocked storage: the first list opens next time.
  }
}

export function chartHref(instrumentKey: string): Route {
  return `/charts?key=${encodeURIComponent(instrumentKey)}` as Route;
}

/** Typing targets: page shortcuts never fire while the user writes. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** DOM ids for a row's parts (item ids are `[A-Za-z0-9_-]`). */
export function rowButtonId(itemId: string): string {
  return `watchlist-row-${itemId}`;
}

export function rowDepthId(itemId: string): string {
  return `watchlist-depth-${itemId}`;
}
