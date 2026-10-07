import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { borderUtilities, forbiddenSurfaceUtilities } from "../../test/classes";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../dropdown-menu";

function AccountMenu({ onDisconnect }: { onDisconnect: () => void }) {
  const [interval, setInterval] = useState("5m");
  const [showVolume, setShowVolume] = useState(true);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Account actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Upstox · AB1234</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            Set as default
            <DropdownMenuShortcut>D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>Renew session</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={showVolume} onCheckedChange={setShowVolume}>
          Show volume
        </DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value={interval} onValueChange={setInterval}>
          <DropdownMenuRadioItem value="1m">1 minute</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="5m">5 minutes</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>CSV</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDisconnect}>
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("opens a bordered menu with its items, labels and separators", async () => {
    const actor = userEvent.setup();
    render(<AccountMenu onDisconnect={vi.fn()} />);

    await actor.click(screen.getByRole("button", { name: "Account actions" }));
    const menu = await screen.findByRole("menu");

    expect(menu).toHaveAttribute("data-slot", "dropdown-menu-content");
    expect(borderUtilities(menu.className)).toEqual(["border", "border-border"]);
    expect(forbiddenSurfaceUtilities(menu.className)).toEqual([]);
    expect(within(menu).getByText("Upstox · AB1234")).toHaveAttribute("data-slot", "dropdown-menu-label");
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
    expect(within(menu).getByRole("menuitem", { name: "Renew session" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByText("D")).toHaveAttribute("aria-hidden", "true");
    await expectNoAxeViolations(menu);
  });

  it("checks and chooses items, and runs a destructive item's action", async () => {
    const actor = userEvent.setup();
    const onDisconnect = vi.fn();
    render(<AccountMenu onDisconnect={onDisconnect} />);

    await actor.click(screen.getByRole("button", { name: "Account actions" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Show volume" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "5 minutes" })).toHaveAttribute("aria-checked", "true");
    await actor.click(screen.getByRole("menuitemradio", { name: "1 minute" }));

    await actor.click(screen.getByRole("button", { name: "Account actions" }));
    expect(await screen.findByRole("menuitemradio", { name: "1 minute" })).toHaveAttribute("aria-checked", "true");
    const disconnect = screen.getByRole("menuitem", { name: "Disconnect" });
    expect(disconnect).toHaveAttribute("data-variant", "destructive");
    expect(disconnect).toHaveClass("text-loss");
    await actor.click(disconnect);

    expect(onDisconnect).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("opens a submenu with the right arrow key", async () => {
    const actor = userEvent.setup();
    render(<AccountMenu onDisconnect={vi.fn()} />);

    await actor.click(screen.getByRole("button", { name: "Account actions" }));
    const exportItem = await screen.findByRole("menuitem", { name: "Export" });
    exportItem.focus();
    await actor.keyboard("{ArrowRight}");

    expect(await screen.findByRole("menuitem", { name: "CSV" })).toBeInTheDocument();
  });
});
