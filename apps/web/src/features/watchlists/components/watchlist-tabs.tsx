"use client";

import { EllipsisVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, Tabs } from "radix-ui";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import type { Watchlist } from "../schemas";

const tabClasses = cn(
  "inline-flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-medium text-fg-muted tabular",
  "transition-[color,background-color] hover:bg-surface-2 hover:text-fg data-[state=active]:bg-surface-2 data-[state=active]:text-fg",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
);

const menuItemClasses = cn(
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-fg outline-none select-none",
  "data-[highlighted]:bg-surface-2 data-[disabled]:cursor-default data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-muted",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
);

export interface WatchlistMenuProps {
  active: Watchlist | undefined;
  onCreate: () => void;
  onRename: (watchlist: Watchlist) => void;
  onDelete: (watchlist: Watchlist) => void;
}

/** New, rename and delete for the open list (a Radix menu: arrow keys, typeahead, Escape returns to the trigger). */
export function WatchlistMenu({ active, onCreate, onRename, onDelete }: WatchlistMenuProps) {
  return (
    // Not modal: a dialog opened from an item must not inherit the menu's pointer-events lock.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Watchlist actions" className="size-7">
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          data-slot="watchlist-menu"
          className="z-40 min-w-48 rounded-sm border border-border bg-surface-1 p-1 text-fg motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0"
        >
          <DropdownMenu.Item className={menuItemClasses} onSelect={onCreate}>
            <Plus aria-hidden="true" />
            New watchlist
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menuItemClasses}
            disabled={active === undefined}
            onSelect={() => {
              if (active) onRename(active);
            }}
          >
            <Pencil aria-hidden="true" />
            <span className="truncate">{active ? `Rename “${active.name}”` : "Rename"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={cn(menuItemClasses, "text-loss [&_svg]:text-loss")}
            disabled={active === undefined}
            onSelect={() => {
              if (active) onDelete(active);
            }}
          >
            <Trash2 aria-hidden="true" />
            <span className="truncate">{active ? `Delete “${active.name}”` : "Delete"}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface WatchlistTabsProps {
  lists: readonly Watchlist[];
  activeId: string;
  onCreate: () => void;
}

/**
 * Numbered watchlist tabs (Kite-style 1…N): every tab shows its number, the open one its name too; the name and the
 * count are always the accessible name. Radix Tabs: arrow keys move between lists. Render inside `Tabs.Root`.
 */
export function WatchlistTabs({ lists, activeId, onCreate }: WatchlistTabsProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <Tabs.List
        aria-label="Watchlists"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none]"
      >
        {lists.map((list, index) => {
          const open = list.id === activeId;
          return (
            <Tabs.Trigger
              key={list.id}
              value={list.id}
              data-slot="watchlist-tab"
              title={open ? undefined : `${list.name} (${String(list.items.length)})`}
              className={tabClasses}
            >
              <span aria-hidden="true">{index + 1}</span>
              <span className={open ? "max-w-32 truncate" : "sr-only"}>{list.name}</span>
              <span className="sr-only">{`, ${String(list.items.length)} instruments`}</span>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New watchlist"
        title="New watchlist"
        className="size-7"
        onClick={onCreate}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
