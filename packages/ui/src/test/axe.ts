import type { Result } from "axe-core";
import { expect } from "vitest";
import { configureAxe } from "vitest-axe";

/**
 * axe in jsdom (plan D15). jsdom has no layout, so colour contrast can't be measured here: the Storybook and visual
 * suites check it in a real browser. `region` is off because components aren't pages (landmarks are the app's job).
 */
const axe = configureAxe({
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
});

function report(violations: readonly Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  at ${node.target.map(String).join(" ")}\n    ${node.failureSummary ?? ""}`)
        .join("\n");
      return `${violation.id} (${violation.impact ?? "no impact"}): ${violation.help}\n${nodes}\n  ${violation.helpUrl}`;
    })
    .join("\n\n");
}

/**
 * Fails the test, listing every violation, when `container` has accessibility violations. The one entry point for
 * unit-level axe checks, so replacing vitest-axe (0.1.0, unmaintained) with axe-core directly is a one-file change.
 * vitest-axe's `toHaveNoViolations` matcher isn't used: its typings export it as a type only and target Vitest's
 * removed `Vi` namespace.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const { violations } = await axe(container);
  expect(
    violations.map((violation) => violation.id),
    violations.length > 0 ? report(violations) : undefined,
  ).toEqual([]);
}
