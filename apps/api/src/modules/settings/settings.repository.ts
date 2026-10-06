/**
 * `User.settings` (JSONB), through the tenancy-guarded client: User is scoped by its id, and a deleted user has no
 * settings. It holds the user's overrides only; the stored value is returned as it is (`unknown`) and SettingsService
 * reads it leniently over the defaults.
 */
import type { UserSettingsPatch } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import type { TenantTransaction } from "../../infra/prisma/prisma.service";

export interface StoredSettings {
  readonly settings: unknown;
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The stored settings of a user that isn't deleted, or null. */
  find(userId: string): Promise<StoredSettings | null> {
    return this.prisma.db.user.findUnique({ where: { id: userId, deletedAt: null }, select: { settings: true } });
  }

  /**
   * Locks the user's row until `tx` ends (`SELECT … FOR UPDATE`) and returns its stored settings, or null for a user
   * that doesn't exist or is deleted. A concurrent patch waits here, then reads the committed value, so two patches to
   * different fields both persist. Raw SQL (Prisma has no row locks), scoped by id by hand, parameters bound.
   */
  async lockForUpdate(tx: TenantTransaction, userId: string): Promise<StoredSettings | null> {
    const rows = await tx.$queryRaw<StoredSettings[]>`
      SELECT "settings" FROM "User" WHERE "id" = ${userId} AND "deletedAt" IS NULL FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Stores the user's overrides (a patch over the defaults, never the merged settings), inside the transaction that
   * locked the row.
   */
  async save(tx: TenantTransaction, userId: string, settings: UserSettingsPatch): Promise<void> {
    await tx.user.update({ where: { id: userId }, data: { settings }, select: { id: true } });
  }
}
