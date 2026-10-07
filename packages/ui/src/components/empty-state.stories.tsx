import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListPlus, Plug, Search } from "lucide-react";

import { expectNoHorizontalScroll } from "../test/stories";

import { Button } from "./button";
import { Card } from "./card";
import { EmptyState } from "./empty-state";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  tags: ["responsive"],
  args: {
    icon: <Plug className="text-highlight" />,
    title: (
      <>
        Connect a broker to see your portfolio <span aria-hidden="true">🔌</span>
      </>
    ),
    description: "Link Upstox or Dhan once. Positions, holdings and P&L appear here in real time.",
    action: <Button>Connect a broker</Button>,
  },
  play: async () => {
    await expectNoHorizontalScroll();
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAction: Story = {};

export const WithoutAction: Story = {
  args: {
    icon: <Search className="text-info" />,
    title: "No instruments match “NIFTY 24500 PE”",
    description: "Check the strike and expiry, or search by the underlying.",
    action: undefined,
  },
};

/** Inside a card: smaller padding, and an h3 under the card's own heading. */
export const Inline: Story = {
  args: {
    size: "inline",
    headingLevel: 3,
    icon: <ListPlus className="text-highlight" />,
    title: "Add your first symbol",
    description: "Watchlists update live while the market is open.",
    action: (
      <Button variant="secondary" size="sm">
        Add symbol
      </Button>
    ),
  },
  render: (args) => (
    <Card className="max-w-md">
      <h2 className="text-base font-semibold">Watchlist</h2>
      <EmptyState {...args} />
    </Card>
  ),
};

export const LongText: Story = {
  args: {
    title: "No strategies are deployed on this broker account, so automated orders are paused for it",
    description:
      "Deploy a strategy in paper mode first. Live auto-trading needs two-factor authentication, explicit risk limits " +
      "(maximum loss per day, maximum positions, maximum order value) and a broker-registered algo id, as SEBI's " +
      "framework for retail algorithmic trading requires.",
  },
};
