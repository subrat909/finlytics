"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@finlytics/ui/components/button";
import { Kbd } from "@finlytics/ui/components/kbd";
import { Tooltip } from "@finlytics/ui/components/tooltip";

import { useUiStore } from "@/stores/ui.store";

import { SIDEBAR_ID } from "./sidebar";

/**
 * Collapses and expands the desktop sidebar (≥ 1024 px), from the navbar's left edge; `[` does the same. Below
 * 1024 px the sidebar is a sheet, and MobileNav's button takes this place.
 */
export function SidebarToggle({ collapsed }: { collapsed: boolean }) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <Tooltip
      side="bottom"
      content={
        <span className="flex items-center gap-2">
          {label}
          <Kbd size="sm" className="border-transparent bg-bg/20 text-bg">
            [
          </Kbd>
        </span>
      }
    >
      <Button
        variant="ghost"
        size="icon-sm"
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
    </Tooltip>
  );
}
