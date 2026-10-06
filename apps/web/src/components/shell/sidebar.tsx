"use client";

import Link from "next/link";

import { cn } from "@finlytics/ui/lib/utils";

import { Logo } from "@/components/brand/logo";

import { SidebarNav } from "./sidebar-nav";

export const SIDEBAR_ID = "app-sidebar";

export interface SidebarProps {
  collapsed: boolean;
}

/**
 * The desktop sidebar (≥ 1024 px): fixed, `w-64 ↔ w-16` with a width transition (frontend.md "Sidebar"), the same
 * surface as the top bar with a 1px right edge. Its toggle lives in the top bar (SidebarToggle). Collapsing only
 * changes classes: nothing is unmounted, here or in the page.
 */
export function Sidebar({ collapsed }: SidebarProps) {
  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Sidebar"
      data-slot="sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col overflow-x-hidden border-r border-border bg-surface-1 lg:flex",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* The same height and bottom edge as the top bar, so the two read as one line. */}
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <Link
          href="/dashboard"
          aria-label="Finlytics, go to the dashboard"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <Logo compact={collapsed} />
        </Link>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-3">
        <SidebarNav collapsed={collapsed} idPrefix="sidebar" />
      </nav>
    </aside>
  );
}
