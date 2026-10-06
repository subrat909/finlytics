/**
 * Internal: not exported from the package entry point.
 *
 * Quotes a caller's string for an error message: JSON-escaped (so control characters can't break a log line) and
 * truncated to 40 characters (so a huge input can't flood the logs).
 */
export function quote(text: string): string {
  return JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);
}
