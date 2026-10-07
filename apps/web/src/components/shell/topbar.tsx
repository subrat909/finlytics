"use client";

import { Search } from "lucide-react";

import { Kbd, KbdGroup } from "@finlytics/ui/components/kbd";
import { cn } from "@finlytics/ui/lib/utils";

import { useUiStore } from "@/stores/ui.store";

import { IndexTicker } from "./index-ticker";
import { MobileNav } from "./mobile-nav";
import { SidebarToggle } from "./sidebar-toggle";
import { UserMenu } from "./user-menu";
import type { ShellUser } from "./user-menu";

export interface TopbarProps {
  user: ShellUser;
  /** The desktop sidebar's state, for its toggle. */
  sidebarCollapsed: boolean;
}

/**
 * The navbar (plan phase-1b "Shell"): 56px, `bg-surface-1` with a 1px bottom edge, and it never scrolls (the page
 * scrolls in `<main>` below it). Left to right: the sidebar toggle (the navigation sheet's button below 1024 px), the
 * search, centred in the space between (it opens ⌘K), the index ticker (from 1280 px) and the account menu.
 */
export function Topbar({ user, sidebarCollapsed }: TopbarProps) {
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);

  return (
    <header
      data-slot="topbar"
      className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-2 sm:gap-4 sm:px-3 lg:px-4"
    >
      <div className="flex shrink-0 items-center gap-1">
        <MobileNav />
        <SidebarToggle collapsed={sidebarCollapsed} />
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        {/* A button that looks like a field: it opens the palette, it doesn't take text itself. No border: it's a
            button. Named by its visible text. */}
        <button
          type="button"
          onClick={() => {
            setCommandOpen(true);
          }}
          aria-keyshortcuts="Meta+K Control+K"
          data-slot="search-trigger"
          className={cn(
            "flex h-9 w-full max-w-md min-w-0 cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-3 text-sm text-fg-muted",
            "transition-[color,background-color] hover:bg-surface-3 hover:text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          )}
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">
            Search<span className="hidden sm:inline"> sections and actions</span>…
          </span>
          <KbdGroup aria-hidden="true" className="hidden sm:inline-flex">
            <Kbd size="sm">⌘</Kbd>
            <Kbd size="sm">K</Kbd>
          </KbdGroup>
        </button>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-4">
        <IndexTicker className="hidden xl:flex" />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
