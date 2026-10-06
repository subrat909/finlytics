/**
 * The Content Security Policy (plan W8; security.md: `default-src 'self'` with nonces). Built per request by
 * src/proxy.ts; Next.js reads the nonce from the request's CSP header and puts it on its own scripts.
 */

/** A fresh nonce: 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Where OAuth avatars come from (`User.image`). */
export const AVATAR_ORIGINS = ["https://lh3.googleusercontent.com", "https://avatars.githubusercontent.com"] as const;

/** Where the OAuth sign-in forms redirect when JavaScript is off (form-action also covers a form's redirects). */
export const OAUTH_FORM_ORIGINS = ["https://accounts.google.com", "https://github.com"] as const;

export interface CspOptions {
  nonce: string;
  /** Development: React needs `'unsafe-eval'` for its debugging aids, and the page isn't upgraded to https. */
  dev: boolean;
}

export function buildContentSecurityPolicy({ nonce, dev }: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Style attributes only (not <style> elements): Radix server-renders some (RadioGroup's hidden inputs, roving
    // focus), and an attribute can't style anything but its own element. Older browsers fall back to style-src.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${AVATAR_ORIGINS.join(" ")}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self' ${OAUTH_FORM_ORIGINS.join(" ")}`,
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
