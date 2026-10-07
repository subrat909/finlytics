import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { borderUtilities, forbiddenControlUtilities } from "../../test/classes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";
import type { TabsVariant } from "../tabs";

function OrderTabs({ variant }: { variant?: TabsVariant }) {
  return (
    <Tabs defaultValue="open">
      <TabsList aria-label="Orders" variant={variant}>
        <TabsTrigger value="open">Open</TabsTrigger>
        <TabsTrigger value="executed">Executed</TabsTrigger>
        <TabsTrigger value="gtt" disabled>
          GTT
        </TabsTrigger>
      </TabsList>
      <TabsContent value="open">2 open orders</TabsContent>
      <TabsContent value="executed">14 executed today</TabsContent>
      <TabsContent value="gtt">No GTT orders</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("is a named tab list whose selected tab shows its panel", () => {
    render(<OrderTabs />);

    expect(screen.getByRole("tablist", { name: "Orders" })).toHaveAttribute("data-slot", "tabs-list");
    expect(screen.getByRole("tab", { name: "Open" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("2 open orders");
  });

  it("moves with arrow keys, skipping disabled tabs, and switches the panel", async () => {
    const actor = userEvent.setup();
    render(<OrderTabs />);

    await actor.tab();
    expect(screen.getByRole("tab", { name: "Open" })).toHaveFocus();
    await actor.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Executed" })).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByRole("tabpanel")).toHaveTextContent("14 executed today");
    });
    await actor.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Open" })).toHaveFocus();
  });

  it("switches on click", async () => {
    const actor = userEvent.setup();
    render(<OrderTabs />);

    await actor.click(screen.getByRole("tab", { name: "Executed" }));

    expect(screen.getByRole("tab", { name: "Executed" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("14 executed today");
  });

  it("draws the line variant's indicator with ::after, never a border on the tab", () => {
    render(<OrderTabs />);

    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-variant", "line");
    expect(borderUtilities(list.className)).toEqual(["border-b", "border-border"]);
    for (const tab of screen.getAllByRole("tab")) {
      expect(forbiddenControlUtilities(tab.className)).toEqual([]);
      expect(tab).toHaveClass("data-[state=active]:after:bg-primary");
    }
  });

  it("fills the active segment primary in a bordered track for the segmented variant", () => {
    render(<OrderTabs variant="segmented" />);

    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-variant", "segmented");
    expect(borderUtilities(list.className)).toEqual(["border", "border-border"]);
    for (const tab of screen.getAllByRole("tab")) {
      expect(forbiddenControlUtilities(tab.className)).toEqual([]);
      expect(tab).toHaveClass("data-[state=active]:bg-primary", "data-[state=active]:text-primary-fg");
    }
  });

  it("has no axe violations in either variant", async () => {
    const { container, rerender } = render(<OrderTabs />);
    await expectNoAxeViolations(container);

    rerender(<OrderTabs variant="segmented" />);
    await expectNoAxeViolations(container);
  });
});
