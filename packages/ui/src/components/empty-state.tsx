import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const emptyStateVariants = cva("flex flex-col items-center justify-center gap-2 text-center text-fg", {
  variants: {
    size: {
      page: "min-h-80 px-6 py-16",
      inline: "px-4 py-8",
    },
  },
  defaultVariants: { size: "page" },
});

export interface EmptyStateProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** A lucide icon element, coloured by a semantic token (`<Plug className="text-highlight" />`). Decorative. */
  icon: React.ReactNode;
  /** Put a decorative emoji in `<span aria-hidden="true">`. */
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  /** Usually a primary <Button> that resolves the empty state. */
  action?: React.ReactNode | undefined;
  /** The title's heading level, to fit the page outline (default 2). */
  headingLevel?: 2 | 3 | undefined;
  /** `page` fills a route (default); `inline` sits inside a card or panel. */
  size?: "page" | "inline" | undefined;
}

/** What a page or panel shows when it has nothing yet: an icon, a title, a description and the action to take. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 2,
  size,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section data-slot="empty-state" className={cn(emptyStateVariants({ size }), className)} {...props}>
      <div
        data-slot="empty-state-icon"
        aria-hidden="true"
        className="mb-2 flex size-12 items-center justify-center rounded-full bg-surface-2 [&_svg]:size-5"
      >
        {icon}
      </div>
      <Heading data-slot="empty-state-title" className="text-base font-semibold text-balance">
        {title}
      </Heading>
      {description ? (
        <p data-slot="empty-state-description" className="max-w-sm text-sm text-pretty text-fg-muted">
          {description}
        </p>
      ) : null}
      {action ? (
        <div data-slot="empty-state-action" className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
    </section>
  );
}
