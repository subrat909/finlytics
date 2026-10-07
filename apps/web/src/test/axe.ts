import type { Result } from "axe-core";
import { expect } from "vitest";
import { configureAxe } from "vitest-axe";

/**
 * axe in jsdom (as in packages/ui): no layout, so colour contrast is checked by the e2e suite in a real browser;
 * `region` is off because a component isn't a page.
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
      const nodes = violation.nodes.map((node) => `  at ${node.target.map(String).join(" ")}`).join("\n");
      return `${violation.id}: ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

export async function expectNoAxeViolations(container: Element): Promise<void> {
  const { violations } = await axe(container);
  expect(
    violations.map((violation) => violation.id),
    violations.length > 0 ? report(violations) : undefined,
  ).toEqual([]);
}
