import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { Separator } from "../separator";

describe("Separator", () => {
  it("is a decorative 1px horizontal rule by default", () => {
    render(<Separator data-testid="rule" />);

    const rule = screen.getByTestId("rule");
    expect(rule).toHaveAttribute("role", "none");
    expect(rule).toHaveAttribute("data-orientation", "horizontal");
    expect(rule).not.toHaveAttribute("aria-orientation");
    expect(rule).toHaveClass("h-px", "w-full", "bg-border");
  });

  it("is a vertical separator for assistive technology when not decorative", () => {
    render(<Separator orientation="vertical" decorative={false} />);

    const rule = screen.getByRole("separator");
    expect(rule).toHaveAttribute("aria-orientation", "vertical");
    expect(rule).toHaveClass("w-px", "h-full");
  });

  it("leaves aria-orientation to the default for a horizontal separator", () => {
    render(<Separator decorative={false} />);

    expect(screen.getByRole("separator")).not.toHaveAttribute("aria-orientation");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <div>
        <p>Funds</p>
        <Separator decorative={false} />
        <p>Positions</p>
      </div>,
    );

    await expectNoAxeViolations(container);
  });
});
