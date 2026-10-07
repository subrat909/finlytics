/**
 * `GET /v1/me` (plan D15, docs/04 §2): the signed-in user, as the web app shows it. Never the role, the password hash,
 * 2FA secrets or lockout state.
 */
import { z } from "zod";

/**
 * The signed-in user. Strict: a member the server didn't mean to send fails the response schema instead of leaking.
 *
 * - `email` is not re-validated as an address: it is whatever the OAuth provider gave Auth.js, and an unusual but real
 *   address must not fail the response.
 * - `name` and `image` are `null` when the provider didn't supply them.
 * - `timezone` is an IANA zone name, `"Asia/Kolkata"` by default.
 * - `createdAt` is an ISO 8601 UTC timestamp (`Date.prototype.toISOString()`).
 */
export const MeSchema = z.strictObject({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
  timezone: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type Me = z.infer<typeof MeSchema>;
