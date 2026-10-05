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
  it("orders migration folders as init, timescale, db_guards, tenant_fks, then kill_switch_and_audit_guards, with 14-digit timestamps", () => {
    const folders = migrationFolders();

    // A hand-numbered folder such as 0001_timescale would sort first and run before the tables exist.
    for (const folder of folders) expect(folder).toMatch(/^\d{14}_[a-z][a-z0-9_]*$/);
    expect(folders.slice(0, 5).map((folder) => folder.slice(15))).toEqual([
      "init",
      "timescale",
      "db_guards",
      "tenant_fks",
      "kill_switch_and_audit_guards",
    ]);
  });

  it("creates pg_trgm at the top of init, before the trigram indexes", () => {
    const sql = migrationSql("init");

    expect(sql.trimStart().startsWith("CREATE EXTENSION IF NOT EXISTS pg_trgm;")).toBe(true);
    expect(sql).toContain('USING GIN ("name" gin_trgm_ops)');
  });
});
