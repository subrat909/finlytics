"use client";

import { cva } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import { createContext, useContext } from "react";
import type * as React from "react";

import { cn } from "../lib/utils";

export type TabsVariant = "line" | "segmented";

const TabsVariantContext = createContext<TabsVariant>("line");

export const tabsListVariants = cva("inline-flex max-w-full items-center", {
  variants: {
    variant: {
      /** Underlined tabs on a 1px rule: page sections, a terminal panel's views. */
      line: "h-10 w-full justify-start gap-4 border-b border-border",
      /** Filled pills in a bordered surface-2 track: a compact switch between views. */
      segmented: "h-9 w-fit gap-1 rounded-md border border-border bg-surface-2 p-0.5",
    },
  },
  defaultVariants: { variant: "line" },
});

/**
 * Tabs are buttons: no border and no shadow. The line variant's indicator is a 2px bar drawn by `::after`, not a
 * border; in forced colours it paints in the system Highlight colour, which the forced palette keeps.
 */
export const tabsTriggerVariants = cva(
  [
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 text-sm font-medium",
    "whitespace-nowrap text-fg-muted transition-[color,background-color] select-none hover:text-fg",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        line: [
          "h-full px-1 data-[state=active]:text-fg",
          "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full",
          "data-[state=active]:after:bg-primary",
          "forced-colors:data-[state=active]:after:forced-color-adjust-none",
          "forced-colors:data-[state=active]:after:bg-[Highlight]",
        ],
        segmented: [
          "h-7.5 rounded-sm px-3 hover:bg-surface-3",
          "data-[state=active]:bg-primary data-[state=active]:text-primary-fg data-[state=active]:hover:bg-primary",
          "forced-colors:data-[state=active]:forced-color-adjust-none",
          "forced-colors:data-[state=active]:bg-[Highlight] forced-colors:data-[state=active]:text-[HighlightText]",
          "forced-colors:data-[state=active]:outline-[CanvasText]",
        ],
      },
    },
    defaultVariants: { variant: "line" },
  },
);

export type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root>;

/**
 * Views of one thing, one shown at a time (Radix Tabs, the APG tabs pattern): arrow keys move between tabs, and a tab
 * activates when it gets focus. For one choice out of a few that sets a value (a timeframe), use SegmentedControl.
 */
export function Tabs({ className, ...props }: TabsProps) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-3", className)} {...props} />;
}

export interface TabsListProps extends React.ComponentProps<typeof TabsPrimitive.List> {
  /** `line` (default): underlined. `segmented`: pills in a track. Its triggers follow it. */
  variant?: TabsVariant | undefined;
}

/** The row of tabs. Label it (`aria-label`) when the page has more than one tab list. */
export function TabsList({ className, variant = "line", ...props }: TabsListProps) {
  return (
    <TabsVariantContext value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsVariantContext>
  );
}

export type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Trigger>;

export function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
}

export type TabsContentProps = React.ComponentProps<typeof TabsPrimitive.Content>;

/** A tab's panel. It's focusable (Tab moves from the tab list into it), so it gets the focus outline too. */
export function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        className,
      )}
      {...props}
    />
  );
}
