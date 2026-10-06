"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { Logo } from "@/components/brand/logo";
import { useUiStore } from "@/stores/ui.store";

import { SidebarNav } from "./sidebar-nav";
import { ShellTooltip } from "./tooltip";

export const SIDEBAR_ID = "app-sidebar";

export interface SidebarProps {
  collapsed: boolean;
}

/**
 * The desktop sidebar (≥ 1024 px): fixed, `w-64 ↔ w-16` with a width transition (frontend.md "Sidebar"). Collapsing
 * only changes classes: nothing is unmounted, here or in the page.
 */
export function Sidebar({ collapsed }: SidebarProps) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Sidebar"
      data-slot="sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col overflow-x-hidden bg-surface-1 lg:flex",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link
          href="/dashboard"
          aria-label="Finlytics, go to the dashboard"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <Logo compact={collapsed} />
        </Link>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        <SidebarNav collapsed={collapsed} idPrefix="sidebar" />
      </nav>
      <div className="shrink-0 px-3 py-3">
        <ShellTooltip
          content={
            <span className="flex items-center gap-2">
              {toggleLabel}
              <kbd className="rounded bg-bg/20 px-1 font-mono">[</kbd>
            </span>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
            aria-keyshortcuts="["
            data-slot="sidebar-toggle"
            className="text-fg-muted"
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </ShellTooltip>
      </div>
    </aside>
  );
}
