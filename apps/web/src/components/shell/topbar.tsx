"use client";

import { Search } from "lucide-react";

import { Button } from "@finlytics/ui/components/button";

import { useUiStore } from "@/stores/ui.store";

import { MobileNav } from "./mobile-nav";
import { ThemeControl } from "./theme-control";
import { UserMenu } from "./user-menu";
import type { ShellUser } from "./user-menu";

/** The top bar: navigation sheet (< 1024 px), search (⌘K), theme, account. */
export function Topbar({ user }: { user: ShellUser }) {
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const openPalette = () => {
    setCommandOpen(true);
  };

  return (
    <header
      data-slot="topbar"
      className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 bg-bg/85 px-3 backdrop-blur-md sm:px-4 lg:px-6"
    >
      <MobileNav />
      <Button
        variant="secondary"
        onClick={openPalette}
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden w-full max-w-xs justify-start gap-2 font-normal text-fg-muted sm:inline-flex"
        data-slot="search-trigger"
      >
        <Search />
        <span className="flex-1 text-left">
          Search…<span className="sr-only"> sections and actions</span>
        </span>
        <kbd aria-hidden="true" className="rounded bg-surface-3 px-1.5 font-mono text-xs text-fg-muted">
          ⌘K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={openPalette}
        aria-label="Search sections and actions"
        className="sm:hidden"
      >
        <Search />
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <ThemeControl />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
