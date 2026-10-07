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
  it("orders the ten migration folders, ending with lowercase_email_checks and broker_vault_and_instrument_tokens", () => {
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
      "drop_oauth_tokens_and_pro_role",
      "lowercase_email_checks",
      "broker_vault_and_instrument_tokens",
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

  it("makes every statement of the auth-hardening migrations idempotent", () => {
    // Comment lines dropped, then the DO block (whose body holds ";") kept whole, other statements split on ";".
    const body = (name: string) =>
      migrationSql(name)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");
    const statements = (sql: string) =>
      sql
        .split(";")
        .map((statement) => statement.replace(/\s+/g, " ").trim())
        .filter((statement) => statement !== "");

    // The enum change is one DO block (atomic in PostgreSQL), guarded by "Role still has PRO", so a re-run is a no-op.
    const roles = body("drop_oauth_tokens_and_pro_role");
    const doBlock = /DO \$\$([\s\S]*?)\$\$;/.exec(roles);
    expect(doBlock?.[1]).toMatch(
      /^\s*BEGIN\s+IF EXISTS \(SELECT 1 FROM pg_enum WHERE enumtypid = '"Role"'::regtype AND enumlabel = 'PRO'\) THEN/,
    );
    expect(doBlock?.[1]).toContain(`CREATE TYPE "Role_new" AS ENUM ('USER', 'ADMIN')`);
    expect(statements(roles.replace(doBlock?.[0] ?? "", ""))).toEqual([
      'ALTER TABLE "Account" DROP COLUMN IF EXISTS "access_token", DROP COLUMN IF EXISTS "id_token", ' +
        'DROP COLUMN IF EXISTS "refresh_token", DROP COLUMN IF EXISTS "session_state"',
    ]);
    expect(roles).not.toMatch(/^\s*(BEGIN|COMMIT);/m); // Prisma's own BEGIN/COMMIT wrapper is gone

    // Each lowercase CHECK is dropped if it exists, then added validated (no NOT VALID: no row violated it).
    expect(statements(body("lowercase_email_checks"))).toEqual([
      'ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_lowercase_check"',
      'ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email"))',
      'ALTER TABLE "VerificationToken" DROP CONSTRAINT IF EXISTS "VerificationToken_identifier_lowercase_check"',
      'ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_identifier_lowercase_check" ' +
        'CHECK ("identifier" = lower("identifier"))',
    ]);
  });

  it("makes every statement of the broker vault migration idempotent", () => {
    // Comment lines dropped, the DO block (whose body holds ";") checked on its own, other statements split on ";".
    const sql = migrationSql("broker_vault_and_instrument_tokens")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const doBlock = /DO \$\$([\s\S]*?)\$\$;/.exec(sql);
    // The TEXT → BYTEA retype drops the column only while it is still TEXT.
    expect(doBlock?.[1]).toContain("AND data_type = 'text'");
    const statements = sql
      .replace(doBlock?.[0] ?? "", "")
      .split(";")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter((statement) => statement !== "");

    expect(statements.length).toBeGreaterThan(10);
    for (const statement of statements) {
      const guarded =
        /^ALTER TABLE "\w+" (DROP COLUMN IF EXISTS|ADD COLUMN IF NOT EXISTS|DROP CONSTRAINT IF EXISTS) /.test(
          statement,
        ) ||
        /^ALTER TABLE "\w+" ALTER COLUMN "\w+" DROP NOT NULL$/.test(statement) ||
        /^CREATE (TABLE|INDEX) IF NOT EXISTS /.test(statement) ||
        // An ADD CONSTRAINT must directly follow the DROP CONSTRAINT IF EXISTS of the same name.
        (/^ALTER TABLE "\w+" ADD CONSTRAINT "(\w+)"/.test(statement) &&
          statements[statements.indexOf(statement) - 1]?.includes(
            `DROP CONSTRAINT IF EXISTS "${/ADD CONSTRAINT "(\w+)"/.exec(statement)?.[1] ?? ""}"`,
          ) === true);
      expect(guarded, statement).toBe(true);
    }
  });

  it("creates pg_trgm at the top of init, before the trigram indexes", () => {
    const sql = migrationSql("init");

    expect(sql.trimStart().startsWith("CREATE EXTENSION IF NOT EXISTS pg_trgm;")).toBe(true);
    expect(sql).toContain('USING GIN ("name" gin_trgm_ops)');
  });
});
