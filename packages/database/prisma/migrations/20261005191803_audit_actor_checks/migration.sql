-- AuditLog actor guards. Hand-written: Prisma never generates CHECK constraints and ignores them when diffing (no
-- drift). Every statement is idempotent: Prisma >= 7.4 runs migration.sql statement by statement, not atomically.
--
-- NOT VALID: every new row is checked, existing rows are not. AuditLog is append-only (its triggers reject UPDATE), so
-- a historical row could never be corrected anyway. Unlike triggers and foreign keys, CHECK constraints also hold while
-- session_replication_role = replica.

-- The four kinds of actor. A new kind is a migration that replaces this constraint.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorType_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorType_check"
  CHECK ("actorType" IN ('user', 'admin', 'system', 'agent')) NOT VALID;

-- Every actor but the system itself is named: a user or admin id, or an agent run id.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorId_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_check"
  CHECK ("actorType" = 'system' OR "actorId" IS NOT NULL) NOT VALID;
