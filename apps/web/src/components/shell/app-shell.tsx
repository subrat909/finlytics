"use client";

import { useEffect } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { useIsClient } from "@/hooks/use-is-client";
import { useUiStore, writeSidebarCookie } from "@/stores/ui.store";

import { CommandPalette } from "./command-palette";
import { ShellAnnouncer } from "./shell-announcer";
import { Sidebar } from "./sidebar";
import { TooltipProvider } from "./tooltip";
import { Topbar } from "./topbar";
import { useShellShortcuts } from "./use-shell-shortcuts";
import type { ShellUser } from "./user-menu";

export const MAIN_CONTENT_ID = "main-content";

export interface AppShellProps {
  user: ShellUser;
  /** The sidebar state the server rendered (the `finlytics-sidebar` cookie), used until the store is readable. */
  initialCollapsed: boolean;
  /**
   * A full-width notice between the top bar and the page (the broker NEEDS_RELOGIN banner). Rendered in its own slot,
   * so it can come and go without re-mounting the page. Nothing renders for null or undefined.
   */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The authenticated layout (docs/05 "Layout"): sidebar, top bar, an optional banner, the page, the ⌘K palette and the
 * shell's live region. The page subtree (`<main>`) is rendered unconditionally in one place, so collapsing the sidebar,
 * opening the sheet or the palette, or a banner appearing never re-mounts it; only classes change (frontend.md
 * "Sidebar"). The page is full width: no max-width container, the same padding everywhere, and it reflows as the
 * sidebar's margin transitions.
 */
export function AppShell({ user, initialCollapsed, banner, children }: AppShellProps) {
  const isClient = useIsClient();
  const storedCollapsed = useUiStore((state) => state.sidebarCollapsed);
  // The server and the hydration render use the cookie's value; after hydration, the persisted store decides.
  const collapsed = isClient ? storedCollapsed : initialCollapsed;

  useShellShortcuts();

  // Keep the SSR hint cookie in step with the persisted preference.
  useEffect(() => {
    writeSidebarCookie(useUiStore.getState().sidebarCollapsed);
    return useUiStore.subscribe((state, previous) => {
      if (state.sidebarCollapsed !== previous.sidebarCollapsed) writeSidebarCookie(state.sidebarCollapsed);
    });
  }, []);

  return (
    <TooltipProvider>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} />
      <div
        data-slot="app-content"
        className={cn(
          "flex min-h-dvh min-w-0 flex-col transition-[margin] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "lg:ml-16" : "lg:ml-64",
        )}
      >
        <Topbar user={user} sidebarCollapsed={collapsed} />
        {banner === null || banner === undefined ? null : <div data-slot="shell-banner">{banner}</div>}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="w-full min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
      <CommandPalette />
      <ShellAnnouncer />
    </TooltipProvider>
  );
}
