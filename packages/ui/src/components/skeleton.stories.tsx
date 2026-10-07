import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "./card";
import { Skeleton } from "./skeleton";

/** Placeholders shaped like the content they stand for. The shimmer runs only when motion is allowed. */
const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = { args: { shape: "line" } };

export const Block: Story = { args: { shape: "block" } };

export const Circle: Story = { args: { shape: "circle" } };

/** A position row while it loads: avatar, two lines of text, a price. */
export const Composition: Story = {
  render: () => (
    <Card className="flex-row items-center gap-3">
      <Skeleton shape="circle" />
      <div className="flex-1 space-y-2">
        <Skeleton className="w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-5 w-16" />
    </Card>
  ),
};
