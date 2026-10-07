"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { Tooltip } from "@finlytics/ui/components/tooltip";
import { cn } from "@finlytics/ui/lib/utils";

export interface TradingModeProps {
  /** The collapsed sidebar: only the icon shows, and a tooltip says the rest on hover or focus. */
  collapsed?: boolean | undefined;
  /** Called after it's chosen (the mobile sheet closes itself). */
  onNavigate?: (() => void) | undefined;
}

const fadeClasses = "transition-opacity duration-200 ease-out motion-reduce:transition-none";

/**
 * The trading mode, at the foot of the sidebar (a 32px row whose top edge lines up with the status bar's): "Paper
 * trading" until live trading exists (CLAUDE.md §7: automated trading defaults to paper). Links to the Trading section
 * of Settings, where live trading will be switched on.
 */
export function TradingMode({ collapsed = false, onNavigate }: TradingModeProps) {
  return (
    <Tooltip content="Paper trading: orders are simulated" enabled={collapsed} side="right" sideOffset={10}>
      <Link
        href="/settings#trading"
        data-slot="trading-mode"
        className={cn(
          "flex h-6 w-full items-center gap-3 rounded-sm px-2.75 whitespace-nowrap",
          "transition-[color,background-color] hover:bg-surface-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        )}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      >
        <FlaskConical aria-hidden="true" className="size-4.5 shrink-0 text-primary" />
        <span
          className={cn("min-w-0 flex-1 truncate text-xs font-semibold text-fg", fadeClasses, collapsed && "opacity-0")}
        >
          Paper trading<span className="sr-only">: orders are simulated</span>
        </span>
      </Link>
    </Tooltip>
  );
}
