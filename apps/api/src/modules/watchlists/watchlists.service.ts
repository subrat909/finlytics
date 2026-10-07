/**
 * Watchlists (docs/04 §2 "Watchlists"). Every query is the user's own (an id of someone else's list is a 404, never a
 * 403, so ids can't be probed). Plan limits: `Plan.maxWatchlists` lists per user and `Plan.maxWatchlistItems` items per
 * list, checked under a row lock (the user's row for lists, the list's row for items) so concurrent requests can't
 * overshoot. Over the limit is 403 FORBIDDEN; a duplicate name or instrument is 409 CONFLICT (unique indexes).
 */
import type {
  AddWatchlistItem,
  CreateWatchlist,
  ReorderWatchlistItems,
  UpdateWatchlist,
  Watchlist,
  WatchlistItem,
} from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { ForbiddenError, NotFoundError, ValidationError } from "../../common/problem-json/domain-errors";
import { PrismaService } from "../../infra/prisma/prisma.service";
import type { TenantTransaction } from "../../infra/prisma/prisma.service";

import { toWatchlist, toWatchlistItem } from "./watchlist.mapper";
import { WatchlistsRepository } from "./watchlists.repository";

const NOT_FOUND = "Watchlist not found.";

/** `ids` with `id` moved to `position` (clamped to the end). */
export function moveTo(ids: readonly string[], id: string, position: number): string[] {
  const rest = ids.filter((candidate) => candidate !== id);
  rest.splice(Math.min(position, rest.length), 0, id);
  return rest;
}

@Injectable()
export class WatchlistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly watchlists: WatchlistsRepository,
  ) {}

  async list(userId: string): Promise<Watchlist[]> {
    return (await this.watchlists.list(userId)).map(toWatchlist);
  }

  async create(userId: string, body: CreateWatchlist): Promise<Watchlist> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.watchlists.lockUser(tx, userId);
      const [{ maxWatchlists }, ids] = await Promise.all([
        this.watchlists.limits(tx, userId),
        this.watchlists.listIds(tx, userId),
      ]);
      if (ids.length >= maxWatchlists) {
        throw new ForbiddenError(`Your plan allows ${String(maxWatchlists)} watchlists.`);
      }
      return toWatchlist(await this.watchlists.create(tx, userId, body.name, ids.length));
    });
  }

  async update(userId: string, id: string, patch: UpdateWatchlist): Promise<Watchlist> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      if (patch.name !== undefined) await this.watchlists.rename(tx, userId, id, patch.name);
      if (patch.position !== undefined) {
        const ids = await this.watchlists.listIds(tx, userId);
        await this.watchlists.reorderLists(tx, userId, moveTo(ids, id, patch.position));
      }
      return this.reload(tx, userId, id);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.watchlists.delete(userId, id))) throw new NotFoundError(NOT_FOUND);
  }

  async addItem(userId: string, id: string, body: AddWatchlistItem): Promise<WatchlistItem> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      if (!(await this.watchlists.instrumentIsActive(tx, body.instrumentKey))) {
        throw new NotFoundError("Instrument not found.");
      }
      const [{ maxWatchlistItems }, itemIds, position] = await Promise.all([
        this.watchlists.limits(tx, userId),
        this.watchlists.itemIds(tx, userId, id),
        this.watchlists.nextItemPosition(tx, userId, id),
      ]);
      if (itemIds.length >= maxWatchlistItems) {
        throw new ForbiddenError(`Your plan allows ${String(maxWatchlistItems)} instruments per watchlist.`);
      }
      return toWatchlistItem(await this.watchlists.addItem(tx, userId, id, body.instrumentKey, position));
    });
  }

  async removeItem(userId: string, id: string, itemId: string): Promise<void> {
    if (!(await this.watchlists.removeItem(userId, id, itemId))) throw new NotFoundError("Watchlist item not found.");
  }

  async reorderItems(userId: string, id: string, body: ReorderWatchlistItems): Promise<Watchlist> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      const current = await this.watchlists.itemIds(tx, userId, id);
      const given = new Set(body.itemIds);
      if (current.length !== body.itemIds.length || current.some((itemId) => !given.has(itemId))) {
        throw new ValidationError("List every item of the watchlist exactly once.", [
          { path: "itemIds", message: "Must list every item of the watchlist once", code: "invalid_value" },
        ]);
      }
      await this.watchlists.reorderItems(tx, id, body.itemIds);
      return this.reload(tx, userId, id);
    });
  }

  private async lock(tx: TenantTransaction, userId: string, id: string): Promise<void> {
    if (!(await this.watchlists.lockWatchlist(tx, userId, id))) throw new NotFoundError(NOT_FOUND);
  }

  private async reload(tx: TenantTransaction, userId: string, id: string): Promise<Watchlist> {
    const row = await this.watchlists.find(tx, userId, id);
    if (row === null) throw new NotFoundError(NOT_FOUND);
    return toWatchlist(row);
  }
}
