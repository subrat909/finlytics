-- Database guards that Prisma cannot express (it never generates CHECK constraints, functions or triggers, and ignores
-- them when diffing). Every statement is idempotent: Prisma >= 7.4 runs migration.sql statement by statement.

-- GlobalControl is a singleton (the platform-wide kill switch): only id = 1 may exist.
ALTER TABLE "GlobalControl" DROP CONSTRAINT IF EXISTS "GlobalControl_singleton";
ALTER TABLE "GlobalControl" ADD CONSTRAINT "GlobalControl_singleton" CHECK ("id" = 1);

-- AuditLog is append-only (SEBI audit trail): a row trigger rejects UPDATE and DELETE, a statement trigger TRUNCATE.
-- AuditLog has no foreign key to User, so deleting a user never touches its audit rows.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% rejected)', TG_OP;
END $$;
CREATE OR REPLACE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE OR REPLACE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
