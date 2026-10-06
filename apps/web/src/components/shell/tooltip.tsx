"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useState } from "react";
import type * as React from "react";

/** Shared delay for every shell tooltip; mounted once by AppShell. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export interface ShellTooltipProps {
  /** The tooltip text. */
  content: React.ReactNode;
  /** When false the tooltip never opens, but the trigger stays mounted (no remount when the sidebar toggles). */
  enabled?: boolean | undefined;
  side?: "top" | "right" | "bottom" | "left" | undefined;
  /** A single focusable element (a link or a button). */
  children: React.ReactElement;
}

/**
 * A text tooltip (Radix): opens on hover and keyboard focus, closes on Escape. Inverted surface (`bg-fg text-bg`), no
 * shadow or border. App-local until it moves to packages/ui (plan W9).
 */
export function ShellTooltip({ content, enabled = true, side = "right", children }: ShellTooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipPrimitive.Root open={enabled && open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-slot="tooltip"
          side={side}
          sideOffset={8}
          className="z-50 rounded-lg bg-fg px-2.5 py-1.5 text-xs font-medium text-bg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
