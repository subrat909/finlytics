"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

export type PopoverProps = React.ComponentProps<typeof PopoverPrimitive.Root>;
export type PopoverTriggerProps = React.ComponentProps<typeof PopoverPrimitive.Trigger>;
export type PopoverAnchorProps = React.ComponentProps<typeof PopoverPrimitive.Anchor>;
export type PopoverCloseProps = React.ComponentProps<typeof PopoverPrimitive.Close>;
export type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content>;

/** A non-modal floating panel anchored to its trigger (Radix Popover): Escape and a click outside close it. */
export function Popover(props: PopoverProps) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/** Usually `asChild` around a Button. */
export function PopoverTrigger(props: PopoverTriggerProps) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/** Positions the panel against something other than the trigger. */
export function PopoverAnchor(props: PopoverAnchorProps) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverClose(props: PopoverCloseProps) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

/**
 * The panel: a surface-1 card with the 1px `border` edge and no shadow, in a portal. Focus moves into it on open and
 * back to the trigger on close. Label it (`aria-label`, or a heading inside and `aria-labelledby`).
 */
export function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-sm border border-border bg-surface-1 p-3 text-sm text-fg outline-none",
          "origin-(--radix-popover-content-transform-origin)",
          "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0",
          "motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:animate-out",
          "motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
