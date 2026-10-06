/**
 * Email addresses are case-insensitive in Finlytics: one person, one account, however a provider capitalises the
 * address. The database enforces it (`CHECK ("email" = lower("email"))` on `User`, the same on
 * `VerificationToken.identifier`; docs/03), so every writer and every lookup by email goes through `normalizeEmail`.
 */

/**
 * The stored form of an email address: surrounding whitespace removed, then lowercased (the whole address, local part
 * included: RFC 5321 allows a case-sensitive local part, but no provider Finlytics accepts uses one, and treating
 * `Asha@x.in` and `asha@x.in` as two accounts is the bigger risk). Nothing else changes: no dot or `+tag` folding,
 * which would merge addresses that really are different. Idempotent.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
