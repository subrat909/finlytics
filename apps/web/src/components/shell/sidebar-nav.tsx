"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { NAV_GROUPS, isActiveItem } from "./nav-items";
import type { NavItem } from "./nav-items";
import { ShellTooltip } from "./tooltip";

export interface SidebarNavProps {
  /** Labels fade out and tooltips take over (the collapsed desktop sidebar). */
  collapsed?: boolean | undefined;
  /** Called after a link is chosen (the mobile sheet closes itself). */
  onNavigate?: (() => void) | undefined;
  /** Prefix for the group heading ids, unique per instance (desktop sidebar, mobile sheet). */
  idPrefix: string;
}

const linkClasses = cn(
  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium whitespace-nowrap text-fg-muted",
  "transition-[color,background-color] hover:bg-surface-2 hover:text-fg",
  "aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
);

const labelClasses = "truncate transition-opacity duration-200 ease-out motion-reduce:transition-none";

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate: (() => void) | undefined;
}

const NavLink = memo(function NavLink({ item, active, collapsed, onNavigate }: NavLinkProps) {
  const { Icon } = item;
  return (
    <li>
      <ShellTooltip content={item.label} enabled={collapsed}>
        <Link
          href={`/${item.slug}` as Route}
          aria-current={active ? "page" : undefined}
          className={linkClasses}
          data-slot="sidebar-link"
          {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        >
          <Icon aria-hidden="true" className={cn("size-5 shrink-0", item.accent)} />
          {/* Faded, never removed: the link keeps its accessible name and the row its height while collapsed. */}
          <span className={cn(labelClasses, collapsed && "opacity-0")}>{item.label}</span>
        </Link>
      </ShellTooltip>
    </li>
  );
});

/** The section links, grouped. Shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ collapsed = false, onNavigate, idPrefix }: SidebarNavProps) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => {
        const headingId = `${idPrefix}-${group.label.toLowerCase()}`;
        return (
          <section key={group.label} aria-labelledby={headingId} className="flex flex-col gap-1">
            <h2
              id={headingId}
              className={cn(
                "px-3 text-xs font-medium tracking-wide whitespace-nowrap text-fg-muted uppercase",
                labelClasses,
                collapsed && "opacity-0",
              )}
            >
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.slug}
                  item={item}
                  active={isActiveItem(item, pathname)}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
