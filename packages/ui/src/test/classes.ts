/**
 * Utilities that would give a control a border, a box-shadow or a box-shadow ring (frontend.md bans all three on
 * buttons and inputs; focus is an outline). `outline-ring` is an outline colour, so it's allowed.
 */
const FORBIDDEN = /^-?(?:inset-)?(?:border|shadow|ring|divide)(?:-|$)/;

/** The forbidden utilities in a class list, variants (`hover:`, `focus-visible:`) included. */
export function forbiddenControlUtilities(className: string): string[] {
  return className.split(/\s+/).filter((token) => FORBIDDEN.test((token.split(":").at(-1) ?? "").replace(/^!/, "")));
}
