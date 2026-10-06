import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { forbiddenControlUtilities } from "../../test/classes";
import { Button, buttonVariants } from "../button";

const VARIANTS = ["primary", "secondary", "ghost", "profit", "loss"] as const;
const SIZES = ["sm", "md", "lg", "icon", "icon-sm"] as const;

describe("Button", () => {
  it("renders a native button with type=button by default", () => {
    render(<Button>Place order</Button>);

    const button = screen.getByRole("button", { name: "Place order" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-slot", "button");
  });

  it("keeps an explicit type, so a submit button submits", () => {
    render(<Button type="submit">Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "submit");
  });

  it("renders its child with button styling when asChild is set", () => {
    render(
      <Button asChild variant="secondary">
        <a href="#brokers">Add a broker</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Add a broker" });
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("type");
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).toHaveClass("bg-surface-2", "rounded-xl");
  });

  it("uses no border, shadow or ring utilities in any variant or size", () => {
    const classLists = VARIANTS.flatMap((variant) => SIZES.map((size) => buttonVariants({ variant, size })));

    expect(classLists.flatMap(forbiddenControlUtilities)).toEqual([]);
  });

  it("merges a caller className last", () => {
    render(<Button className="h-14 bg-loss">Exit all</Button>);

    const button = screen.getByRole("button", { name: "Exit all" });
    expect(button).toHaveClass("h-14", "bg-loss");
    expect(button).not.toHaveClass("h-10", "bg-primary");
  });

  it("passes ref to the button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Place order</Button>);

    expect(ref.current).toBe(screen.getByRole("button", { name: "Place order" }));
  });

  it("calls onClick when pressed", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Place order</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Place order" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps focus, blocks clicks and sets aria-busy while loading", async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick}>
          Placing order
        </Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Placing order" });

    await userEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector('[data-slot="button-spinner"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("has no axe violations in any variant", async () => {
    const { container } = render(
      <div>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        <Button size="icon" aria-label="Add to watchlist">
          <svg aria-hidden="true" />
        </Button>
        <Button loading>Saving</Button>
        <Button disabled>Market closed</Button>
      </div>,
    );

    await expectNoAxeViolations(container);
  });
});
