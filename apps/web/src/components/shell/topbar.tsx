"use client";

import { Search } from "lucide-react";

import { useUiStore } from "@/stores/ui.store";

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
 * The top bar: the sidebar toggle (the navigation sheet's button below 1024 px) on the left, search in the centre (it
 * opens the ⌘K palette, which will search instruments too), the account on the right. The same surface as the sidebar,
 * with a 1px bottom edge. Three grid columns, the outer two equal, so the search stays centred on the bar.
 */
export function Topbar({ user, sidebarCollapsed }: TopbarProps) {
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);

  return (
    <header
      data-slot="topbar"
      className="sticky top-0 z-20 grid h-14 shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-2 border-b border-border bg-surface-1 px-3 sm:gap-4 sm:px-4 lg:px-6"
    >
      <div className="flex items-center gap-1">
        <MobileNav />
        <SidebarToggle collapsed={sidebarCollapsed} />
      </div>
      {/* A button that looks like a field: it opens the palette, it doesn't take text itself. No border: it's a button. */}
      <button
        type="button"
        onClick={() => {
          setCommandOpen(true);
        }}
        aria-keyshortcuts="Meta+K Control+K"
        data-slot="search-trigger"
        className="flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-3 text-sm text-fg-muted transition-[color,background-color] hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          Search<span className="hidden sm:inline"> sections and actions</span>…
        </span>
        <kbd aria-hidden="true" className="hidden rounded bg-surface-3 px-1.5 font-mono text-xs sm:inline">
          ⌘K
        </kbd>
      </button>
      <div className="flex items-center justify-end gap-2">
        <UserMenu user={user} />
      </div>
    </header>
  );
}
