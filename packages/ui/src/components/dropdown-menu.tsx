"use client";

import { cva } from "class-variance-authority";
import { Check, ChevronRight, Circle } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Menu surfaces: surface-1 with the 1px `border` edge and no shadow. Items are rows, not buttons: the highlighted one
 * (pointer or arrow keys) is tinted surface-2, and in forced colours, where that tint disappears, it gets an outline in
 * the system Highlight colour instead.
 */
const surfaceClasses = cn(
  "z-50 min-w-44 overflow-x-hidden overflow-y-auto rounded-sm border border-border bg-surface-1 p-1 text-fg",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95",
  "motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95",
);

export const dropdownMenuItemVariants = cva(
  [
    "relative flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm outline-none select-none",
    "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
    "forced-colors:data-[highlighted]:outline-1 forced-colors:data-[highlighted]:outline-solid",
    "forced-colors:data-[highlighted]:outline-[Highlight]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: "text-fg [&_svg:not([class*='text-'])]:text-fg-muted",
        /** Sign out, disconnect: loss text, on the loss tint when highlighted. */
        destructive: "text-loss data-[highlighted]:bg-loss/10 [&_svg]:text-loss",
      },
      inset: { true: "pl-8", false: "" },
    },
    defaultVariants: { variant: "default", inset: false },
  },
);

export type DropdownMenuProps = React.ComponentProps<typeof DropdownMenuPrimitive.Root>;

/** An actions menu (Radix DropdownMenu, the APG menu button pattern): arrow keys, typeahead, Escape, focus return. */
export function DropdownMenu(props: DropdownMenuProps) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export type DropdownMenuTriggerProps = React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>;

/** Usually `asChild` around a Button, so it keeps the button's look and focus outline. */
export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export type DropdownMenuPortalProps = React.ComponentProps<typeof DropdownMenuPrimitive.Portal>;

export function DropdownMenuPortal(props: DropdownMenuPortalProps) {
  return <DropdownMenuPrimitive.Portal {...props} />;
}

export type DropdownMenuContentProps = React.ComponentProps<typeof DropdownMenuPrimitive.Content>;

/** The menu, in a portal, 6px from its trigger, never taller than the space available. */
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          surfaceClasses,
          "max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export type DropdownMenuGroupProps = React.ComponentProps<typeof DropdownMenuPrimitive.Group>;

export function DropdownMenuGroup(props: DropdownMenuGroupProps) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export interface DropdownMenuItemProps extends React.ComponentProps<typeof DropdownMenuPrimitive.Item> {
  variant?: "default" | "destructive" | undefined;
  /** Indents the text to line up with checkbox and radio items. */
  inset?: boolean | undefined;
}

export function DropdownMenuItem({ className, variant, inset, ...props }: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant ?? "default"}
      className={cn(dropdownMenuItemVariants({ variant, inset }), className)}
      {...props}
    />
  );
}

export type DropdownMenuCheckboxItemProps = React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>;

/** A toggle in a menu (`role="menuitemcheckbox"`), with a check while on. */
export function DropdownMenuCheckboxItem({ className, children, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(dropdownMenuItemVariants({ inset: true }), className)}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="text-primary" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export type DropdownMenuRadioGroupProps = React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>;

export function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export type DropdownMenuRadioItemProps = React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>;

/** One choice in a radio group (`role="menuitemradio"`), with a dot while chosen. */
export function DropdownMenuRadioItem({ className, children, ...props }: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(dropdownMenuItemVariants({ inset: true }), className)}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          {/* `!`: the item's `[&_svg]:size-4` would otherwise win. */}
          <Circle aria-hidden="true" className="size-2! fill-current text-primary" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export interface DropdownMenuLabelProps extends React.ComponentProps<typeof DropdownMenuPrimitive.Label> {
  inset?: boolean | undefined;
}

/** A group's caption (not focusable): muted, small. */
export function DropdownMenuLabel({ className, inset, ...props }: DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-fg-muted", inset && "pl-8", className)}
      {...props}
    />
  );
}

export type DropdownMenuSeparatorProps = React.ComponentProps<typeof DropdownMenuPrimitive.Separator>;

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export type DropdownMenuShortcutProps = React.ComponentProps<"span">;

/** The item's keyboard shortcut, right-aligned. Decorative: put the shortcut on the control (`aria-keyshortcuts`). */
export function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      aria-hidden="true"
      className={cn("ml-auto pl-4 font-mono text-2xs tracking-wide text-fg-muted", className)}
      {...props}
    />
  );
}

export type DropdownMenuSubProps = React.ComponentProps<typeof DropdownMenuPrimitive.Sub>;

export function DropdownMenuSub(props: DropdownMenuSubProps) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

export interface DropdownMenuSubTriggerProps extends React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> {
  inset?: boolean | undefined;
}

/** Opens a submenu (Right arrow, or hover); the chevron says so. */
export function DropdownMenuSubTrigger({ className, inset, children, ...props }: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(dropdownMenuItemVariants({ inset }), "data-[state=open]:bg-surface-2", className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export type DropdownMenuSubContentProps = React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>;

export function DropdownMenuSubContent({ className, ...props }: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(surfaceClasses, "origin-(--radix-dropdown-menu-content-transform-origin)", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
