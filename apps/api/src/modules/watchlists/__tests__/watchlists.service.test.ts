import { describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError, ValidationError } from "../../../common/problem-json/domain-errors";
import type { PrismaService, TenantTransaction } from "../../../infra/prisma/prisma.service";
import type { WatchlistItemRow, WatchlistRow, WatchlistsRepository } from "../watchlists.repository";
import { moveTo, WatchlistsService } from "../watchlists.service";

const INSTRUMENT = {
  key: "NSE_EQ|INFY",
  exchange: "NSE",
  segment: "EQ",
  symbol: "INFY",
  tradingSymbol: "INFY",
  name: "Infosys",
  expiry: null,
  strike: null,
  optionType: null,
  lotSize: 1,
  tickSize: { toFixed: () => "0.05" },
  isActive: true,
} as unknown as WatchlistItemRow["instrument"];

/** In-memory watchlists of several users, behind the repository's interface. */
function setup(limits = { maxWatchlists: 2, maxWatchlistItems: 2 }) {
  const lists = new Map<string, { userId: string; name: string; position: number; items: WatchlistItemRow[] }>();
  let next = 0;
  const view = (id: string): WatchlistRow | null => {
    const list = lists.get(id);
    return list === undefined
      ? null
      : {
          id,
          name: list.name,
          position: list.position,
          items: [...list.items].sort((a, b) => a.position - b.position),
        };
  };
  const owned = (userId: string, id: string) => lists.get(id)?.userId === userId;
  const repository = {
    list: (userId: string) =>
      Promise.resolve(
        [...lists.entries()]
          .filter(([, list]) => list.userId === userId)
          .sort(([, a], [, b]) => a.position - b.position)
          .map(([id]) => view(id)),
      ),
    find: (_db: unknown, userId: string, id: string) => Promise.resolve(owned(userId, id) ? view(id) : null),
    lockUser: vi.fn().mockResolvedValue(undefined),
    lockWatchlist: (_tx: unknown, userId: string, id: string) => Promise.resolve(owned(userId, id)),
    limits: () => Promise.resolve(limits),
    listIds: (_db: unknown, userId: string) =>
      Promise.resolve(
        [...lists.entries()]
          .filter(([, list]) => list.userId === userId)
          .sort(([, a], [, b]) => a.position - b.position)
          .map(([id]) => id),
      ),
    create: (_tx: unknown, userId: string, name: string, position: number) => {
      next += 1;
      const id = `w${String(next)}`;
      lists.set(id, { userId, name, position, items: [] });
      return Promise.resolve(view(id));
    },
    rename: (_tx: unknown, _userId: string, id: string, name: string) => {
      const list = lists.get(id);
      if (list !== undefined) list.name = name;
      return Promise.resolve();
    },
    reorderLists: vi.fn((_tx: unknown, _userId: string, ids: readonly string[]) => {
      ids.forEach((id, index) => {
        const list = lists.get(id);
        if (list !== undefined) list.position = index;
      });
      return Promise.resolve();
    }),
    delete: (userId: string, id: string) => Promise.resolve(owned(userId, id) && lists.delete(id)),
    instrumentIsActive: (_db: unknown, key: string) => Promise.resolve(key.startsWith("NSE_EQ|")),
    itemIds: (_db: unknown, _userId: string, id: string) =>
      Promise.resolve(view(id)?.items.map((item) => item.id) ?? []),
    nextItemPosition: (_db: unknown, _userId: string, id: string) =>
      Promise.resolve(Math.max(-1, ...(lists.get(id)?.items.map((item) => item.position) ?? [])) + 1),
    addItem: (_tx: unknown, _userId: string, id: string, instrumentKey: string, position: number) => {
      next += 1;
      const item = {
        id: `i${String(next)}`,
        instrumentKey,
        position,
        instrument: { ...INSTRUMENT, key: instrumentKey },
      };
      lists.get(id)?.items.push(item);
      return Promise.resolve(item);
    },
    removeItem: (userId: string, id: string, itemId: string) => {
      const list = lists.get(id);
      if (list?.userId !== userId) return Promise.resolve(false);
      const before = list.items.length;
      list.items = list.items.filter((item) => item.id !== itemId);
      return Promise.resolve(list.items.length < before);
    },
    reorderItems: (_tx: unknown, id: string, ids: readonly string[]) => {
      for (const item of lists.get(id)?.items ?? []) item.position = ids.indexOf(item.id);
      return Promise.resolve();
    },
  };
  const prisma = { db: { $transaction: (work: (tx: TenantTransaction) => unknown) => work({} as TenantTransaction) } };
  const service = new WatchlistsService(
    prisma as unknown as PrismaService,
    repository as unknown as WatchlistsRepository,
  );
  return { service, repository };
}

describe("WatchlistsService", () => {
  it("creates lists at the end, up to the plan's limit, under the user lock", async () => {
    const { service, repository } = setup();

    expect(await service.create("alice", { name: "One" })).toMatchObject({ name: "One", position: 0, items: [] });
    expect(await service.create("alice", { name: "Two" })).toMatchObject({ position: 1 });
    await expect(service.create("alice", { name: "Three" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await service.create("bob", { name: "Bob's" })).toMatchObject({ position: 0 });
    expect(repository.lockUser).toHaveBeenCalledTimes(4);
  });

  it("renames and moves a list, and lists them in order", async () => {
    const { service } = setup();
    const one = await service.create("alice", { name: "One" });
    await service.create("alice", { name: "Two" });

    expect(await service.update("alice", one.id, { name: "First", position: 5 })).toMatchObject({
      name: "First",
      position: 1,
    });
    expect((await service.list("alice")).map((list) => list.name)).toEqual(["Two", "First"]);
  });

  it("hides other users' lists behind 404s", async () => {
    const { service } = setup();
    const mine = await service.create("alice", { name: "Mine" });

    await expect(service.update("bob", mine.id, { name: "Stolen" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.remove("bob", mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.addItem("bob", mine.id, { instrumentKey: "NSE_EQ|INFY" as never })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.removeItem("bob", mine.id, "i1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.reorderItems("bob", mine.id, { itemIds: ["i1"] })).rejects.toBeInstanceOf(NotFoundError);
    await service.remove("alice", mine.id);
    expect(await service.list("alice")).toEqual([]);
  });

  it("adds active instruments up to the plan's item limit", async () => {
    const { service } = setup();
    const list = await service.create("alice", { name: "L" });

    const first = await service.addItem("alice", list.id, { instrumentKey: "NSE_EQ|INFY" as never });
    await service.addItem("alice", list.id, { instrumentKey: "NSE_EQ|TCS" as never });

    expect(first).toMatchObject({ instrumentKey: "NSE_EQ|INFY", position: 0, instrument: { tickSize: "0.05" } });
    await expect(service.addItem("alice", list.id, { instrumentKey: "NSE_EQ|ITC" as never })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.addItem("alice", list.id, { instrumentKey: "NSE_FO|GONE|2020-01-30" as never }),
    ).rejects.toMatchObject({ detail: "Instrument not found." });
  });

  it("reorders items only with every item listed once, and removes items", async () => {
    const { service } = setup();
    const list = await service.create("alice", { name: "L" });
    const a = await service.addItem("alice", list.id, { instrumentKey: "NSE_EQ|INFY" as never });
    const b = await service.addItem("alice", list.id, { instrumentKey: "NSE_EQ|TCS" as never });

    await expect(service.reorderItems("alice", list.id, { itemIds: [a.id] })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.reorderItems("alice", list.id, { itemIds: [a.id, "other"] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const reordered = await service.reorderItems("alice", list.id, { itemIds: [b.id, a.id] });
    expect(reordered.items.map((item) => item.id)).toEqual([b.id, a.id]);

    await service.removeItem("alice", list.id, a.id);
    await expect(service.removeItem("alice", list.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("moves an id to a position, clamped to the end", () => {
    expect(moveTo(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveTo(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });
});
