import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { forbiddenSurfaceUtilities } from "../../test/classes";
import { Kbd, KbdGroup } from "../kbd";

describe("Kbd", () => {
  it("renders <kbd> keycaps in a group, mono on surface-2 with a 1px edge", () => {
    render(
      <KbdGroup data-testid="group">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>,
    );

    const group = screen.getByTestId("group");
    expect(group).toHaveAttribute("data-slot", "kbd-group");
    const keys = [...group.querySelectorAll("kbd")];
    expect(keys.map((key) => key.textContent)).toEqual(["⌘", "K"]);
    for (const key of keys) {
      expect(key).toHaveAttribute("data-slot", "kbd");
      expect(key).toHaveClass("font-mono", "bg-surface-2", "border", "border-border", "h-5");
      expect(forbiddenSurfaceUtilities(key.className)).toEqual([]);
    }
  });

  it("has a small size for dense chrome", () => {
    render(<Kbd size="sm">[</Kbd>);

    expect(screen.getByText("[")).toHaveClass("h-4.5", "text-2xs");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <p>
        Press <Kbd>[</Kbd> to toggle the sidebar.
      </p>,
    );

    await expectNoAxeViolations(container);
  });
});
