import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { borderUtilities, forbiddenSurfaceUtilities } from "../../test/classes";
import { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger } from "../popover";

function FeedPopover() {
  return (
    <Popover>
      <PopoverAnchor asChild>
        <span>Feed</span>
      </PopoverAnchor>
      <PopoverTrigger>Why simulated?</PopoverTrigger>
      <PopoverContent aria-label="Feed details">
        <p>No broker feed is connected, so prices are simulated.</p>
        <PopoverClose>Close</PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  it("opens a labelled bordered panel from its trigger and closes with Escape, returning focus", async () => {
    const actor = userEvent.setup();
    render(<FeedPopover />);
    const trigger = screen.getByRole("button", { name: "Why simulated?" });
    expect(trigger).toHaveAttribute("data-slot", "popover-trigger");

    await actor.click(trigger);
    const panel = await screen.findByRole("dialog", { name: "Feed details" });
    expect(panel).toHaveAttribute("data-slot", "popover-content");
    expect(borderUtilities(panel.className)).toEqual(["border", "border-border"]);
    expect(forbiddenSurfaceUtilities(panel.className)).toEqual([]);
    expect(panel).toHaveClass("bg-surface-1", "rounded-md");
    await expectNoAxeViolations(panel);

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("closes from a close button inside", async () => {
    const actor = userEvent.setup();
    render(<FeedPopover />);

    await actor.click(screen.getByRole("button", { name: "Why simulated?" }));
    await actor.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
