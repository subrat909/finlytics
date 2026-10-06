/**
 * The design rules every story is checked against after it renders (plan D15, US3), in Storybook, in the Vitest story
 * tests and in the visual suite (frontend.md):
 * - Buttons (and everything that acts as one: link buttons, radios, tabs, switches) have no border and no box-shadow.
 *   Affordance comes from filled surfaces and the 2px focus outline, which is an outline, so it isn't checked here.
 * - Fields (input, select, textarea) may have a border, at most 1px on each side (the `border-strong` edge), and no
 *   box-shadow.
 * Cards and other surfaces aren't controls: their 1px `border` edge is theirs to draw.
 */

/** Elements that act as buttons: native, by role, or a Button rendered through `asChild` (usually a link). */
export const BUTTONS = [
  "button",
  '[data-slot="button"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="tab"]',
].join(", ");

/** Text fields: a 1px edge is allowed. A native checkbox or radio input is a field too, for this check. */
export const FIELDS = ["input", "select", "textarea"].join(", ");

/** Set on <body> once a story has rendered, run its play function and passed these checks. The visual suite waits
 *  for it before taking a screenshot. */
export const DESIGN_CHECKED_ATTRIBUTE = "data-design-checked";

function describe(element: Element): string {
  const label = element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 40);
  const slot = element.getAttribute("data-slot");
  return `<${element.tagName.toLowerCase()}${slot ? ` data-slot="${slot}"` : ""}> "${label}"`;
}

function borderWidths(style: CSSStyleDeclaration): string[] {
  return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
}

/** Every rule violation under `root`, as readable sentences. */
export function findDesignViolations(root: ParentNode): string[] {
  const violations: string[] = [];
  for (const button of root.querySelectorAll(BUTTONS)) {
    const style = getComputedStyle(button);
    const borders = borderWidths(style);
    if (borders.some((width) => width !== "0px")) {
      violations.push(`${describe(button)} has a border (${borders.join(" ")}); buttons are borderless.`);
    }
    if (style.boxShadow !== "none") {
      violations.push(`${describe(button)} has a box-shadow (${style.boxShadow}); buttons have none.`);
    }
  }
  for (const field of root.querySelectorAll(FIELDS)) {
    if (field.matches(BUTTONS)) continue; // already checked as a button (an input with role="switch", say)
    const style = getComputedStyle(field);
    const borders = borderWidths(style);
    if (borders.some((width) => width !== "0px" && width !== "1px")) {
      violations.push(`${describe(field)} has a border wider than 1px (${borders.join(" ")}); fields use a 1px edge.`);
    }
    if (style.boxShadow !== "none") {
      violations.push(`${describe(field)} has a box-shadow (${style.boxShadow}); fields have none.`);
    }
  }
  return violations;
}

/** Throws with every violation under `root`, so the story (and its test) fails. */
export function assertDesignRules(root: ParentNode): void {
  const violations = findDesignViolations(root);
  if (violations.length > 0) {
    throw new Error(`Design rules broken:\n- ${violations.join("\n- ")}`);
  }
}
