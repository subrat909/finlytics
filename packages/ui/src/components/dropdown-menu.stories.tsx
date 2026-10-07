import type { Meta, StoryObj } from "@storybook/react-vite";
import { EllipsisVertical, LogOut, RefreshCw, Settings, Star } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function AccountActions({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [interval, setInterval] = useState("5m");
  const [showVolume, setShowVolume] = useState(true);
  return (
    // Not modal in the open story: a modal menu hides the rest of the page from assistive technology.
    <DropdownMenu defaultOpen={defaultOpen} modal={!defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account actions">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Upstox · AB1234</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <Star />
            Set as default
            <DropdownMenuShortcut>D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <RefreshCw />
            Re-login
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Settings />
            Rename
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={showVolume} onCheckedChange={setShowVolume}>
          Show volume
        </DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value={interval} onValueChange={setInterval}>
          <DropdownMenuLabel inset>Interval</DropdownMenuLabel>
          <DropdownMenuRadioItem value="1m">1 minute</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="5m">5 minutes</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <LogOut />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * An actions menu: a surface-1 panel with a 1px edge and no shadow; the highlighted row is tinted surface-2. Full
 * screen, so the screenshot includes the menu (it renders in a portal).
 */
const meta = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = { render: () => <AccountActions defaultOpen /> };

/** Enter opens it on the first item; arrow keys move; Escape closes and returns focus to the trigger. */
export const KeyboardNavigation: Story = {
  render: () => <AccountActions />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Account actions" });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    const menu = await within(document.body).findByRole("menu");
    await waitFor(async () => {
      await expect(within(menu).getByRole("menuitem", { name: /Set as default/ })).toHaveFocus();
    });
    await userEvent.keyboard("{ArrowDown}");
    await expect(within(menu).getByRole("menuitem", { name: "Re-login" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await waitFor(async () => {
      await expect(within(document.body).queryByRole("menu")).toBeNull();
    });
    await expect(trigger).toHaveFocus();
  },
};
