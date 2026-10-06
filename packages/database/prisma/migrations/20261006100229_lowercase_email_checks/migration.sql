-- Case-insensitive email by normalisation (Phase 0 carry-forward, before 0.6). Hand-written: Prisma never generates
-- CHECK constraints and ignores them when diffing (no drift). Every statement is idempotent: Prisma >= 7.4 runs
-- migration.sql statement by statement, not atomically.
--
-- Every writer trims and lowercases an email before storing it (`normalizeEmail` in @finlytics/shared; the web app's
-- Auth.js adapter and Auth.js's own email-provider normalisation), so the plain unique index on "email" is
-- case-insensitive in effect and stays usable for equality lookups. These CHECKs make a writer that forgets fail loudly
-- instead of creating a second account for `Asha@x.in`. citext was rejected: it adds an extension and a type Prisma
-- maps poorly, for what one CHECK guarantees.
--
-- Validated, not NOT VALID: when this was written, no stored email or identifier had an upper-case letter (checked on
-- the dev database; production had no users yet). ADD CONSTRAINT scans the table under an ACCESS EXCLUSIVE lock; both
-- tables are small. Unlike triggers and foreign keys, CHECK constraints also hold while session_replication_role =
-- replica.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_lowercase_check";
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email"));

-- Auth.js stores the (normalised) email address as the magic-link token's identifier.
ALTER TABLE "VerificationToken" DROP CONSTRAINT IF EXISTS "VerificationToken_identifier_lowercase_check";
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_identifier_lowercase_check"
  CHECK ("identifier" = lower("identifier"));
