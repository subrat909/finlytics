/**
 * The development instrument seed (plan P6) against a migrated database: idempotent upserts that keep broker tokens,
 * and expired derivatives deactivated, never deleted.
 */
import { describe, expect, it } from "vitest";

import { devInstrumentRows, seedDevInstruments } from "../../prisma/seed/instruments";

import { createMigratedDatabase, withClient } from "./harness";

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

describe("seedDevInstruments", () => {
  it("is idempotent and keeps broker tokens written by a sync", async () => {
    const database = await createMigratedDatabase("dev_instruments");

    await withClient(database.url, async (prisma) => {
      const today = day("2026-10-06");
      const first = await seedDevInstruments(prisma, today, NO_HOLIDAYS);
      await prisma.instrument.update({
        where: { key: "NSE_EQ|RELIANCE" },
        data: { brokerTokens: { UPSTOX: "NSE_EQ|INE002A01018" } },
      });
      const second = await seedDevInstruments(prisma, today, NO_HOLIDAYS);

      expect(first).toEqual({ upserted: devInstrumentRows(today, NO_HOLIDAYS).length, deactivated: 0 });
      expect(second).toEqual(first);
      expect(await prisma.instrument.count()).toBe(first.upserted);
      expect(
        await prisma.instrument.findUnique({ where: { key: "NSE_EQ|RELIANCE" }, select: { brokerTokens: true } }),
      ).toEqual({ brokerTokens: { UPSTOX: "NSE_EQ|INE002A01018" } });
    });
  });

  it("deactivates derivatives that have expired, and keeps them", async () => {
    const database = await createMigratedDatabase("dev_instruments_expiry");

    await withClient(database.url, async (prisma) => {
      await seedDevInstruments(prisma, day("2026-10-06"), NO_HOLIDAYS);
      const later = await seedDevInstruments(prisma, day("2026-10-07"), NO_HOLIDAYS);

      const expired = await prisma.instrument.findMany({
        where: { expiry: day("2026-10-06") },
        select: { isActive: true },
      });
      expect(expired.length).toBeGreaterThan(0);
      expect(expired.every((row) => !row.isActive)).toBe(true);
      expect(later.deactivated).toBe(expired.length);
      expect(await prisma.instrument.count({ where: { segment: "EQ", isActive: true } })).toBe(50);
    });
  });
});
