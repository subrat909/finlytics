import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search } from "lucide-react";

import { Kbd, KbdGroup } from "./kbd";

/** Keyboard keys: mono keycaps on surface-2 with a 1px edge. */
const meta = {
  title: "Components/Kbd",
  component: Kbd,
  args: { children: "K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Combinations in a group, both sizes, inline in text and inside a field-shaped search button. */
export const Shortcuts: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-sm text-fg">
      <p className="flex items-center gap-2">
        Command palette
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
        or
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </p>
      <p className="flex items-center gap-2">
        Toggle the sidebar <Kbd size="sm">[</Kbd>
      </p>
      <div className="flex h-9 w-72 items-center gap-2 rounded-sm bg-surface-2 px-3 text-fg-muted">
        <Search aria-hidden="true" className="size-4" />
        <span className="flex-1">Search…</span>
        <KbdGroup aria-hidden="true">
          <Kbd size="sm">⌘</Kbd>
          <Kbd size="sm">K</Kbd>
        </KbdGroup>
      </div>
    </div>
  ),
};
