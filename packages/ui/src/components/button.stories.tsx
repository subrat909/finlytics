import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Plus, Settings } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";

import { findDesignViolations } from "../../.storybook/design-checks";
import { expectFocusOutline } from "../test/stories";

import { Button } from "./button";

const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: "Place order", onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: "secondary", children: "Cancel" } };

export const Ghost: Story = { args: { variant: "ghost", children: "View details" } };

/** Buy: profit fill with profit-fg text, never text-white (dark theme fills are light). */
export const ProfitBuy: Story = { name: "Profit (Buy)", args: { variant: "profit", children: "Buy ▲" } };

export const LossSell: Story = { name: "Loss (Sell)", args: { variant: "loss", children: "Sell ▼" } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="icon" aria-label="Add to watchlist">
        <Plus />
      </Button>
      <Button {...args} size="icon-sm" variant="secondary" aria-label="Settings">
        <Settings />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        Connect broker
        <ArrowRight />
      </>
    ),
  },
};

/** While a mutation is pending: a spinner, aria-busy, clicks ignored, focus kept. */
export const Loading: Story = {
  args: { loading: true, children: "Placing order" },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "Placing order" });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
    await expect(button).toHaveFocus();
  },
};

export const Disabled: Story = { args: { disabled: true, children: "Market closed" } };

/** asChild: a link with button styling (navigation stays a link). */
/**
 * A link styled as a button (asChild). The design check covers it like a native button: the play function gives it a
 * border for a moment and expects the check to report it.
 */
export const AsChildLink: Story = {
  render: () => (
    <Button asChild>
      <a href="#brokers">Add a broker</a>
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: "Add a broker" });
    await expect(link).toHaveAttribute("data-slot", "button");
    await expect(findDesignViolations(canvasElement)).toEqual([]);

    link.style.setProperty("border-width", "1px");
    try {
      await expect(findDesignViolations(canvasElement)).toEqual([
        expect.stringMatching(/^<a data-slot="button"> "Add a broker" has a border/),
      ]);
    } finally {
      link.style.removeProperty("border-width");
    }
  },
};

export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expectFocusOutline(within(canvasElement).getByRole("button", { name: "Place order" }));
  },
};
