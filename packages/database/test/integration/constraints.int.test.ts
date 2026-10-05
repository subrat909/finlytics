import { randomInt } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import type { Prisma, PrismaClient } from "../../src/index";
import { createTrader, marketOrder } from "./fixtures";
import { connect, databaseError, sharedDatabaseUrl, uniqueSuffix } from "./harness";

/** SQLSTATE unique_violation. */
const UNIQUE_VIOLATION = "23505";

const DAY_MS = 86_400_000;

/** A UTC midnight in 2100–2199: never a real (seeded) holiday, and unlikely to repeat across tests. */
function unusedHolidayDate(): Date {
  return new Date(Date.UTC(2100, 0, 1) + randomInt(0, 36_500) * DAY_MS);
}

describe("constraints", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = connect(sharedDatabaseUrl());
    return async () => {
      await prisma.$disconnect();
    };
  });

  it("scopes idempotency keys per user", async () => {
    // Each user orders on its own broker account: the composite (brokerAccountId, userId) foreign key rejects an order
    // on another user's account.
    const alice = await createTrader(prisma, "alice");
    const bob = await createTrader(prisma, "bob");
    const key = `order-${uniqueSuffix()}`;

    await prisma.order.create({ data: marketOrder(alice, key) });
    await prisma.order.create({ data: marketOrder(bob, key) });
    const replay: unknown = await prisma.order
      .create({ data: marketOrder(alice, key) })
      .catch((error: unknown) => error);

    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(2);
    expect(databaseError(replay)).toEqual({
      prismaCode: "P2002",
      sqlState: UNIQUE_VIOLATION,
      message: 'duplicate key value violates unique constraint "Order_userId_idempotencyKey_key"',
    });
  });

  it("allows NSE and BSE holidays on the same date", async () => {
    const date = unusedHolidayDate();

    await prisma.marketHoliday.create({ data: { exchange: "NSE", date, name: "Test holiday" } });
    await prisma.marketHoliday.create({ data: { exchange: "BSE", date, name: "Test holiday" } });
    const duplicate: unknown = await prisma.marketHoliday
      .create({ data: { exchange: "NSE", date, name: "Duplicate" } })
      .catch((error: unknown) => error);

    expect(databaseError(duplicate)).toEqual({
      prismaCode: "P2002",
      sqlState: UNIQUE_VIOLATION,
      message: 'duplicate key value violates unique constraint "MarketHoliday_pkey"',
    });
    expect(
      await prisma.marketHoliday.findMany({
        where: { date },
        select: { exchange: true, name: true },
        orderBy: { exchange: "asc" },
      }),
    ).toEqual([
      { exchange: "NSE", name: "Test holiday" },
      { exchange: "BSE", name: "Test holiday" },
    ]);
  });

  it("finds instruments by trigram similarity on name", async () => {
    // Every key starts with a unique prefix, so the search sees only this test's rows in the shared database.
    const keyPrefix = `NSE_EQ|TRGM${uniqueSuffix().toUpperCase()}`;
    const names = [
      "Reliance Infrastructure",
      "Reliance Industries",
      "Reliance Power",
      "Infosys",
      "Tata Consultancy Services",
    ];
    await prisma.instrument.createMany({
      data: names.map((name, index): Prisma.InstrumentCreateManyInput => ({
        key: `${keyPrefix}${String(index)}`,
        exchange: "NSE",
        segment: "EQ",
        symbol: `${keyPrefix.slice("NSE_EQ|".length)}${String(index)}`,
        name,
        brokerTokens: {},
      })),
    });
    const term = "reliance infra";

    // `%` is pg_trgm's similarity operator (default threshold 0.3), the one the instrument_name_trgm GIN index serves.
    const matches = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM "Instrument"
      WHERE starts_with(key, ${keyPrefix}) AND name % ${term}
      ORDER BY similarity(name, ${term}) DESC, key`;

    expect(matches.map((match) => match.name)).toEqual([
      "Reliance Infrastructure",
      "Reliance Industries",
      "Reliance Power",
    ]);
  });
});
