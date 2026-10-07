import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListOrdered, Wallet } from "lucide-react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { expectFocusOutline, expectNoHorizontalScroll } from "../test/stories";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/** Views of one thing, one at a time: underlined (line) or pills in a track (segmented). */
const meta: Meta<typeof Tabs> = {
  title: "Components/Tabs",
  component: Tabs,
  tags: ["responsive"],
  args: { defaultValue: "positions" },
  render: (args) => (
    <Tabs {...args} className="max-w-xl">
      <TabsList aria-label="Portfolio">
        <TabsTrigger value="positions">
          <ListOrdered aria-hidden="true" />
          Positions
        </TabsTrigger>
        <TabsTrigger value="holdings">
          <Wallet aria-hidden="true" />
          Holdings
        </TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
        <TabsTrigger value="gtt" disabled>
          GTT
        </TabsTrigger>
      </TabsList>
      <TabsContent value="positions" className="text-sm text-fg-muted">
        3 open positions, day P&amp;L +₹4,210.50.
      </TabsContent>
      <TabsContent value="holdings" className="text-sm text-fg-muted">
        12 holdings worth ₹8,45,120.00.
      </TabsContent>
      <TabsContent value="orders" className="text-sm text-fg-muted">
        No orders today.
      </TabsContent>
      <TabsContent value="gtt" className="text-sm text-fg-muted">
        GTT orders arrive later.
      </TabsContent>
    </Tabs>
  ),
  play: async () => {
    await expectNoHorizontalScroll();
  },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Line: Story = {};

export const Segmented: Story = {
  render: () => (
    <Tabs defaultValue="1d" className="max-w-xl">
      <TabsList variant="segmented" aria-label="Range">
        <TabsTrigger value="1d">1D</TabsTrigger>
        <TabsTrigger value="1w">1W</TabsTrigger>
        <TabsTrigger value="1m">1M</TabsTrigger>
        <TabsTrigger value="1y">1Y</TabsTrigger>
      </TabsList>
      <TabsContent value="1d" className="text-sm text-fg-muted">
        Today&apos;s session.
      </TabsContent>
      <TabsContent value="1w" className="text-sm text-fg-muted">
        The last five sessions.
      </TabsContent>
      <TabsContent value="1m" className="text-sm text-fg-muted">
        The last month.
      </TabsContent>
      <TabsContent value="1y" className="text-sm text-fg-muted">
        The last year.
      </TabsContent>
    </Tabs>
  ),
};

/** Tab focuses the selected tab with the ring outline; arrow keys move and activate, skipping the disabled tab. */
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expectFocusOutline(canvas.getByRole("tab", { name: "Positions" }));

    await userEvent.keyboard("{ArrowRight}");
    await waitFor(async () => {
      await expect(canvas.getByRole("tab", { name: "Holdings" })).toHaveAttribute("aria-selected", "true");
    });
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("12 holdings");
    await expectNoHorizontalScroll();
  },
};
