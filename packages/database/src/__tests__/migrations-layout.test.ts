import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));

/** Migration folders in the order Prisma applies them (lexicographic). */
function migrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationSql(name: string): string {
  const folder = migrationFolders().find((candidate) => candidate.endsWith(`_${name}`));
  if (folder === undefined) throw new Error(`No migration folder named *_${name}`);
  return readFileSync(path.join(MIGRATIONS_DIR, folder, "migration.sql"), "utf8");
}

describe("prisma/migrations", () => {
  it("orders the seven migration folders, ending with audit_actor_and_session_created_at and audit_actor_checks", () => {
    const folders = migrationFolders();

    // A hand-numbered folder such as 0001_timescale would sort first and run before the tables exist.
    for (const folder of folders) expect(folder).toMatch(/^\d{14}_[a-z][a-z0-9_]*$/);
    expect(folders.map((folder) => folder.slice(15))).toEqual([
      "init",
      "timescale",
      "db_guards",
      "tenant_fks",
      "kill_switch_and_audit_guards",
      "audit_actor_and_session_created_at",
      "audit_actor_checks",
    ]);
  });

  it("makes every statement of the audit-actor migrations idempotent", () => {
    // Prisma >= 7.4 runs migration.sql statement by statement, so a partially applied migration is re-applied as is.
    // Comment lines dropped first (they may contain ";"), then one statement per ";", whitespace collapsed.
    const statements = (name: string) =>
      migrationSql(name)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .split(";")
        .map((statement) => statement.replace(/\s+/g, " ").trim())
        .filter((statement) => statement !== "");

    expect(statements("audit_actor_and_session_created_at")).toEqual([
      'ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorId" TEXT',
      'ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC)',
    ]);
    // Each CHECK is dropped if it exists, then added NOT VALID: existing rows are never re-checked.
    const checks = statements("audit_actor_checks");
    expect(checks.map((statement) => /^ALTER TABLE "AuditLog" (DROP|ADD) CONSTRAINT/.exec(statement)?.[1])).toEqual([
      "DROP",
      "ADD",
      "DROP",
      "ADD",
    ]);
    expect(checks.filter((statement) => statement.includes(" DROP CONSTRAINT "))).toEqual([
      'ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorType_check"',
      'ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorId_check"',
    ]);
    for (const statement of checks.filter((candidate) => candidate.includes(" ADD CONSTRAINT "))) {
      expect(statement).toMatch(/ NOT VALID$/);
    }
  });

  it("creates pg_trgm at the top of init, before the trigram indexes", () => {
    const sql = migrationSql("init");

    expect(sql.trimStart().startsWith("CREATE EXTENSION IF NOT EXISTS pg_trgm;")).toBe(true);
    expect(sql).toContain('USING GIN ("name" gin_trgm_ops)');
  });
});
