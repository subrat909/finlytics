/**
 * Class-list checks for the border rule (frontend.md): buttons have no border, no box-shadow and no box-shadow ring;
 * cards, inputs and other surfaces have a 1px `border` (inputs `border-strong`) edge and still no shadow or ring.
 * Focus is an outline, so `outline-ring` is allowed everywhere.
 */
const SHADOW_OR_RING = /^-?(?:inset-)?(?:shadow|ring|divide)(?:-|$)/;
const BORDER = /^border(?:-|$)/;

/** The last segment of a utility, without variants (`hover:`, `focus-visible:`) or the important flag. */
function utility(token: string): string {
  return (token.split(":").at(-1) ?? "").replace(/^!/, "");
}

/** Utilities a button must never carry: borders, shadows, rings, dividers. */
export function forbiddenControlUtilities(className: string): string[] {
  return className.split(/\s+/).filter((token) => SHADOW_OR_RING.test(utility(token)) || BORDER.test(utility(token)));
}

/** Utilities a card, an input or another surface must never carry: shadows, rings, dividers. Borders are fine. */
export function forbiddenSurfaceUtilities(className: string): string[] {
  return className.split(/\s+/).filter((token) => SHADOW_OR_RING.test(utility(token)));
}

/** The border utilities in a class list, variants included (`border`, `border-border`, `aria-invalid:border-loss`). */
export function borderUtilities(className: string): string[] {
  return className.split(/\s+/).filter((token) => BORDER.test(utility(token)));
}
