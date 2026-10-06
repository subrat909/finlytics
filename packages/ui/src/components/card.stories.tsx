import { formatInr } from "@finlytics/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TrendingUp } from "lucide-react";

import { Button } from "./button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

const meta = {
  title: "Components/Card",
  component: Card,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Available margin</CardTitle>
        <CardDescription>Across your connected broker accounts.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="tabular text-2xl font-semibold">{formatInr("245310.5")}</p>
      </CardContent>
    </Card>
  ),
};

export const HeaderActionFooter: Story = {
  name: "Header + Action + Footer",
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Iron condor, NIFTY weekly</CardTitle>
        <CardDescription>Paper trading since 12 Sep</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm text-fg-muted">
        Four legs, max loss {formatInr("4800", { decimals: 0 })} per lot, exits at 15:15 IST.
      </CardContent>
      <CardFooter>
        <Button size="sm">Deploy</Button>
        <Button size="sm" variant="secondary">
          Backtest
        </Button>
      </CardFooter>
    </Card>
  ),
};

/** A dashboard stat tile: tabular numerals, and the ▲ glyph with the colour so colour isn't the only signal. */
export const StatTile: Story = {
  render: () => (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>Today&apos;s P&amp;L</CardDescription>
        <CardAction>
          <TrendingUp className="size-5 text-profit" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="tabular text-2xl font-semibold text-profit">
          <span aria-hidden="true">▲ </span>
          {formatInr("12450.75", { sign: "always" })}
          <span className="sr-only"> profit</span>
        </p>
        <p className="tabular text-sm text-fg-muted">{formatInr("1032940")} invested</p>
      </CardContent>
    </Card>
  ),
};

/** The title as an h2 (asChild), where the card heads a page section. */
export const TitleAsH2: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>Open positions</h2>
        </CardTitle>
        <CardDescription>3 intraday, 1 delivery</CardDescription>
      </CardHeader>
    </Card>
  ),
};
