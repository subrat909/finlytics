import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

export const separatorVariants = cva("shrink-0 bg-border", {
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "h-full w-px",
    },
  },
  defaultVariants: { orientation: "horizontal" },
});

export interface SeparatorProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical" | undefined;
  /**
   * Decorative (default): purely visual, hidden from assistive technology (`role="none"`). Pass false when it
   * separates content a screen reader user should hear as separate (`role="separator"`).
   */
  decorative?: boolean | undefined;
}

/**
 * A 1px rule in the `border` token, horizontal or vertical (Radix Separator's semantics without its client JavaScript,
 * so it renders in Server Components).
 */
export function Separator({ orientation = "horizontal", decorative = true, className, ...props }: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role={decorative ? "none" : "separator"}
      aria-orientation={!decorative && orientation === "vertical" ? "vertical" : undefined}
      className={cn(separatorVariants({ orientation }), className)}
      {...props}
    />
  );
}
