import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

/** A key cap: mono, muted text on surface-2 with a 1px edge (not a button: it never takes focus). */
export const kbdVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-0.5 rounded-sm border border-border bg-surface-2",
    "font-mono font-medium text-fg-muted select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      size: {
        sm: "h-4.5 min-w-4.5 px-1 text-2xs [&_svg]:size-2.5",
        md: "h-5 min-w-5 px-1.5 text-xs [&_svg]:size-3",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface KbdProps extends React.ComponentProps<"kbd">, VariantProps<typeof kbdVariants> {}

/**
 * A keyboard key: `<Kbd>⌘</Kbd><Kbd>K</Kbd>` inside a {@link KbdGroup}. When the shortcut is also on the control
 * (`aria-keyshortcuts`), hide the keycaps from screen readers (`aria-hidden`) so it isn't read twice. Server-safe.
 */
export function Kbd({ className, size, ...props }: KbdProps) {
  return <kbd data-slot="kbd" className={cn(kbdVariants({ size }), className)} {...props} />;
}

export type KbdGroupProps = React.ComponentProps<"span">;

/** Keys pressed together, side by side. */
export function KbdGroup({ className, ...props }: KbdGroupProps) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-0.5", className)} {...props} />;
}
