import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * A small status label: an accent's text on its own 10% tint with a 1px edge of the same accent (contrast ≥ 4.5:1 on
 * the page, a card and a surface-2 row, checked by the token tests), or muted text on surface-2 for `neutral`.
 * Not a button: it never takes focus, so the edge is allowed.
 */
export const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-sm border font-medium whitespace-nowrap",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-2 text-fg-muted",
        primary: "border-primary/25 bg-primary/10 text-primary",
        profit: "border-profit/25 bg-profit/10 text-profit",
        loss: "border-loss/25 bg-loss/10 text-loss",
        warning: "border-warning/25 bg-warning/10 text-warning",
        info: "border-info/25 bg-info/10 text-info",
      },
      size: {
        /** 18px: inline in dense rows, the sidebar's "Soon", the status bar. */
        sm: "h-4.5 px-1.5 text-2xs [&_svg]:size-3",
        /** 22px: page headers, cards. */
        md: "h-5.5 px-2 text-xs [&_svg]:size-3.5",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  /** A leading dot in the badge's colour: a live status ("● Live"). Decorative; the text says it. */
  dot?: boolean | undefined;
  /** Renders the only child (a link, say) with badge styling instead of a <span>. */
  asChild?: boolean | undefined;
}

/**
 * `<Badge tone="warning">Simulated</Badge>`, `<Badge size="sm">Soon</Badge>`. Colour is never the only signal: the
 * text carries the meaning. Server-safe.
 */
export function Badge({ className, tone, size, dot = false, asChild = false, children, ...props }: BadgeProps) {
  const classes = cn(badgeVariants({ tone, size }), className);
  if (asChild) {
    return (
      <Slot.Root data-slot="badge" data-tone={tone ?? "neutral"} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <span data-slot="badge" data-tone={tone ?? "neutral"} className={classes} {...props}>
      {dot ? (
        <span data-slot="badge-dot" aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}
