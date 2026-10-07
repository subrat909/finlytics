import type { Meta, StoryObj } from "@storybook/react-vite";

import { Separator } from "./separator";

/** A 1px rule in the `border` token. */
const meta = {
  title: "Components/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Between the sections of a panel, and between items in a status bar. */
export const HorizontalAndVertical: Story = {
  render: () => (
    <div className="w-80 rounded-md border border-border bg-surface-1 p-4 text-sm text-fg">
      <p className="font-medium">Funds</p>
      <p className="text-fg-muted">Available margin across your accounts.</p>
      <Separator className="my-3" />
      <div className="flex h-5 items-center gap-3 text-xs text-fg-muted">
        <span>NSE</span>
        <Separator orientation="vertical" />
        <span>BSE</span>
        <Separator orientation="vertical" />
        <span>MCX</span>
      </div>
    </div>
  ),
};
