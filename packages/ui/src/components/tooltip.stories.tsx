import type { Meta, StoryObj } from "@storybook/react-vite";
import { CandlestickChart, LayoutDashboard, PanelLeftClose } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "./button";
import { Kbd } from "./kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from "./tooltip";

/**
 * Text tooltips: the inverted surface, no border and no shadow. They open on hover and keyboard focus only. Full
 * screen, so the screenshot includes the bubble (it renders in a portal).
 */
const meta = {
  title: "Components/Tooltip",
  component: Tooltip,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="p-16">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  args: {
    content: "Dashboard",
    children: (
      <Button variant="ghost" size="icon" aria-label="Dashboard">
        <LayoutDashboard />
      </Button>
    ),
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open, below its trigger, with a keyboard hint. */
export const Open: Story = {
  render: () => (
    <TooltipRoot defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Collapse sidebar">
          <PanelLeftClose />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          Collapse sidebar
          <Kbd size="sm" className="border-transparent bg-bg/20 text-bg">
            [
          </Kbd>
        </span>
      </TooltipContent>
    </TooltipRoot>
  ),
};

/** Keyboard focus opens it (a click wouldn't). */
export const KeyboardFocus: Story = {
  args: { side: "right" },
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button", { name: "Dashboard" })).toHaveFocus();
    await waitFor(async () => {
      await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Dashboard");
    });
  },
};

function CollapsibleLink() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <Tooltip content="Charts" enabled={collapsed} side="right">
        <a
          href="#charts"
          className="inline-flex h-9 items-center gap-2 rounded-sm px-3 text-sm text-fg hover:bg-surface-2"
        >
          <CandlestickChart aria-hidden="true" className="size-4 text-highlight" />
          <span className={collapsed ? "sr-only" : undefined}>Charts</span>
        </a>
      </Tooltip>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setCollapsed((value) => !value);
        }}
      >
        {collapsed ? "Expand" : "Collapse"}
      </Button>
    </div>
  );
}

/**
 * The sidebar case: disabled while its label shows. Hovering then collapsing shows nothing until the next hover
 * (the stale-open regression).
 */
export const EnabledOnlyWhenCollapsed: Story = {
  render: () => <CollapsibleLink />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByRole("link", { name: "Charts" }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(within(document.body).queryByRole("tooltip")).toBeNull();

    await userEvent.unhover(canvas.getByRole("link", { name: "Charts" }));
    await userEvent.click(canvas.getByRole("button", { name: "Collapse" }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(within(document.body).queryByRole("tooltip")).toBeNull();
  },
};
