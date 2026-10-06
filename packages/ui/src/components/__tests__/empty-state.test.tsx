import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { Button } from "../button";
import { EmptyState } from "../empty-state";

function Icon() {
  return <svg data-testid="icon" />;
}

describe("EmptyState", () => {
  it("renders icon, title, description and action", () => {
    render(
      <EmptyState
        icon={<Icon />}
        title="No orders today"
        description="Orders you place appear here."
        action={<Button>Place an order</Button>}
      />,
    );

    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No orders today" })).toBeInTheDocument();
    expect(screen.getByText("Orders you place appear here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place an order" })).toBeInTheDocument();
  });

  it("renders only what it is given", () => {
    const { container } = render(<EmptyState icon={<Icon />} title="No alerts" />);

    expect(container.querySelector('[data-slot="empty-state-description"]')).toBeNull();
    expect(container.querySelector('[data-slot="empty-state-action"]')).toBeNull();
  });

  it("uses the requested heading level", () => {
    render(
      <>
        <EmptyState icon={<Icon />} title="Page level" />
        <EmptyState icon={<Icon />} title="Card level" headingLevel={3} size="inline" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Page level", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Card level", level: 3 })).toBeInTheDocument();
  });

  it("hides the icon from assistive technology", () => {
    render(<EmptyState icon={<Icon />} title="No alerts" />);

    expect(screen.getByTestId("icon").closest('[data-slot="empty-state-icon"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <EmptyState
        icon={<Icon />}
        title={
          <>
            Add your first symbol <span aria-hidden="true">⭐</span>
          </>
        }
        description="Watchlists update live."
        action={<Button>Add symbol</Button>}
      />,
    );

    await expectNoAxeViolations(container);
  });
});
