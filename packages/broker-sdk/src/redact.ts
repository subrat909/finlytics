/**
 * Redaction for anything that leaves the gateway as text: error messages, broker messages, log fields (plan B5).
 * Removes the call's own secret values, then token-shaped text, and makes the result one line of at most `maxLength`
 * characters (problem details `detail` and `broker.message` are single-line, ≤ 500).
 */

export const REDACTED = "[REDACTED]";

/** Secret values shorter than this are not searched for: they would redact ordinary words. */
const MIN_SECRET_LENGTH = 6;

interface TokenRule {
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

const TOKEN_RULES: readonly TokenRule[] = [
  // Authorization header values.
  {
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_match, scheme) => `${scheme} ${REDACTED}`,
  },
  // JWTs (Upstox access tokens are JWTs).
  { pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, replace: () => REDACTED },
  // key=value, key: value and "key": "value" for secret-looking keys (accessToken, access_token, client_secret, …).
  {
    pattern:
      /\b((?:access|refresh|id)[_-]?token|client[_-]?secret|api[_-]?(?:key|secret)|password|secret)(["']?\s*[:=]\s*["']?)(?!\[REDACTED\])[^\s"'&,;)\]}]+/gi,
    replace: (_match, key, separator) => `${key}${separator}${REDACTED}`,
  },
];

// C0 and C1 controls, DEL, line and paragraph separators, bidirectional controls and BOM: never in a single line.
// Built from a string so the source stays ASCII; the escapes are expanded by the RegExp parser.
const UNSAFE_CHARACTERS = new RegExp(
  // eslint-disable-next-line no-control-regex -- matching control characters is the point of this pattern
  "[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]+",
  "g",
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` with every secret and token-shaped substring replaced by `[REDACTED]`, on one line, at most `maxLength`
 * characters (never splitting a surrogate pair).
 */
export function redactSecrets(text: string, secrets: readonly string[] = [], maxLength = 500): string {
  let result = text;
  // Longest first, so a secret that contains another is removed whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= MIN_SECRET_LENGTH) result = result.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  for (const rule of TOKEN_RULES) result = result.replace(rule.pattern, rule.replace);
  result = result.replace(UNSAFE_CHARACTERS, " ").trim();
  if (result.length <= maxLength) return result;
  let end = maxLength - 1;
  const code = result.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${result.slice(0, end)}…`;
}
