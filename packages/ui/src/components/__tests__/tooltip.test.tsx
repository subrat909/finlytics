import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from "../tooltip";

/** Long enough for the provider's 250 ms open delay, and then some. */
const PAST_DELAY_MS = 400;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A collapsible-sidebar stand-in: one link whose tooltip is on only while "collapsed". */
function Harness({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  return (
    <TooltipProvider>
      <Tooltip content="Charts" enabled={enabled} side="right">
        <a href="/charts">Charts link</a>
      </Tooltip>
      <button
        type="button"
        onClick={() => {
          setEnabled((value) => !value);
        }}
      >
        Toggle
      </button>
    </TooltipProvider>
  );
}

describe("Tooltip", () => {
  it("opens on hover after the delay, describes its trigger, and closes on Escape", async () => {
    const actor = userEvent.setup();
    render(<Harness initiallyEnabled />);

    await actor.hover(screen.getByRole("link", { name: "Charts link" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Charts");
    expect(screen.getByRole("link", { name: "Charts link" })).toHaveAccessibleDescription("Charts");

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("opens on keyboard focus, not on a click", async () => {
    const actor = userEvent.setup();
    render(<Harness initiallyEnabled />);

    await actor.tab();
    expect(screen.getByRole("link", { name: "Charts link" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Charts");

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("never opens while disabled, and a hover while disabled doesn't show it once enabled (regression)", async () => {
    const actor = userEvent.setup();
    render(<Harness initiallyEnabled={false} />);
    const link = screen.getByRole("link", { name: "Charts link" });

    // Hovered while disabled (the expanded sidebar): Radix reports it, the tooltip stays closed.
    await actor.hover(link);
    await act(() => pause(PAST_DELAY_MS));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await actor.unhover(link);

    // Enabled (the sidebar collapses): nothing pops up without a fresh hover.
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await act(() => pause(PAST_DELAY_MS));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // A fresh hover opens it.
    await actor.hover(link);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Charts");
  });

  it("closes, and forgets being open, when disabled while open", async () => {
    const actor = userEvent.setup();
    render(<Harness initiallyEnabled />);

    await actor.hover(screen.getByRole("link", { name: "Charts link" }));
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    // Enabled again with no new hover: still closed.
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await act(() => pause(PAST_DELAY_MS));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps the same trigger element when toggled (no remount)", () => {
    render(<Harness initiallyEnabled={false} />);
    const link = screen.getByRole("link", { name: "Charts link" });

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));

    expect(screen.getByRole("link", { name: "Charts link" })).toBe(link);
  });

  it("renders the compound parts, an inverted bubble with no border or shadow, without axe violations", async () => {
    render(
      <TooltipProvider>
        <TooltipRoot defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Kill switch</button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Stops every automated order</TooltipContent>
        </TooltipRoot>
      </TooltipProvider>,
    );

    const bubble = document.querySelector('[data-slot="tooltip-content"]');
    expect(bubble).toHaveClass("bg-fg", "text-bg", "rounded-sm");
    expect(bubble?.className).not.toMatch(/(^|\s)(border|shadow|ring)(-|\s|$)/);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Stops every automated order");
    await expectNoAxeViolations(document.body);
  });
});
