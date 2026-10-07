/**
 * Watchlist and WatchlistItem rows through the tenancy-guarded client: lists are scoped by `userId`, items through
 * their list (`where: { watchlist: { userId } }`, created by connecting the list with `{ id, userId }`). Positions are
 * rewritten in one statement (`UPDATE … FROM unnest(…)`), after the list was locked and its ownership checked.
 */
import type { Prisma } from "@finlytics/database";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import type { TenantPrismaClient, TenantTransaction } from "../../infra/prisma/prisma.service";
import { INSTRUMENT_SELECT } from "../instruments/instrument.mapper";

const ITEM_SELECT = {
  id: true,
  instrumentKey: true,
  position: true,
  instrument: { select: INSTRUMENT_SELECT },
} as const satisfies Prisma.WatchlistItemSelect;

const WATCHLIST_SELECT = {
  id: true,
  name: true,
  position: true,
  items: { orderBy: [{ position: "asc" }, { id: "asc" }], select: ITEM_SELECT },
} as const satisfies Prisma.WatchlistSelect;

export type WatchlistRow = Prisma.WatchlistGetPayload<{ select: typeof WATCHLIST_SELECT }>;
export type WatchlistItemRow = Prisma.WatchlistItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** The free plan's limits (schema.prisma `Plan` defaults), for a user without a plan. */
export const DEFAULT_WATCHLIST_LIMITS = Object.freeze({ maxWatchlists: 3, maxWatchlistItems: 50 });

type Db = TenantPrismaClient | TenantTransaction;

@Injectable()
export class WatchlistsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<WatchlistRow[]> {
    return this.prisma.db.watchlist.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: WATCHLIST_SELECT,
    });
  }

  find(db: Db, userId: string, id: string): Promise<WatchlistRow | null> {
    return db.watchlist.findFirst({ where: { id, userId }, select: WATCHLIST_SELECT });
  }

  /** Locks the user's row until `tx` ends: list creation checks the plan limit one request at a time. */
  async lockUser(tx: TenantTransaction, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }

  /** Locks one of the user's lists until `tx` ends; false when it isn't theirs (or doesn't exist). */
  async lockWatchlist(tx: TenantTransaction, userId: string, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Watchlist" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    return rows.length === 1;
  }

  async limits(db: Db, userId: string): Promise<{ maxWatchlists: number; maxWatchlistItems: number }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { plan: { select: { maxWatchlists: true, maxWatchlistItems: true } } },
    });
    return user?.plan ?? DEFAULT_WATCHLIST_LIMITS;
  }

  /** The user's list ids in display order. */
  async listIds(db: Db, userId: string): Promise<string[]> {
    const rows = await db.watchlist.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async create(tx: TenantTransaction, userId: string, name: string, position: number): Promise<WatchlistRow> {
    return tx.watchlist.create({ data: { userId, name, position }, select: WATCHLIST_SELECT });
  }

  async rename(tx: TenantTransaction, userId: string, id: string, name: string): Promise<void> {
    await tx.watchlist.updateMany({ where: { id, userId }, data: { name } });
  }

  /** Positions 0…n−1 in the order of `ids` (all the user's lists). */
  async reorderLists(tx: TenantTransaction, userId: string, ids: readonly string[]): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Watchlist" AS w SET "position" = v.position, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM unnest(${[...ids]}::text[], ${ids.map((_, index) => index)}::int[]) AS v(id, position)
      WHERE w."id" = v.id AND w."userId" = ${userId}`;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.watchlist.deleteMany({ where: { id, userId } });
    return result.count === 1;
  }

  /** Whether `key` is an active instrument. */
  async instrumentIsActive(db: Db, key: string): Promise<boolean> {
    return (await db.instrument.count({ where: { key, isActive: true } })) === 1;
  }

  /** The list's item ids in display order. */
  async itemIds(db: Db, userId: string, watchlistId: string): Promise<string[]> {
    const rows = await db.watchlistItem.findMany({
      where: { watchlistId, watchlist: { userId } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async nextItemPosition(db: Db, userId: string, watchlistId: string): Promise<number> {
    const result = await db.watchlistItem.aggregate({
      where: { watchlistId, watchlist: { userId } },
      _max: { position: true },
    });
    return (result._max.position ?? -1) + 1;
  }

  async addItem(
    tx: TenantTransaction,
    userId: string,
    watchlistId: string,
    instrumentKey: string,
    position: number,
  ): Promise<WatchlistItemRow> {
    return tx.watchlistItem.create({
      data: {
        position,
        watchlist: { connect: { id: watchlistId, userId } },
        instrument: { connect: { key: instrumentKey } },
      },
      select: ITEM_SELECT,
    });
  }

  async removeItem(userId: string, watchlistId: string, itemId: string): Promise<boolean> {
    const result = await this.prisma.db.watchlistItem.deleteMany({
      where: { id: itemId, watchlistId, watchlist: { userId } },
    });
    return result.count === 1;
  }

  /** Positions 0…n−1 in the order of `ids` (all the items of a list the caller has locked). */
  async reorderItems(tx: TenantTransaction, watchlistId: string, ids: readonly string[]): Promise<void> {
    await tx.$executeRaw`
      UPDATE "WatchlistItem" AS w SET "position" = v.position
      FROM unnest(${[...ids]}::text[], ${ids.map((_, index) => index)}::int[]) AS v(id, position)
      WHERE w."id" = v.id AND w."watchlistId" = ${watchlistId}`;
  }
}
