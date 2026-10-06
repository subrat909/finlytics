/**
 * User settings (plan D15; docs/04 §2 "Settings"). The contract is `packages/shared/src/schemas/user-settings.ts`.
 *
 * - Read, lenient: the stored JSONB goes through `parseUserSettingsWithIssues`; every missing or invalid field gets its
 *   default, and what was repaired is logged at warn (Phase 0 carry-forward note 2), never hidden.
 * - Write, strict: the body has already passed `UserSettingsPatchSchema` (the global pipe; unknown keys are 400). One
 *   transaction: lock the user's row, read, merge, store, and write one audit row naming the fields that changed. A
 *   patch that changes nothing writes nothing.
 * - Stored: the user's overrides only, never the merged result: the stored value's valid fields with the patch merged
 *   in. A default the user never set stays a default, so changing DEFAULT_USER_SETTINGS reaches them; a field they did
 *   set (even to the current default) stays theirs. Invalid and unknown stored fields are dropped by the write.
 * - Audited: `changed` lists the fields whose stored value the patch set or changed (one it pinned to the current
 *   default included), never a field the write only repaired.
 * - Settings hold preferences only: nothing here can loosen a trading safeguard (risk limits, auto-trade, the kill
 *   switch and the default broker live elsewhere, behind step-up auth).
 */
import { mergeUserSettings, parseUserSettingsWithIssues } from "@finlytics/shared";
import type { UserSettings, UserSettingsPatch } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import type { RequestMetadata } from "../../common/decorators/request-meta";
import { UnauthenticatedError } from "../../common/problem-json/domain-errors";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

import { SettingsRepository } from "./settings.repository";

/** The most repaired fields one log line lists. */
const MAX_LOGGED_ISSUES = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The user's valid overrides in a stored value: each field present in `stored` that the lenient read kept as it was
 * (`settings` is that read's result; an invalid value was replaced by its default, so it isn't kept). Unknown keys and
 * empty sections are dropped. Patch-shaped.
 */
export function storedOverrides(stored: unknown, settings: UserSettings): UserSettingsPatch {
  return pickStored(stored, settings) ?? {};
}

function pickStored(stored: unknown, parsed: unknown): unknown {
  if (!isPlainObject(parsed)) return Object.is(stored, parsed) ? parsed : undefined;
  if (!isPlainObject(stored)) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    const value = Object.hasOwn(stored, key) ? pickStored(stored[key], parsed[key]) : undefined;
    if (value !== undefined) picked[key] = value;
  }
  return Object.keys(picked).length === 0 ? undefined : picked;
}

/**
 * `patch` deep-merged into `overrides`, as a new tree without empty sections. Both are valid patches (the patch passed
 * UserSettingsPatchSchema), so the result is one too.
 */
export function mergeOverrides(overrides: UserSettingsPatch, patch: UserSettingsPatch): UserSettingsPatch {
  return mergeTrees(overrides, patch) ?? {};
}

function mergeTrees(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const from = isPlainObject(base) ? base : {};
  const merged: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(patch)])) {
    const next = Object.hasOwn(patch, key) ? mergeTrees(from[key], patch[key]) : from[key];
    if (next !== undefined) merged[key] = next;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

/**
 * The dot paths of the leaves that differ between two settings trees, in the order the fields appear. A section that
 * exists on one side only counts by its leaves (`appearance.theme`, not `appearance`); a leaf replaced by a section,
 * or the reverse, counts as its own path.
 */
export function changedPaths(before: unknown, after: unknown, path = ""): string[] {
  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);
  if (beforeIsObject || afterIsObject) {
    if (beforeIsObject !== afterIsObject && before !== undefined && after !== undefined) return [path];
    const from = beforeIsObject ? before : {};
    const to = afterIsObject ? after : {};
    const keys = [...new Set([...Object.keys(to), ...Object.keys(from)])];
    return keys.flatMap((key) => changedPaths(from[key], to[key], path === "" ? key : `${path}.${key}`));
  }
  return Object.is(before, after) ? [] : [path];
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(SettingsService.name);
  }

  /** `GET /v1/me/settings`: complete settings, defaults for whatever isn't stored. */
  async get(userId: string): Promise<UserSettings> {
    const row = await this.settings.find(userId);
    // The session guard checked the user moments ago; one deleted since is treated like an ended session.
    if (row === null) throw new UnauthenticatedError("Sign in to continue.");
    return this.read(row.settings);
  }

  /** `PATCH /v1/me/settings`: applies a validated patch and returns the complete result. */
  update(userId: string, patch: UserSettingsPatch, request: RequestMetadata): Promise<UserSettings> {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.settings.lockForUpdate(tx, userId);
      if (row === null) throw new UnauthenticatedError("Sign in to continue.");
      const current = this.read(row.settings);
      const next = mergeUserSettings(current, patch);
      const overrides = storedOverrides(row.settings, current);
      const nextOverrides = mergeOverrides(overrides, patch);
      const changed = changedPaths(overrides, nextOverrides);
      if (changed.length === 0) return next;

      await this.settings.save(tx, userId, nextOverrides);
      await this.audit.record(tx, {
        action: "settings.update",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "User", id: userId },
        request,
        data: { changed },
      });
      return next;
    });
  }

  /** Stored settings, read leniently; the repaired fields are logged, not hidden. */
  private read(stored: unknown): UserSettings {
    const { settings, issues } = parseUserSettingsWithIssues(stored);
    if (issues.length > 0) {
      this.logger.warn(
        { issues: issues.slice(0, MAX_LOGGED_ISSUES), issueCount: issues.length },
        "stored settings repaired with defaults",
      );
    }
    return settings;
  }
}
