/**
 * The audit log (plan D14, D19; security.md "every trading mutation … written to an append-only AuditLog"). Explicit:
 * a mutation calls `record(tx, entry)` inside its own transaction, so the change and its audit row commit or roll back
 * together. There is no Prisma extension that audits implicitly.
 *
 * - `action`: one of AUDIT_ACTIONS; anything else is a bug (TypeError).
 * - `actor`: who acted. `actorId` is required unless the actor is `system`, here and in the database (CHECK).
 * - `subjectUserId`: whose data the action concerns (`AuditLog.userId`).
 * - `request`: the request id, client IP and User-Agent (`@RequestMeta()`). The request id is the one the api generated
 *   (a UUID, bootstrap/request-id.ts), never a client's `x-request-id`; anything else is stored as null with a warning,
 *   so a caller can't choose, reuse or forge the id that ties audit rows to logs.
 * - `data`: at most 4 KiB of JSON. Larger data is replaced by `{ truncated: true, bytes }` and a warning: an audit row
 *   must never fail a mutation that already happened (2.1 audits after the broker call). Never put secrets or tokens
 *   in it; it is kept for 5 years (docs/06).
 */
import type { Prisma } from "@finlytics/database";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { bigintReplacer } from "../../bootstrap/reply-serializer";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import type { TenantTransaction } from "../../infra/prisma/prisma.service";

import { isAuditAction } from "./audit-actions";
import type { AuditAction } from "./audit-actions";
import { AuditRepository } from "./audit.repository";

/** The largest `data` stored, in bytes of serialised JSON. */
export const AUDIT_DATA_MAX_BYTES = 4_096;

/** A request id the api generated: `randomUUID()`, a lowercase version-4 UUID (bootstrap/request-id.ts). */
const SERVER_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether `id` has the shape of a server-generated request id. */
export function isServerRequestId(id: unknown): id is string {
  return typeof id === "string" && SERVER_REQUEST_ID.test(id);
}

/** Who acted: a user, an admin or an agent run (with its id), or the system itself. */
export type AuditActor =
  | { readonly type: "user" | "admin" | "agent"; readonly id: string }
  | { readonly type: "system"; readonly id?: undefined };

export interface AuditEntry {
  readonly action: AuditAction;
  readonly actor: AuditActor;
  /** Whose data the action concerns (`AuditLog.userId`). */
  readonly subjectUserId?: string;
  /** What the action changed, e.g. `{ type: "User", id }`. */
  readonly entity?: { readonly type: string; readonly id: string };
  readonly request?: RequestMetadata;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The actor's id. @throws {TypeError} when a user, admin or agent comes without one. */
export function actorIdOf(actor: AuditActor): string | null {
  if (actor.type === "system") return null;
  if (typeof actor.id !== "string" || actor.id === "") {
    throw new TypeError(`An audit actor of type ${actor.type} needs an id`);
  }
  return actor.id;
}

/** `data` as stored: JSON (bigints as strings), or a summary when it is over {@link AUDIT_DATA_MAX_BYTES}. */
export function boundedAuditData(data: Readonly<Record<string, unknown>> | undefined): {
  value: Prisma.InputJsonValue | undefined;
  bytes: number;
  truncated: boolean;
} {
  if (data === undefined) return { value: undefined, bytes: 0, truncated: false };
  const json = JSON.stringify(data, bigintReplacer);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > AUDIT_DATA_MAX_BYTES) return { value: { truncated: true, bytes }, bytes, truncated: true };
  return { value: JSON.parse(json) as Prisma.InputJsonValue, bytes, truncated: false };
}

@Injectable()
export class AuditService {
  constructor(
    private readonly audit: AuditRepository,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AuditService.name);
  }

  /** Appends one audit row inside `tx` and returns its id. */
  async record(tx: TenantTransaction, entry: AuditEntry): Promise<bigint> {
    if (!isAuditAction(entry.action)) throw new TypeError("Unknown audit action: add it to AUDIT_ACTIONS");
    const actorId = actorIdOf(entry.actor);
    const data = boundedAuditData(entry.data);
    if (data.truncated) {
      this.logger.warn({ action: entry.action, bytes: data.bytes }, "audit data over 4 KiB; stored a summary instead");
    }
    const requestId = entry.request?.requestId;
    const serverRequestId = isServerRequestId(requestId) ? requestId : null;
    if (requestId !== undefined && serverRequestId === null) {
      this.logger.warn({ action: entry.action }, "audit request id is not server-generated; stored null instead");
    }
    return this.audit.insert(tx, {
      userId: entry.subjectUserId ?? null,
      actorType: entry.actor.type,
      actorId,
      action: entry.action,
      entityType: entry.entity?.type ?? null,
      entityId: entry.entity?.id ?? null,
      ip: entry.request?.ip ?? null,
      userAgent: entry.request?.userAgent ?? null,
      requestId: serverRequestId,
      ...(data.value === undefined ? {} : { data: data.value }),
    });
  }
}
