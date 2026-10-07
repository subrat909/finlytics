function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Where a user lands after signing in when nothing else is asked for. */
export const DEFAULT_AFTER_SIGN_IN = "/dashboard";

/**
 * A safe post-sign-in path: a same-origin absolute path (`/dashboard?x=1`), never a protocol-relative (`//evil`) or
 * backslash (`/\evil`) form that browsers treat as another origin, and never back to the auth pages themselves.
 */
export function safeCallbackPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return DEFAULT_AFTER_SIGN_IN;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_AFTER_SIGN_IN;
  if (hasControlCharacter(value)) return DEFAULT_AFTER_SIGN_IN;
  const path = value.split(/[?#]/, 1)[0] ?? "";
  if (path === "/login" || path === "/verify" || path.startsWith("/api/auth")) return DEFAULT_AFTER_SIGN_IN;
  return value;
}
