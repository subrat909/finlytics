/**
 * Watchlists (docs/04 §2 "Watchlists"): `/v1/watchlists` request and response contracts. How many lists and items a
 * user may have comes from their plan (`Plan.maxWatchlists`, `Plan.maxWatchlistItems`).
 */
import { z } from "zod";

import { InstrumentKeySchema } from "../instrument-key";

import { InstrumentSchema } from "./instruments";

/** Control, line-separator, bidi and BOM characters, and `<`/`>`: user text is one plain line, never HTML. */
const PLAIN_LINE = /^[^<>\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069\uFEFF]*$/u;

/** The most items one reorder may list (above every plan's `maxWatchlistItems`). */
export const MAX_WATCHLIST_REORDER_ITEMS = 500;

/** A watchlist's name: 1–40 characters of plain text, trimmed, unique per user. */
export const WatchlistNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(PLAIN_LINE, "Expected plain text on one line, without < or >");

/** A watchlist or item id in a path or body. */
export const WatchlistIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Expected an id");

/** `POST /v1/watchlists`. */
export const CreateWatchlistSchema = z.strictObject({ name: WatchlistNameSchema });
export type CreateWatchlist = z.infer<typeof CreateWatchlistSchema>;

/** `PATCH /v1/watchlists/:id`: a new name and/or a new place among the user's lists (0 = first). */
export const UpdateWatchlistSchema = z
  .strictObject({
    name: WatchlistNameSchema.optional(),
    position: z.int().min(0).max(1_000).optional(),
  })
  .refine((patch) => patch.name !== undefined || patch.position !== undefined, "Change at least one field");
export type UpdateWatchlist = z.infer<typeof UpdateWatchlistSchema>;

/** `POST /v1/watchlists/:id/items`. */
export const AddWatchlistItemSchema = z.strictObject({ instrumentKey: InstrumentKeySchema });
export type AddWatchlistItem = z.infer<typeof AddWatchlistItemSchema>;

/** `PUT /v1/watchlists/:id/items/order`: every item id of the list, once each, in the new order. */
export const ReorderWatchlistItemsSchema = z.strictObject({
  itemIds: z
    .array(WatchlistIdSchema)
    .min(1)
    .max(MAX_WATCHLIST_REORDER_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, "Each item id may appear once"),
});
export type ReorderWatchlistItems = z.infer<typeof ReorderWatchlistItemsSchema>;

export const WatchlistItemSchema = z.strictObject({
  id: z.string().min(1),
  instrumentKey: z.string().min(1),
  position: z.int().min(0),
  instrument: InstrumentSchema,
});
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;

export const WatchlistSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  position: z.int().min(0),
  /** In display order. */
  items: z.array(WatchlistItemSchema),
});
export type Watchlist = z.infer<typeof WatchlistSchema>;

/** `GET /v1/watchlists`: the user's lists in display order, each with its items. */
export const WatchlistListSchema = z.array(WatchlistSchema);
