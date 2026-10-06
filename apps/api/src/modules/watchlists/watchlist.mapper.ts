import type { Watchlist, WatchlistItem } from "@finlytics/shared";

import { modelToInstrument } from "../instruments/instrument.mapper";

import type { WatchlistItemRow, WatchlistRow } from "./watchlists.repository";

export function toWatchlistItem(row: WatchlistItemRow): WatchlistItem {
  return {
    id: row.id,
    instrumentKey: row.instrumentKey,
    position: row.position,
    instrument: modelToInstrument(row.instrument),
  };
}

export function toWatchlist(row: WatchlistRow): Watchlist {
  return { id: row.id, name: row.name, position: row.position, items: row.items.map(toWatchlistItem) };
}
