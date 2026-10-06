/**
 * The design rules every story is checked against after it renders (plan D15, US3), in Storybook, in the Vitest story
 * tests and in the visual suite: buttons and inputs have no border and no box-shadow (frontend.md). Affordance comes
 * from filled surfaces and the 2px focus outline, which is an outline, so it isn't checked here.
 */

/** Elements that act as controls: native, by role, or a Button rendered through `asChild` (usually a link). */
export const CONTROLS = [
  "button",
  '[data-slot="button"]',
  "input",
  "select",
  "textarea",
  '[role="button"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="tab"]',
].join(", ");

/** Set on <body> once a story has rendered, run its play function and passed these checks. The visual suite waits
 *  for it before taking a screenshot. */
export const DESIGN_CHECKED_ATTRIBUTE = "data-design-checked";

function describe(element: Element): string {
  const label = element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 40);
  const slot = element.getAttribute("data-slot");
  return `<${element.tagName.toLowerCase()}${slot ? ` data-slot="${slot}"` : ""}> "${label}"`;
}

/** Every rule violation under `root`, as readable sentences. */
export function findDesignViolations(root: ParentNode): string[] {
  const violations: string[] = [];
  for (const control of root.querySelectorAll(CONTROLS)) {
    const style = getComputedStyle(control);
    const borders = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
    if (borders.some((width) => width !== "0px")) {
      violations.push(`${describe(control)} has a border (${borders.join(" ")}); controls are borderless.`);
    }
    if (style.boxShadow !== "none") {
      violations.push(`${describe(control)} has a box-shadow (${style.boxShadow}); controls have none.`);
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
