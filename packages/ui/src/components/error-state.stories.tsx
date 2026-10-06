import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { expectNoHorizontalScroll } from "../test/stories";

import { Card } from "./card";
import { ErrorState } from "./error-state";

const meta = {
  title: "Components/ErrorState",
  component: ErrorState,
  tags: ["responsive"],
  play: async () => {
    await expectNoHorizontalScroll();
  },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRetry: Story = { args: { onRetry: fn() } };

/** A retry that never settles: the button stays busy (spinner, aria-busy) and keeps focus. */
export const Retrying: Story = {
  args: {
    onRetry: () =>
      new Promise<void>(() => {
        // Never settles.
      }),
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Try again" });
    await userEvent.click(button);
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveFocus();
    await expectNoHorizontalScroll();
  },
};

/** The request id from ProblemDetails (or a Next.js error digest), for support. */
export const WithReference: Story = {
  args: {
    onRetry: fn(),
    title: "Positions didn't load",
    description: "Your broker didn't answer in time. Your orders are safe; only this view is affected.",
    reference: "7f3c9a2e-5b1d-4c8e-9f0a-2d6b8e4c1a73",
  },
};

export const NoRetry: Story = {
  args: {
    title: "This page needs a connected broker",
    description: "Reconnect Upstox from Brokers to see live positions.",
  },
};

export const Inline: Story = {
  args: { onRetry: fn(), size: "inline", headingLevel: 3, title: "Option chain unavailable" },
  render: (args) => (
    <Card className="max-w-md">
      <h2 className="text-base font-semibold">NIFTY option chain</h2>
      <ErrorState {...args} />
    </Card>
  ),
};
