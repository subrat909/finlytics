import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info } from "lucide-react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Badge } from "./badge";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * A floating panel anchored to its trigger: surface-1 with a 1px edge, no shadow. Full screen, so the screenshot
 * includes the panel (it renders in a portal).
 */
const meta: Meta<typeof Popover> = {
  title: "Components/Popover",
  component: Popover,
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <div className="p-8">
      <Popover {...args}>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm">
            <Info />
            Feed details
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-labelledby="feed-title" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p id="feed-title" className="font-medium">
              Market feed
            </p>
            <Badge tone="warning" size="sm" dot>
              Simulated
            </Badge>
          </div>
          <p className="text-fg-muted">
            No broker feed is connected, so prices are simulated. Connect Upstox or Dhan for live prices.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Open: Story = { args: { defaultOpen: true } };

/** Opens from its trigger; Escape closes it and returns focus. */
export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Feed details" });
    await userEvent.click(trigger);
    // In the document and open (its fade-in may still be running, so not "visible" yet).
    await expect(await within(document.body).findByRole("dialog", { name: "Market feed" })).toHaveAttribute(
      "data-state",
      "open",
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(async () => {
      await expect(within(document.body).queryByRole("dialog")).toBeNull();
    });
    await expect(trigger).toHaveFocus();
  },
};
