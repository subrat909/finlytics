import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { TenantTransaction } from "../../../infra/prisma/prisma.service";
import { AUDIT_ACTIONS, isAuditAction } from "../audit-actions";
import type { AuditAction } from "../audit-actions";
import type { AuditRepository } from "../audit.repository";
import { actorIdOf, AUDIT_DATA_MAX_BYTES, AuditService, boundedAuditData, isServerRequestId } from "../audit.service";
import type { AuditActor } from "../audit.service";

const TX = { tag: "tx" } as unknown as TenantTransaction;
const REQUEST_ID = "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f";

function setup() {
  const repository = { insert: vi.fn<AuditRepository["insert"]>().mockResolvedValue(42n) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const service = new AuditService(repository, logger as unknown as PinoLogger);
  return { service, repository, logger };
}

describe("AuditService", () => {
  it("writes one row in the caller's transaction, with the actor, subject, entity and request", async () => {
    const { service, repository } = setup();

    const id = await service.record(TX, {
      action: "settings.update",
      actor: { type: "user", id: "cm0user1" },
      subjectUserId: "cm0user1",
      entity: { type: "User", id: "cm0user1" },
      request: { requestId: REQUEST_ID, ip: "203.0.113.7", userAgent: "Mozilla/5.0" },
      data: { changed: ["appearance.theme"], count: 10n },
    });

    expect(id).toBe(42n);
    expect(repository.insert).toHaveBeenCalledExactlyOnceWith(TX, {
      userId: "cm0user1",
      actorType: "user",
      actorId: "cm0user1",
      action: "settings.update",
      entityType: "User",
      entityId: "cm0user1",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      requestId: REQUEST_ID,
      data: { changed: ["appearance.theme"], count: "10" },
    });
  });

  it("writes nulls for what an entry doesn't name, and no data at all without data", async () => {
    const { service, repository } = setup();

    await service.record(TX, { action: "settings.update", actor: { type: "system" } });

    expect(repository.insert).toHaveBeenCalledWith(TX, {
      userId: null,
      actorType: "system",
      actorId: null,
      action: "settings.update",
      entityType: null,
      entityId: null,
      ip: null,
      userAgent: null,
      requestId: null,
    });
  });

  it("stores only a server-generated request id, never one a client chose", async () => {
    const { service, repository, logger } = setup();

    for (const requestId of ["req-12345678", "forged-audit-id-0001", REQUEST_ID.toUpperCase()]) {
      await service.record(TX, {
        action: "settings.update",
        actor: { type: "system" },
        request: { requestId, ip: null, userAgent: undefined },
      });
    }

    expect(repository.insert.mock.calls.map(([, row]) => row.requestId)).toEqual([null, null, null]);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: "settings.update" },
      "audit request id is not server-generated; stored null instead",
    );
    expect(isServerRequestId(REQUEST_ID)).toBe(true);
    expect(isServerRequestId(undefined)).toBe(false);
  });

  it("rejects unknown actions", async () => {
    const { service, repository } = setup();
    const unknown = "settings.delete" as AuditAction;

    await expect(service.record(TX, { action: unknown, actor: { type: "system" } })).rejects.toThrow(TypeError);
    expect(repository.insert).not.toHaveBeenCalled();
    expect(AUDIT_ACTIONS.every((action) => isAuditAction(action))).toBe(true);
    expect(isAuditAction("Settings.Update")).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
  });

  it("requires actorId unless the actor is system", async () => {
    const { service, repository } = setup();
    const unnamed = [
      { type: "user", id: "" },
      { type: "admin" },
      { type: "agent", id: undefined },
    ] as unknown as AuditActor[];

    for (const actor of unnamed) {
      await expect(service.record(TX, { action: "settings.update", actor }), actor.type).rejects.toThrow(
        `An audit actor of type ${actor.type} needs an id`,
      );
    }
    expect(repository.insert).not.toHaveBeenCalled();
    expect(actorIdOf({ type: "system" })).toBeNull();
    expect(actorIdOf({ type: "agent", id: "run_1" })).toBe("run_1");
  });

  it("caps the data size", async () => {
    const { service, repository, logger } = setup();
    const big = { changed: ["x".repeat(AUDIT_DATA_MAX_BYTES)] };

    await service.record(TX, { action: "settings.update", actor: { type: "system" }, data: big });

    const bytes = Buffer.byteLength(JSON.stringify(big));
    expect(repository.insert.mock.calls[0]?.[1].data).toEqual({ truncated: true, bytes });
    expect(logger.warn).toHaveBeenCalledWith(
      { action: "settings.update", bytes },
      "audit data over 4 KiB; stored a summary instead",
    );
    // Exactly at the cap is stored as is (bytes, not characters: "é" is two).
    const edge = { s: "é".repeat((AUDIT_DATA_MAX_BYTES - 8) / 2) };
    expect(Buffer.byteLength(JSON.stringify(edge))).toBe(AUDIT_DATA_MAX_BYTES);
    expect(boundedAuditData(edge)).toEqual({ value: edge, bytes: AUDIT_DATA_MAX_BYTES, truncated: false });
  });
});
