import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

/**
 * Page scaffolding inside the shell (plan phase-1b "Layout"). `<main>` has no padding and is the only scroll container
 * (navbar and footer never move): standard pages use {@link PageContainer} and {@link PageHeader}; terminal pages
 * (watchlists, charts) use {@link TerminalPage}, which fills the space between the navbar and the footer.
 */
export function PageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page"
      className={cn("flex w-full min-w-0 flex-col gap-4 p-4 lg:gap-5 lg:px-6 lg:py-5", className)}
      {...props}
    />
  );
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A 20 px lucide icon, coloured by the section's accent. */
  icon?: React.ReactNode;
  /** Right-aligned controls (buttons, segmented controls). */
  actions?: React.ReactNode;
  /** A small status label after the title (a ui `Badge`: "Soon", "Simulated"). */
  badge?: React.ReactNode;
  className?: string | undefined;
}

/**
 * The page title row: an icon tile, the title (the page's h1) with an optional badge and a one-line description on the
 * left, actions on the right (stacked below on phones).
 */
export function PageHeader({ title, description, icon, actions, badge, className }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-1 [&_svg]:size-4.5"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg leading-7 font-semibold tracking-tight text-fg">{title}</h1>
            {badge ? <span className="flex shrink-0 items-center">{badge}</span> : null}
          </div>
          {description ? <p className="truncate text-sm text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A full-height, full-bleed workspace (no padding, no page scroll): its panels scroll on their own. */
export function TerminalPage({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="terminal-page"
      className={cn("flex h-full min-h-[480px] w-full min-w-0 overflow-hidden", className)}
      {...props}
    />
  );
}

export interface PanelProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** The panel header's title (an h2 unless `headingLevel` says otherwise). */
  title?: React.ReactNode;
  headingLevel?: 2 | 3 | undefined;
  /** Right side of the panel header (a badge, a small button). */
  actions?: React.ReactNode;
}

/**
 * A terminal panel (plan phase-1b "Design language"): `rounded-sm border border-border bg-surface-1`, with an optional
 * 40px header row on a 1px rule. Labelled by its title.
 */
export function Panel({ title, headingLevel = 2, actions, className, children, ...props }: PanelProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      data-slot="panel"
      className={cn("flex min-w-0 flex-col rounded-sm border border-border bg-surface-1", className)}
      {...props}
    >
      {title === undefined && actions === undefined ? null : (
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          {title === undefined ? <span /> : <Heading className="truncate text-sm font-medium text-fg">{title}</Heading>}
          {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
