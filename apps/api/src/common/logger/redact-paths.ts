/**
 * pino redaction paths (plan D5, security.md "Logs"). The allowlisting serializers (./serializers.ts) are the main
 * control: they never emit headers, bodies or query strings. Redaction backs them up for anything logged by hand.
 *
 * Scoped to the keys the api's log lines actually carry, with no wildcard at the root: a root wildcard (`*.token`)
 * makes pino walk every top-level key of every line. Hand-written lines log flat, curated fields (`policy`, `bytes`,
 * `issues`, `prisma`, …) plus `err`, the only key whose value can nest arbitrary data (an error's own fields and its
 * `cause` chain). So each field is redacted at the top level and under `err`, at depths 1 and 2. A new log key that can
 * hold nested data belongs in {@link NESTED_LOG_KEYS}.
 */

/** What a redacted value is replaced with. */
export const REDACT_CENSOR = "[REDACTED]";

/** Header paths, should a serialized request, response or error ever carry headers. */
const HEADER_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  'headers["set-cookie"]',
  'err.headers["set-cookie"]',
] as const;

/** Field names that hold a credential or personal data. */
export const REDACTED_FIELDS = [
  "authorization",
  "cookie",
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "id_token",
  "sessionToken",
  "secret",
  "clientSecret",
  "apiKey",
  "credentials",
  "encryptedCredentials",
  "totpSecretEnc",
  "backupCodes",
  "email",
] as const;

/** Top-level log keys whose values can nest arbitrary data: redacted inside, at depths 1 and 2. */
export const NESTED_LOG_KEYS = ["err"] as const;

/** Every redaction path, for pino's `redact.paths`. */
export const REDACT_PATHS: readonly string[] = Object.freeze([
  ...HEADER_PATHS,
  ...REDACTED_FIELDS,
  ...NESTED_LOG_KEYS.flatMap((key) => REDACTED_FIELDS.flatMap((field) => [`${key}.${field}`, `${key}.*.${field}`])),
]);
