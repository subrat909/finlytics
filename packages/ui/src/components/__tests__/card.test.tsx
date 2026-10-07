import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { borderUtilities, forbiddenSurfaceUtilities } from "../../test/classes";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../card";

function FullCard() {
  return (
    <Card data-testid="card">
      <CardHeader>
        <CardTitle>Available margin</CardTitle>
        <CardDescription>Across your broker accounts</CardDescription>
        <CardAction>
          <button type="button">Refresh</button>
        </CardAction>
      </CardHeader>
      <CardContent>₹2,45,310.50</CardContent>
      <CardFooter>
        <button type="button">Add funds</button>
      </CardFooter>
    </Card>
  );
}

describe("Card", () => {
  it("renders the title as h3 by default and as the asChild element", () => {
    render(
      <>
        <CardTitle>Positions</CardTitle>
        <CardTitle asChild>
          <h2>Orders</h2>
        </CardTitle>
      </>,
    );

    expect(screen.getByRole("heading", { name: "Positions", level: 3 })).toHaveAttribute("data-slot", "card-title");
    const orders = screen.getByRole("heading", { name: "Orders", level: 2 });
    expect(orders).toHaveAttribute("data-slot", "card-title");
    expect(orders).toHaveClass("font-semibold");
  });

  it("marks every part with its data-slot", () => {
    render(<FullCard />);

    const slots = [...screen.getByTestId("card").querySelectorAll("[data-slot]")].map((part) =>
      part.getAttribute("data-slot"),
    );
    expect(slots).toEqual([
      "card-header",
      "card-title",
      "card-description",
      "card-action",
      "card-content",
      "card-footer",
    ]);
  });

  it("has a 1px border-token edge on the card only, and no shadow or ring anywhere", () => {
    render(<FullCard />);

    const card = screen.getByTestId("card");
    const parts = [...card.querySelectorAll("[data-slot]")];
    expect([card, ...parts].map((part) => part.className).flatMap(forbiddenSurfaceUtilities)).toEqual([]);
    expect(borderUtilities(card.className)).toEqual(["border", "border-border"]);
    expect(parts.flatMap((part) => borderUtilities(part.className))).toEqual([]);
    expect(card).toHaveClass("bg-surface-1", "rounded-sm");
  });

  it("has no axe violations", async () => {
    const { container } = render(<FullCard />);

    await expectNoAxeViolations(container);
  });
});
