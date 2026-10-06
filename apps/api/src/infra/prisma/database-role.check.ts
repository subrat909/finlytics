/**
 * The production database-role check (plan D14, security finding F2, interim until the 2.1 role split). What it
 * enforces, exactly:
 *
 * - Refuses (production) or warns (development, test) when the api's database role
 *   - is a superuser (`is_superuser`), or a member, directly or through other roles, of any superuser role;
 *   - is a member of `pg_execute_server_program` or `pg_write_server_files` (shell commands and file writes on the
 *     database server, through COPY);
 *   - may SET `session_replication_role` (`has_parameter_privilege`, PostgreSQL >= 15): replica mode disables foreign
 *     keys (the tenancy keys among them) and every trigger not marked ENABLE ALWAYS.
 * - Warns, in every environment, when the role owns `"AuditLog"` (or is a member of its owner): an owner can disable
 *   the append-only triggers or drop the table. Until the 2.1 split moves ownership to a migrator role, the app role
 *   may legitimately own the tables it migrated, so this is not a refusal.
 *
 * Not checked: other role attributes and grants (CREATEROLE, CREATEDB, BYPASSRLS, `pg_read_server_files`, ownership
 * of other tables). The 2.1 role split replaces this check.
 *
 * Production: up to 30 s of retries while the database is unreachable, then an UnsafeDatabaseRoleError (main.ts exits
 * 1). Readiness stays 503 until the check has passed once.
 */
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { sleep } from "../../common/async";
import { ReadinessState } from "../lifecycle/readiness.state";

import { PrismaService } from "./prisma.service";

export interface DatabaseRoleFacts {
  /** The role is a superuser (`is_superuser`). */
  readonly superuser: boolean;
  /** The role is a member of some superuser role (`pg_has_role(…, 'MEMBER')` on a `rolsuper` role). */
  readonly memberOfSuperuser: boolean;
  /** The role is a member of `pg_execute_server_program` or `pg_write_server_files`. */
  readonly serverFileAccess: boolean;
  /** The role may SET `session_replication_role` (`has_parameter_privilege`, PostgreSQL >= 15). */
  readonly canSetReplicationRole: boolean;
  /** The role owns `"AuditLog"`, or is a member of its owner. Warned about, never refused. */
  readonly ownsAuditLog: boolean;
}

/** Whether a role with these facts may run the api in production. Owning AuditLog only warns. */
export function isSafeDatabaseRole(facts: DatabaseRoleFacts): boolean {
  return !facts.superuser && !facts.memberOfSuperuser && !facts.serverFileAccess && !facts.canSetReplicationRole;
}

/** The database role may bypass the database's own guards: the api refuses to start in production. */
export class UnsafeDatabaseRoleError extends Error {
  override readonly name = "UnsafeDatabaseRoleError";

  constructor(readonly facts: DatabaseRoleFacts) {
    super(
      "The database role is (or is a member of) a superuser, a member of pg_execute_server_program or " +
        "pg_write_server_files, or may SET session_replication_role; production refuses to start with it (use a " +
        "dedicated app role: plan D14, security finding F2)",
    );
  }
}

const OWNS_AUDIT_LOG_WARNING =
  "the database role owns AuditLog: it could disable the append-only triggers (moves to a migrator role in 2.1)";

export interface EnforceOptions {
  /** How long to keep retrying while the database is unreachable. Defaults to 30 s. */
  readonly retryForMs?: number;
  /** The first retry delay; it doubles up to 5 s. Defaults to 250 ms. */
  readonly initialDelayMs?: number;
}

const MAX_RETRY_DELAY_MS = 5_000;

@Injectable()
export class DatabaseRoleCheck {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessState,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(DatabaseRoleCheck.name);
  }

  /** Reads the facts about the current database role. */
  async inspect(): Promise<DatabaseRoleFacts> {
    const rows = await this.prisma.unscoped.$queryRaw<
      {
        superuser: boolean;
        member_of_superuser: boolean;
        server_file_access: boolean;
        can_set_replication_role: boolean;
        owns_audit_log: boolean;
      }[]
    >`
      SELECT current_setting('is_superuser') = 'on' AS superuser,
             EXISTS (SELECT 1 FROM pg_roles r
                      WHERE r.rolsuper AND pg_has_role(current_user, r.oid, 'MEMBER')) AS member_of_superuser,
             EXISTS (SELECT 1 FROM pg_roles r
                      WHERE r.rolname IN ('pg_execute_server_program', 'pg_write_server_files')
                        AND pg_has_role(current_user, r.oid, 'MEMBER')) AS server_file_access,
             has_parameter_privilege('session_replication_role', 'SET') AS can_set_replication_role,
             EXISTS (SELECT 1 FROM pg_class c
                      WHERE c.oid = to_regclass('"AuditLog"')
                        AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS owns_audit_log`;
    const [row] = rows;
    if (row === undefined) throw new Error("database role check returned no row");
    return {
      superuser: row.superuser,
      memberOfSuperuser: row.member_of_superuser,
      serverFileAccess: row.server_file_access,
      canSetReplicationRole: row.can_set_replication_role,
      ownsAuditLog: row.owns_audit_log,
    };
  }

  /**
   * Production: passes, or throws. Retries while the database can't be reached; an unsafe role throws at once.
   *
   * @throws {UnsafeDatabaseRoleError} when {@link isSafeDatabaseRole} says no. Owning AuditLog only warns.
   */
  async enforce({ retryForMs = 30_000, initialDelayMs = 250 }: EnforceOptions = {}): Promise<void> {
    const deadline = Date.now() + retryForMs;
    let delay = initialDelayMs;
    for (;;) {
      try {
        const facts = await this.inspect();
        if (!isSafeDatabaseRole(facts)) throw new UnsafeDatabaseRoleError(facts);
        if (facts.ownsAuditLog) this.logger.warn(OWNS_AUDIT_LOG_WARNING);
        this.readiness.markRoleCheckPassed();
        this.logger.info("database role check passed");
        return;
      } catch (error: unknown) {
        if (error instanceof UnsafeDatabaseRoleError || Date.now() + delay > deadline) throw error;
        this.logger.warn({ err: error }, "database role check: database not reachable yet, retrying");
        await sleep(delay);
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
      }
    }
  }

  /** Development and test: warns about an unsafe role (a superuser in docker compose); never throws. */
  async warnIfUnsafe(): Promise<void> {
    try {
      const facts = await this.inspect();
      if (!isSafeDatabaseRole(facts)) {
        this.logger.warn(
          { facts },
          "the database role may bypass the database's guards (see facts); production would refuse to start",
        );
      } else if (facts.ownsAuditLog) {
        this.logger.warn(OWNS_AUDIT_LOG_WARNING);
      }
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "database role check skipped: database not reachable");
    }
  }
}
