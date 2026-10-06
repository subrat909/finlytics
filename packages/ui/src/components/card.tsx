import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

export type CardProps = React.ComponentProps<"div">;
export type CardHeaderProps = React.ComponentProps<"div">;
export type CardTitleProps = React.ComponentProps<"h3"> & {
  /** Renders the only child (an h2, say) with the title styling instead of an h3, to fit the page's heading outline. */
  asChild?: boolean | undefined;
};
export type CardDescriptionProps = React.ComponentProps<"p">;
export type CardActionProps = React.ComponentProps<"div">;
export type CardContentProps = React.ComponentProps<"div">;
export type CardFooterProps = React.ComponentProps<"div">;

/** A card: bg-surface-1 with a 16px radius, no border and no shadow (frontend.md). Server-safe, like its parts. */
export function Card({ className, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn("flex flex-col gap-4 rounded-2xl bg-surface-1 p-4 text-fg sm:p-6", className)}
      {...props}
    />
  );
}

/** Title and description; a CardAction placed inside sits at the top right. */
export function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, asChild, ...props }: CardTitleProps) {
  const Component = asChild ? Slot.Root : "h3";
  return (
    <Component data-slot="card-title" className={cn("text-base leading-snug font-semibold", className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return <p data-slot="card-description" className={cn("text-sm text-fg-muted", className)} {...props} />;
}

export function CardAction({ className, ...props }: CardActionProps) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: CardContentProps) {
  return <div data-slot="card-content" className={className} {...props} />;
}

export function CardFooter({ className, ...props }: CardFooterProps) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-2", className)} {...props} />;
}
