-- Database guards, part 2 (security review F1 and F4). Hand-written: Prisma never generates or diffs triggers and
-- functions. Every statement is idempotent: Prisma >= 7.4 runs migration.sql statement by statement, not atomically.
--
-- ENABLE ALWAYS: a trigger in the default (origin) mode does not fire while session_replication_role = replica, which
-- any superuser, RDS rds_superuser, or a role granted SET on that parameter can set for its session. An ALWAYS trigger
-- fires in every mode. CREATE OR REPLACE TRIGGER resets the mode to origin, so a later migration that replaces one of
-- these four triggers must repeat its ALTER TABLE ... ENABLE ALWAYS TRIGGER after the CREATE OR REPLACE.

-- AuditLog stays append-only in replica mode too (the triggers come from migrations/<timestamp>_db_guards).
ALTER TABLE "AuditLog" ENABLE ALWAYS TRIGGER audit_log_no_update_delete;
ALTER TABLE "AuditLog" ENABLE ALWAYS TRIGGER audit_log_no_truncate;

-- GlobalControl (the platform-wide kill switch) is permanent. The seed creates its row only when it is missing (plan
-- D11), so a deleted or truncated row would come back with killSwitch = false at the next seed, silently disengaging an
-- engaged switch. UPDATE stays allowed: that is how the switch is toggled. GlobalControl has no foreign key in either
-- direction, so TRUNCATE ... CASCADE on another table (TRUNCATE "User" CASCADE included) never reaches it.
CREATE OR REPLACE FUNCTION global_control_permanent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GlobalControl is permanent (% rejected)', TG_OP;
END $$;
CREATE OR REPLACE TRIGGER global_control_no_delete BEFORE DELETE ON "GlobalControl"
  FOR EACH ROW EXECUTE FUNCTION global_control_permanent();
CREATE OR REPLACE TRIGGER global_control_no_truncate BEFORE TRUNCATE ON "GlobalControl"
  FOR EACH STATEMENT EXECUTE FUNCTION global_control_permanent();
ALTER TABLE "GlobalControl" ENABLE ALWAYS TRIGGER global_control_no_delete;
ALTER TABLE "GlobalControl" ENABLE ALWAYS TRIGGER global_control_no_truncate;
