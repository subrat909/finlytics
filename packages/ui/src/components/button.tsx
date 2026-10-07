import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Button styles (plan §5). Filled surfaces and a hover tint, never a border or a shadow. Focus is the 2px --ring
 * outline: `outline-solid` is explicit because Tailwind's outline width utilities read the style from a variable that
 * `outline-hidden` would set to none. Only the text and fill transition: `transition-colors` would also fade the
 * outline in from the text colour.
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm text-sm font-medium",
    "whitespace-nowrap transition-[color,background-color] select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary/90",
        secondary: "bg-surface-2 text-fg hover:bg-surface-3",
        ghost: "bg-transparent text-fg hover:bg-surface-2",
        profit: "bg-profit text-profit-fg hover:bg-profit/90",
        loss: "bg-loss text-loss-fg hover:bg-loss/90",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

interface ButtonOwnProps extends VariantProps<typeof buttonVariants> {
  className?: string | undefined;
}

export interface NativeButtonProps extends React.ComponentProps<"button">, ButtonOwnProps {
  asChild?: false | undefined;
  /**
   * Shows a spinner and sets aria-busy and aria-disabled. The button keeps focus (it isn't `disabled`) and ignores
   * clicks, including form submits, until `loading` is false again.
   */
  loading?: boolean | undefined;
}

export interface SlotButtonProps extends React.ComponentProps<"button">, ButtonOwnProps {
  /** Renders the only child (a link, usually) with button styling instead of a <button>. */
  asChild: true;
  loading?: never;
}

/** Icon-only buttons are `<Button size="icon" aria-label="…">`. */
export type ButtonProps = NativeButtonProps | SlotButtonProps;

/** Module-level, so a loading button allocates nothing per render. */
function ignoreClick(event: React.MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/**
 * A button: `type="button"` by default (a form submit is opt-in), `data-slot="button"`, the caller's className merged
 * last. Server-safe: it creates no function props unless `loading` is set or the caller passes `onClick`.
 */
export function Button({ className, variant, size, asChild, loading, type, onClick, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} onClick={onClick} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      data-slot="button"
      type={type ?? "button"}
      className={classes}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : undefined}
      onClick={loading ? ignoreClick : onClick}
      {...props}
    >
      {loading ? <LoaderCircle data-slot="button-spinner" className="motion-safe:animate-spin" /> : null}
      {children}
    </button>
  );
}
