"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";

import { Badge } from "@finlytics/ui/components/badge";
import { Tooltip } from "@finlytics/ui/components/tooltip";
import { cn } from "@finlytics/ui/lib/utils";

import { NAV_GROUPS, isActiveItem, isComingSoon } from "./nav-items";
import type { NavItem } from "./nav-items";

export interface SidebarNavProps {
  /** Labels fade out and tooltips take over (the collapsed desktop sidebar). */
  collapsed?: boolean | undefined;
  /** Called after a link is chosen (the mobile sheet closes itself). */
  onNavigate?: (() => void) | undefined;
  /** Prefix for the group heading ids, unique per instance (desktop sidebar, mobile sheet). */
  idPrefix: string;
}

/**
 * A row: icon, label, and "Soon" for sections still to be built. The current page gets surface-2 and a 2px primary
 * bar at the sidebar's edge (`::before`). A link, not a button: no border, no shadow; the focus outline is the ring.
 */
const linkClasses = cn(
  "relative flex h-8 items-center gap-3 rounded-sm px-2.75 text-[0.8125rem] font-medium whitespace-nowrap text-fg-muted",
  "transition-[color,background-color] hover:bg-surface-2 hover:text-fg",
  "aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg",
  "before:absolute before:inset-y-1.5 before:-left-3 before:w-0.5 before:rounded-r-full before:bg-transparent",
  "aria-[current=page]:before:bg-primary",
  "forced-colors:aria-[current=page]:before:forced-color-adjust-none forced-colors:aria-[current=page]:before:bg-[Highlight]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
);

/** Faded, never removed: the link keeps its accessible name and the row its height while collapsed. */
const fadeClasses = "transition-opacity duration-200 ease-out motion-reduce:transition-none";

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate: (() => void) | undefined;
}

const NavLink = memo(function NavLink({ item, active, collapsed, onNavigate }: NavLinkProps) {
  const { Icon } = item;
  const soon = isComingSoon(item);
  return (
    <li>
      <Tooltip content={soon ? `${item.label} · Soon` : item.label} enabled={collapsed} side="right" sideOffset={10}>
        <Link
          href={`/${item.slug}` as Route}
          aria-current={active ? "page" : undefined}
          className={linkClasses}
          data-slot="sidebar-link"
          data-soon={soon ? "true" : undefined}
          {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        >
          <Icon aria-hidden="true" className={cn("size-4.5 shrink-0", item.accent)} />
          <span className={cn("min-w-0 flex-1 truncate", fadeClasses, collapsed && "opacity-0")}>{item.label}</span>
          {soon ? (
            <>
              <Badge size="sm" aria-hidden="true" className={cn(fadeClasses, collapsed && "opacity-0")}>
                Soon
              </Badge>
              <span className="sr-only">, coming soon</span>
            </>
          ) : null}
        </Link>
      </Tooltip>
    </li>
  );
});

/**
 * The section links, grouped (Overview, Markets, Trading, Algo, Account). Expanded, each group has a small uppercase
 * heading; collapsed, the heading fades and a 1px rule takes its place, so the groups still read as groups and no row
 * moves. Shared by the desktop sidebar and the mobile sheet.
 */
export function SidebarNav({ collapsed = false, onNavigate, idPrefix }: SidebarNavProps) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-3">
      {NAV_GROUPS.map((group) => {
        const headingId = `${idPrefix}-${group.label.toLowerCase()}`;
        return (
          <div key={group.label} role="group" aria-labelledby={headingId} className="flex flex-col gap-0.5">
            <div className="relative flex h-6 items-center px-2.75">
              <h2
                id={headingId}
                className={cn(
                  "truncate text-2xs font-semibold tracking-wider whitespace-nowrap text-fg-muted uppercase",
                  fadeClasses,
                  collapsed && "opacity-0",
                )}
              >
                {group.label}
              </h2>
              <span
                aria-hidden="true"
                data-slot="sidebar-group-rule"
                className={cn(
                  "absolute inset-x-1.5 top-1/2 h-px bg-border opacity-0",
                  fadeClasses,
                  collapsed && "opacity-100",
                )}
              />
            </div>
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
          </div>
        );
      })}
    </div>
  );
}
