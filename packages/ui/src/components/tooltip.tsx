"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useState } from "react";
import type * as React from "react";

import { cn } from "../lib/utils";

export type TooltipProviderProps = React.ComponentProps<typeof TooltipPrimitive.Provider>;

/**
 * The shared open delay for every tooltip below it (250 ms, then 150 ms between neighbours). Mount it once, near the
 * root: the app shell does.
 */
export function TooltipProvider({ delayDuration = 250, skipDelayDuration = 150, ...props }: TooltipProviderProps) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />;
}

export type TooltipRootProps = React.ComponentProps<typeof TooltipPrimitive.Root>;
export type TooltipTriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger>;
export type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content>;

/** The compound parts, for a tooltip that needs more than {@link Tooltip} offers (an always-open demo, say). */
export function TooltipRoot(props: TooltipRootProps) {
  return <TooltipPrimitive.Root {...props} />;
}

export function TooltipTrigger(props: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger {...props} />;
}

/**
 * The bubble: the inverted surface (`bg-fg text-bg`, so it reads on any panel), no border and no shadow, in a portal.
 * Radix also renders the text once more, visually hidden, as the `role="tooltip"` element the trigger points at.
 */
export function TooltipContent({ className, sideOffset = 6, children, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-md bg-fg px-2 py-1 text-xs font-medium text-balance text-bg",
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
          "origin-(--radix-tooltip-content-transform-origin)",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface TooltipProps {
  /** The tooltip text (or a short phrase with a Kbd). */
  content: React.ReactNode;
  /**
   * When false the tooltip never opens, but the trigger stays mounted: toggling it (a sidebar collapsing) re-mounts
   * nothing. Turning it on never shows a tooltip by itself: it opens on the next hover or keyboard focus.
   */
  enabled?: boolean | undefined;
  side?: "top" | "right" | "bottom" | "left" | undefined;
  align?: "start" | "center" | "end" | undefined;
  sideOffset?: number | undefined;
  /** Classes for the bubble. */
  className?: string | undefined;
  /** A single focusable element (a link or a button) that forwards its props and ref. */
  children: React.ReactElement;
}

/**
 * A text tooltip (Radix): opens on hover (after the provider's delay) and on keyboard focus, never on click or touch,
 * and closes on Escape, blur and pointer leave. Needs a {@link TooltipProvider} above it.
 *
 * Disabled tooltips keep no state. Radix reports a hover even while `open` is held false, and remembering it would
 * show the tooltip the moment `enabled` turns true (every link hovered in an expanded sidebar popping up when it
 * collapses). So the open state is never stored while disabled, and it's reset whenever `enabled` changes, during
 * render (React's "adjust state when a prop changes" pattern), with no effect and no remount.
 */
export function Tooltip({
  content,
  enabled = true,
  side = "top",
  align = "center",
  sideOffset = 6,
  className,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setOpen(false);
  }

  return (
    <TooltipPrimitive.Root
      open={enabled && open}
      onOpenChange={(next) => {
        if (enabled || !next) setOpen(next);
      }}
    >
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} className={className}>
        {content}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}
