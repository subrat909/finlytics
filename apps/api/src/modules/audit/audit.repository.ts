/**
 * AuditLog rows (docs/03 "AuditLog"). Append-only: the database rejects UPDATE, DELETE and TRUNCATE (triggers), and
 * its CHECKs require a known `actorType` and an `actorId` unless the actor is `system`. Rows are written inside the
 * caller's transaction, through the tenancy-guarded client (AuditLog is exempt from the guard: its `userId` names the
 * subject, which may be another user for admin actions).
 */
import type { Prisma } from "@finlytics/database";
import { Injectable } from "@nestjs/common";

import type { TenantTransaction } from "../../infra/prisma/prisma.service";

import type { AuditAction, AuditActorType } from "./audit-actions";

/** One row, as AuditService prepared it. */
export interface AuditRow {
  /** The subject: whose data the action concerns. */
  readonly userId: string | null;
  readonly actorType: AuditActorType;
  readonly actorId: string | null;
  readonly action: AuditAction;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  /** JSON, at most 4 KiB serialised; omitted for no data. */
  readonly data?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditRepository {
  /** Appends a row in `tx` and returns its id (BigInt; serialised as a string by the api). */
  async insert(tx: TenantTransaction, row: AuditRow): Promise<bigint> {
    const created = await tx.auditLog.create({ data: { ...row }, select: { id: true } });
    return created.id;
  }
}
