import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Flat surface-2 (or whatever background the caller sets); the shimmer (a translucent band moving across it,
 * theme.css) runs only when the user allows motion. It animates background-position, which repaints but never shifts
 * layout.
 */
const skeletonVariants = cva("bg-surface-2 motion-safe:shimmer motion-safe:animate-shimmer", {
  variants: {
    shape: {
      line: "h-4 w-full rounded-sm",
      block: "h-24 w-full rounded-sm",
      circle: "size-10 shrink-0 rounded-full",
    },
  },
  defaultVariants: { shape: "line" },
});

export interface SkeletonProps extends React.ComponentProps<"div"> {
  /** `line` for text (default), `block` for tiles, charts and inputs, `circle` for avatars and icons. Size with className. */
  shape?: "line" | "block" | "circle" | undefined;
}

/**
 * A loading placeholder shaped like the content it stands for. Always hidden from assistive technology: the region
 * around it (PageLoader, a busy table) announces the loading state once. Server-safe.
 */
export function Skeleton({ className, shape, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape ?? "line"}
      className={cn(skeletonVariants({ shape }), className)}
      {...props}
      aria-hidden="true"
    />
  );
}
