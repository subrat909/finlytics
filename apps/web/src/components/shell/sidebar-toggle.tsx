"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@finlytics/ui/components/button";

import { useUiStore } from "@/stores/ui.store";

import { SIDEBAR_ID } from "./sidebar";
import { ShellTooltip } from "./tooltip";

/**
 * Collapses and expands the desktop sidebar (≥ 1024 px), from the top bar's left edge; `[` does the same. Below
 * 1024 px the sidebar is a sheet, and MobileNav's button takes this place.
 */
export function SidebarToggle({ collapsed }: { collapsed: boolean }) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <ShellTooltip
      side="bottom"
      content={
        <span className="flex items-center gap-2">
          {label}
          <kbd className="rounded bg-bg/20 px-1 font-mono">[</kbd>
        </span>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls={SIDEBAR_ID}
        aria-keyshortcuts="["
        data-slot="sidebar-toggle"
        className="hidden text-fg-muted lg:inline-flex"
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
    </ShellTooltip>
  );
}
