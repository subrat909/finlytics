/**
 * Bounding text for problems (docs/04 §6): every text member is one line within a maximum length. Servers shorten or
 * drop text that doesn't fit rather than send an invalid problem.
 */

/**
 * Everything the shared problem schema forbids in text (`FORBIDDEN_IN_TEXT` in @finlytics/shared): C0/C1 control
 * characters (CR, LF, tab, DEL, NEL…), the Unicode line and paragraph separators, lone surrogates, bidi controls and
 * the BOM. Text from the client (JSON keys become field paths) must lose them here, or a 400 would fall back to 500.
 */
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/** `text` cut to at most `max` UTF-16 code units, ending in "…" when cut, never splitting a surrogate pair. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** One line of at most `max` code units (line breaks and control characters become spaces), or undefined if blank. */
export function singleLine(text: string, max: number): string | undefined {
  const flat = text.replace(LINE_BREAKING, " ").trim();
  return flat === "" ? undefined : truncate(flat, max);
}

/**
 * A field path for `errors[].path`: one line of at most `max` code units. Characters that would break a line become
 * U+FFFD, so a client-chosen key can't forge a log line or a header; `""` (the body as a whole) stays `""`.
 */
export function singleLinePath(path: string, max: number): string {
  return truncate(path.replace(LINE_BREAKING, "�"), max);
}
